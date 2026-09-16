# Review Fixes (7b69173..df66d8d whole-branch review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the findings of the 2026-09-16 whole-branch review: evidence degradation after a clock rollback, stale holder ids acting on a foreign window after a browser restart, the non-atomic screenshot write, the unqueued boot-time badge paint, in-page drags flagged as "Drag out", and the real timer in content.test.js.

**Architecture:** Every fix is at the consumer that assumed something the range broke. Timestamp gates (`takeShots` coalescing, `tailshots.decide`) treat a backwards step as elapsed and screenshot names are disambiguated against the session's `shots` map. Holder window/tab ids are verified against the live holder page (one adapter helper) before any window action. `takeShots` becomes pure with respect to storage: it returns the updated `shots` map and `lastShot`, which `dispatchNow` writes in the one batched `store.set`. The boot-time paint joins the queue. `DRAG` is reported on `dragend` when no in-page `drop` happened.

**Tech Stack:** Chrome MV3 service worker, plain ES modules, `node --test` with `tests/unit/fake-chrome.js`.

**Spec:** `docs/superpowers/specs/2026-09-12-exameye-design.md` (§3 shots, §5 CS names, §6a desktop, §7 persistence, §14 limitations). Review findings: this session's ReportFindings (also summarised in `.superpowers/sdd/2026-09-13-test-finish/progress.md`, section "2026-09-16 review fixes").

## Global Constraints

- No new permissions in `manifest.json`.
- Every change keeps `npm test`, `npm run test:integration` and `npm run check` green; run the full unit suite once per task, in the foreground, and quote the totals.
- Do not touch `src/core/session.js` semantics; `CLOCK_BACKWARDS` stays logged at the rolled-back wall-clock `at` (spec §14 item 16: all times are wall-clock).
- Root cause named in each commit body; regression test written first and shown failing.
- Do not commit; the controller commits after review. Do not run `git clean`, `git stash` or delete any file.
- Model roles: implement with Sonnet, review with Opus (memory `feedback-model-roles`).

---

### Task 1: tailshots.decide treats a backwards clock as elapsed

**Files:**
- Modify: `src/core/tailshots.js:5`
- Test: `tests/unit/tailshots.test.js`

**Root cause:** `decide()` gates on `at - t.lastAt >= minGapMs`; after `CLOCK_BACKWARDS` the difference is negative, so every tail `SCREEN_CHANGED` and desktop-away frame is dropped until the clock passes `lastAt` again.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/tailshots.test.js`)

```js
test('a capture timestamped before the previous one (clock set back) is kept', () => {
  const after = decide(EMPTY_TAIL, { hash: 'a', at: 100000 }).tail;
  const r = decide(after, { hash: 'b', at: 40000 });
  assert.equal(r.keep, true);
  assert.deepEqual(r.tail, { count: 2, lastHash: 'b', lastAt: 40000 });
});
```

- [ ] **Step 2: Run** `node --test tests/unit/tailshots.test.js` — expected FAIL (`keep` is `false`).

- [ ] **Step 3: Implement** — `src/core/tailshots.js` line 5 becomes:

```js
  const keep = t.count < cap && hash !== t.lastHash && (t.lastHash === null || at < t.lastAt || at - t.lastAt >= minGapMs);
```

- [ ] **Step 4: Run** `node --test tests/unit/tailshots.test.js` — expected PASS (all tests).

---

### Task 2: takeShots captures afresh after a rollback, disambiguates names, and writes shots/lastShot in the batch

**Files:**
- Modify: `src/sw.js` (`dispatchNow` lines 79-154, `takeShots` lines 169-221)
- Test: `tests/unit/sw-hardening.test.js` (append two tests), `tests/unit/sw-shots.test.js` (unchanged, must stay green)

**Root causes:** (1) `takeShots` line 205 `ev.t - last.at < SHOT_GAP_MS` is true for every negative delta, so after a rollback each shot-worthy event reuses the stale file. (2) `shotFile(ev.t, name)` is unique only under a monotonic clock; a colliding name overwrites the earlier JPEG in `shots` and on disk (`downloads.js` uses `conflictAction: 'overwrite'`). (3) `takeShots` writes `shots` and `meta.lastShot` before the event batch, so a service-worker kill in between leaves an orphan; the arm-time `shots: {}`/`lastShot: null` writes have the same non-atomic shape.

**Interfaces:**
- Produces: `takeShots(events, pre, fresh)` returns `{ added, shots, last }` where `shots` is the full session map after this call (`null` when nothing was loaded and `fresh` is false) and `last` is the new `meta.lastShot` value (`null` when unchanged). `fresh === true` starts from an empty map and no lastShot (arm) instead of reading storage.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/sw-hardening.test.js`; the file's earlier tests end with the session IDLE at `at: 302000`)

```js
test('after a clock rollback shots are captured afresh and a colliding name is disambiguated', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 400000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 460000 });
  const first = (await events()).at(-1);
  assert.match(first.shot, /_PERIODIC\.jpg$/);
  await sw.dispatch({ kind: 'PERIODIC', at: 400000 });
  let evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['CLOCK_BACKWARDS', 'PERIODIC']);
  assert.notEqual(evs.at(-1).shot, first.shot, 'a rolled-back event must not reuse the pre-rollback screenshot');
  assert.match(evs.at(-1).shot, /_PERIODIC\.jpg$/);
  await sw.dispatch({ kind: 'PERIODIC', at: 460000 });
  evs = await events();
  assert.equal(evs.at(-1).shot, first.shot.replace(/\.jpg$/, '-2.jpg'));
  const { shots } = await get('shots');
  assert.ok(shots[first.shot] && shots[evs.at(-1).shot], 'both JPEGs must survive');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 461000 });
});

test('a screenshot dispatch writes shots and meta.lastShot in the same storage call as the event', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 500000 });
  const realSet = chrome.storage.local.set.bind(chrome.storage.local);
  const calls = [];
  chrome.storage.local.set = async (obj) => { calls.push(obj); return realSet(obj); };
  try { await sw.dispatch({ kind: 'PERIODIC', at: 510000 }); } finally { chrome.storage.local.set = realSet; }
  const ev = (await events()).at(-1);
  const batch = calls.find(o => o.events && o.shots && o.meta);
  assert.ok(batch, JSON.stringify(calls.map(o => Object.keys(o))));
  assert.ok(batch.shots[ev.shot]);
  assert.equal(batch.meta.lastShot.file, ev.shot);
  assert.equal(calls.findIndex(o => o.shots), calls.indexOf(batch), 'shots must not be written before the batch');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 511000 });
});
```

- [ ] **Step 2: Run** `node --test tests/unit/sw-hardening.test.js` — expected: both new tests FAIL (first: `shot` equals `first.shot`; second: `findIndex` is before the batch).

- [ ] **Step 3: Implement `takeShots`** — replace lines 169-221 of `src/sw.js` with:

```js
async function takeShots(events, pre, fresh) {
  const { meta = {} } = await store.get('meta');
  const desktopOn = meta.desktop?.state === 'on';
  const wantDesktop = events.some(e => e.name === 'DESKTOP_FRAME' || (needsDesktopFrame(e) && desktopOn));
  if (!events.some(needsShot) && !wantDesktop) return { added: [], shots: fresh ? {} : null, last: null };
  const shots = fresh ? {} : ((await store.get('shots')).shots || {});
  let last = (fresh ? null : meta.lastShot) || { at: 0, file: null };
  const added = [];
  // a clock set back can reproduce an earlier stamp; the earlier JPEG must not be overwritten
  const unique = (file) => { let f = file, n = 2; while (f in shots) f = file.replace(/\.jpg$/, `-${n++}.jpg`); return f; };
  for (const ev of events) {
    if (ev.name === 'DESKTOP_FRAME') {
      const file = unique(desktopShotFile(ev.t, ev.name));
      shots[file] = pre.desktop;
      added.push({ file, b64: pre.desktop });
      ev.shot = file;
      continue;
    }
    if (needsDesktopFrame(ev) && desktopOn) {
      const { b64, alive } = await grabDesktop(meta.desktop?.holderTabId);
      if (b64) {
        const file = unique(desktopShotFile(ev.t, ev.name));
        shots[file] = b64;
        added.push({ file, b64 });
        ev.data.desktopShot = file;
      } else {
        ev.data.desktopShotError = alive ? 'no frame' : 'stream not alive';
      }
    }
    if (!needsShot(ev)) continue;
    if (ev.name === 'SCREEN_CHANGED') {
      const file = unique(shotFile(ev.t, ev.name));
      shots[file] = pre.b64;
      added.push({ file, b64: pre.b64 });
      ev.shot = file;
      last = { at: ev.t, file };
      continue;
    }
    // a negative delta means the clock was set back: the previous shot is not "2 s old", capture again
    if (last.file && ev.t >= last.at && ev.t - last.at < SHOT_GAP_MS) { ev.shot = last.file; continue; }
    try {
      if (NAV_BORN.has(ev.name)) await awaitLoaded(ev.tabId, PAINT_WAIT_MS);
      const windowId = ev.windowId >= 0 ? ev.windowId : await lastFocusedWindowId();
      const b64 = await captureJpeg(windowId);
      const file = unique(shotFile(ev.t, ev.name));
      shots[file] = b64;
      added.push({ file, b64 });
      ev.shot = file;
      last = { at: ev.t, file };
    } catch (e) {
      ev.data.shotError = String(e?.message || e);
    }
  }
  return { added, shots, last: added.length ? last : null };
}
```

- [ ] **Step 4: Implement the `dispatchNow` side** — replace lines 98-143 of `src/sw.js` (from `const r = reduce(session, input, cfg);` through `await store.set(batch);`) with:

```js
  const r = reduce(session, input, cfg);
  newEvents.push(...r.events);
  const armed = r.session.state === 'ARMED' && session.state === 'IDLE';
  const closing = r.session.state === 'CLOSING' && session.state === 'ARMED';
  if (armed) {
    const h = headerLine(r.session);
    events = []; lines = [h]; lastHash = await shortHash(h);
  }
  const { added, shots, last } = await takeShots(newEvents, input.pre, armed);
  if (meta.desktop?.state === 'on') {
    for (const ev of newEvents) {
      if (ev.name === 'FOCUS_LEFT_CHROME') { await store.patchMeta({ desktopAway: EMPTY_TAIL }); await setAway(meta.desktop.holderTabId, true); }
      else if (ev.name === 'FOCUS_RETURNED') await setAway(meta.desktop.holderTabId, false);
    }
  }
  for (const ev of newEvents) {
    const line = chainLine(formatLine(ev), lastHash);
    ev.hash = lastHash = await shortHash(line);
    lines.push(line);
    events.push(ev);
  }
  const batch = { session: r.session, events, lines, lastHash };
  if (armed || added.length) batch.shots = shots;
  if (newEvents.length) {
    const sess = r.session.state !== 'IDLE' ? r.session : session;
    const base = `${sess.subfolder ?? cfg.subfolder}/${sess.id}`;
    let { pending = {} } = await store.get('pending');
    pending = putText(pending, `${base}/log.txt`, 'text/plain', lines.join('\n') + '\n');
    for (const s of added) pending = putBase64(pending, `${base}/${s.file}`, 'image/jpeg', s.b64);
    batch.pending = pending;
  }
  const endEffect = r.effects.find(e => e.type === 'END');
  let pendingEnd;
  const { meta: currentMeta = {} } = await store.get('meta');
  batch.meta = { ...currentMeta, lastSeenAt: input.at };
  if (armed) Object.assign(batch.meta, { lastShot: null, lastError: null });
  if (closing) batch.meta.tail = EMPTY_TAIL;
  if (last) batch.meta.lastShot = last;
  if (endEffect) {
    const endShots = batch.shots ?? (await store.get('shots')).shots ?? {};
    pendingEnd = { outcome: endEffect.outcome, session: endEffect.session, events: [...events], lines: [...lines], shots: endShots };
    // events/lines/shots are cleared here, atomically with the pendingEnd snapshot that now
    // holds them: leaving the live clear for endSession's own (later, possibly much later)
    // final write would risk wiping a NEW session armed in between (see below).
    Object.assign(batch, { events: [], lines: [], shots: {}, meta: { ...batch.meta, pendingEnd } });
  }
  await store.set(batch);
```

Keep everything after `await store.set(batch);` unchanged, except replace the two remaining `r.session.state === 'ARMED' && session.state === 'IDLE'` expressions (badge line is unaffected; the resumed-DESKTOP block at the end) with `armed`.

- [ ] **Step 5: Run** `node --test tests/unit/sw-hardening.test.js tests/unit/sw-shots.test.js tests/unit/sw-end.test.js tests/unit/sw-desktop-frames.test.js` — expected PASS. Then the full `npm test` — expected 303/303 (301 + Task 1 + these two). If `sw-shots.test.js` test 1 ("never loads the shots map") fails, the `store.get('shots')` moved somewhere it must not be: fix the code, not the test.

---

### Task 3: holder window/tab verified before any window action

**Files:**
- Modify: `src/adapters/desktop.js` (add `isHolderWindow`), `src/sw.js` (`askNow` lines 266-277, `closeHolderNow` lines 339-346, import line 16)
- Create: `tests/unit/sw-holder-guard.test.js`
- Test also: `tests/unit/adapters.test.js` (append one test)

**Root cause:** window and tab ids restart after a browser restart and are only reset inside `recover()`'s queue step; any earlier step (`ensureBoot`→`boot`→`applyConfigNow` when the tick alarm is missing, or a `tick`/`desktopAsk` alarm delivered before `onStartup`) reaches `closeWindow(id)` / `showWindow(id)` / `askHolder(tabId)` with ids that can now name the exam window and tab. `askNow` also has no repair path when `holderTabId` is `null` while the window exists (silent `askHolder(null)`, state stuck in `prompting` with the re-ask alarm cleared).

**Interfaces:**
- Produces: `isHolderWindow(windowId, tabId)` in `src/adapters/desktop.js`: `true` only when window `windowId` exists and hosts a tab whose URL is `holderUrl()` and (when `tabId != null`) whose id is `tabId`. Never throws.

- [ ] **Step 1: Write the failing adapter test** (append to `tests/unit/adapters.test.js`, next to the other `desktop.*` tests, which import `* as desktop from '../../src/adapters/desktop.js'`)

```js
test('isHolderWindow is true only for a window whose tab is the holder page', async () => {
  chrome.tabs.list = [
    { id: 9, windowId: 100, url: chrome.runtime.getURL('src/holder/holder.html'), active: true },
    { id: 1, windowId: 3, url: 'https://e.x/start', active: true },
  ];
  assert.equal(await desktop.isHolderWindow(100, 9), true);
  assert.equal(await desktop.isHolderWindow(100, null), true);
  assert.equal(await desktop.isHolderWindow(100, 8), false);
  assert.equal(await desktop.isHolderWindow(3, 1), false);
  assert.equal(await desktop.isHolderWindow(999, 9), false);
  assert.equal(await desktop.isHolderWindow(null, null), false);
});
```

- [ ] **Step 2: Write the failing service-worker test** — create `tests/unit/sw-holder-guard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';
import { EMPTY_DESKTOP } from '../../src/core/desktop.js';

const chrome = installFakeChrome();
chrome.desktopCapture = {};
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');

const realCreate = chrome.windows.create.bind(chrome.windows);
chrome.windows.create = async (opts) => {
  const win = await realCreate(opts);
  chrome.tabs.list = chrome.tabs.list.filter(t => t.id !== 9);
  chrome.tabs.list.push({ id: 9, windowId: win.id, url: opts.url, title: 'ExamEye capture', incognito: false, active: true });
  return win;
};

const get = (k) => chrome.storage.local.get(k);
const armedSession = {
  state: 'ARMED', id: '20260101-000000_A17', seat: 'A17', subfolder: 'ExamEye', startedAt: 0, examTabId: 1, examWindowId: 3,
  examUrl: 'https://e.x/start', seq: 1, lastActivityAt: 0, tabLostAt: null, windowState: 'normal',
  away: { tabAt: null, tabId: null, tabUrl: null, focusAt: null, minAt: null, idleAt: null, idleState: null },
  maxAt: null, endClickAt: null, markerSeen: false, outcome: null, trigger: null, triggerLabel: null,
  examEndedAt: null, closingUntil: null, multiMonitorSeen: false,
};
// ids persisted by a previous browser session now name the exam window and tab
const exam = () => {
  chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
  chrome.windows.list = [{ id: 3, focused: false, state: 'minimized' }];
};

test('closeHolderNow leaves a window alone when it no longer hosts the holder page', async () => {
  exam();
  await chrome.storage.local.set({ session: armedSession, meta: { desktop: { ...EMPTY_DESKTOP, state: 'on', holderWindowId: 3, holderTabId: 1 } } });
  await chrome.storage.local.set({ config: { ...config, desktopCapture: 'off' } });
  await sw.settled();
  assert.ok(chrome.windows.list.some(w => w.id === 3), 'the exam window must not be closed');
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'off');
  assert.equal(meta.desktop.holderWindowId, null);
});

test('askNow opens a fresh holder instead of showing a foreign window with stale ids', async () => {
  exam();
  await chrome.storage.local.set({ session: armedSession, meta: { desktop: { ...EMPTY_DESKTOP, state: 'declined', at: 0, nextAskAt: 0, asks: 1, holderWindowId: 3, holderTabId: 1 } } });
  chrome.tabs.sent = [];
  await chrome.storage.local.set({ config: { ...config, desktopCapture: 'on' } });
  await sw.settled();
  assert.equal(chrome.windows.list.find(w => w.id === 3).state, 'minimized', 'the exam window must not be shown');
  assert.ok(!chrome.tabs.sent.some(s => s.tabId === 1), 'no holder message to the exam tab');
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'prompting');
  assert.notEqual(meta.desktop.holderWindowId, 3);
  assert.equal(meta.desktop.holderTabId, 9);
  assert.equal(chrome.windows.list.filter(w => w.type === 'popup').length, 1);
});

test('askNow with a live holder window but no holder tab id opens a fresh holder rather than prompting nobody', async () => {
  const { meta: m0 } = await get('meta');
  await chrome.storage.local.set({ meta: { ...m0, desktop: { ...m0.desktop, state: 'declined', at: 0, nextAskAt: 0, holderTabId: null } } });
  const before = chrome.windows.list.filter(w => w.type === 'popup').length;
  await chrome.alarms.onAlarm.emit({ name: 'desktopAsk' });
  await sw.settled();
  const { meta } = await get('meta');
  assert.equal(meta.desktop.state, 'prompting');
  assert.equal(meta.desktop.holderTabId, 9);
  assert.equal(chrome.windows.list.filter(w => w.type === 'popup').length, before + 1);
  await chrome.storage.local.set({ config, session: { state: 'IDLE' } });
  await sw.settled();
});
```

- [ ] **Step 3: Run** `node --test tests/unit/adapters.test.js tests/unit/sw-holder-guard.test.js` — expected FAIL (adapter: `isHolderWindow` is not a function; sw: exam window closed / shown, `holderTabId` stays 1 or null).

- [ ] **Step 4: Implement the adapter** — append to `src/adapters/desktop.js`:

```js
// ids persisted before a browser restart can name any window: act only on a window that still shows the holder page
export async function isHolderWindow(windowId, tabId) {
  if (windowId == null) return false;
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  return tabs.some(t => t.url === holderUrl() && (tabId == null || t.id === tabId));
}
```

- [ ] **Step 5: Implement in `sw.js`** — add `isHolderWindow` to the import on line 16; replace `askNow` and `closeHolderNow`:

```js
async function askNow(d, cfg) {
  if (cfg.desktopCapture !== 'on') return;
  let { holderWindowId: id, holderTabId: tabId } = d;
  if (tabId != null && (await isHolderWindow(id, tabId))) {
    await showWindow(id);
    await askHolder(tabId);
  } else {
    ({ windowId: id, tabId } = await openHolder());
  }
  await store.patchMeta({ desktop: { ...d, state: 'prompting', at: now(), holderWindowId: id, holderTabId: tabId, asks: d.asks + 1 } });
  await alarms.clear('desktopAsk');
}
```

```js
async function closeHolderNow() {
  const { meta = {} } = await store.get('meta');
  const d = meta.desktop || EMPTY_DESKTOP;
  if (d.state === 'off' && d.holderWindowId === null) return;
  // the tombstone keeps the id so the holder's own WINDOW_REMOVED is dropped by the HOLDER_KINDS gate
  const alive = await isHolderWindow(d.holderWindowId, d.holderTabId);
  await store.patchMeta({ desktop: { ...EMPTY_DESKTOP, holderWindowId: alive ? d.holderWindowId : null } });
  await alarms.clear('desktopAsk');
  if (alive) await closeWindow(d.holderWindowId);
}
```

- [ ] **Step 6: Run** `node --test tests/unit/adapters.test.js tests/unit/sw-holder-guard.test.js tests/unit/sw-desktop.test.js tests/unit/sw-desktop-frames.test.js tests/unit/sw-startup.test.js` — expected PASS. Then full `npm test`. Known fixture caveat: the fake's `windows.create` does not add a tab, so a test without the create override above gets `holderTabId: null` and the guard opens a new holder on every ask; if such a test now fails on a popup count, add the same create override to that test file (a fixture fix), never weaken the guard.

---

### Task 4: boot-time badge paint runs inside the queue

**Files:**
- Modify: `src/sw.js` `ensureBoot` lines 459-464

**Root cause:** the paint reads `session`/`events` and calls `setBadge` outside the queue, racing whatever dispatch woke the worker; the queue is the serialisation point for every other storage-derived side effect.

- [ ] **Step 1: Implement**

```js
async function ensureBoot() {
  if (await alarms.get('tick')) await suppressUi();
  else await boot();
  await enqueue(async () => {
    const { session, events = [] } = await store.get(['session', 'events']);
    await paintBadge(session, events);
  });
}
```

- [ ] **Step 2: Run** `node --test tests/unit/sw-badge.test.js tests/unit/sw-boot.test.js` — expected PASS (keep the existing 20 ms wait in sw-badge test 2: the enqueue happens after two awaits, so `settled()` taken immediately after import does not yet cover it). No regression test: the losing interleaving cannot be produced deterministically with the fake (say so in the commit body).

---

### Task 5: DRAG reported only for a drag that does not end in the page; content.test.js real timer

**Files:**
- Modify: `src/content.js:15`, `tests/unit/content.test.js` (import block lines 26-33, tests 1-2, the DRAG test), spec §5 row for DRAG (line 355 of `docs/superpowers/specs/2026-09-12-exameye-design.md`)

**Root cause:** `dragstart` fires for every drag, including drag-and-drop question widgets, so in-page drags are flagged "Drag out" (serious). A drop inside the page fires `drop` before the source's `dragend`; a drag that leaves the page (or is cancelled) ends with `dragend` and no `drop`. Test file: `content.js` arms a real 1 s debounce as soon as the stored config resolves (at import) and on every `setConfig` in tests 1-2, before any test mocks timers.

- [ ] **Step 1: Write the failing test** — replace the existing `dragstart reports selection length and the dragged element tag` test in `tests/unit/content.test.js` with:

```js
test('a drag that ends without an in-page drop reports DRAG; a drag dropped in the page does not', () => {
  const n = sent.length;
  L['doc:dragstart']({ target: { tagName: 'P' } });
  assert.equal(sent.length, n, 'nothing is sent at dragstart');
  L['doc:dragend']({});
  assert.deepEqual(last(), { type: 'cs', name: 'DRAG', data: { len: 3, tag: 'P' } });
  const m = sent.length;
  L['doc:dragstart']({ target: { tagName: 'IMG' } });
  L['doc:drop']({});
  L['doc:dragend']({});
  assert.equal(sent.length, m, 'an in-page drop is not a DRAG');
});
```

- [ ] **Step 2: Run** `node --test tests/unit/content.test.js` — expected FAIL (`sent.length` grows at dragstart; `L['doc:dragend']` is undefined).

- [ ] **Step 3: Implement** — replace line 15 of `src/content.js` with:

```js
  // drop fires on an in-page target before the source's dragend; a drag that leaves the page (or is cancelled) ends without one
  let drag = null;
  document.addEventListener('dragstart', (e) => { drag = { len: String(getSelection() || '').length, tag: e.target?.tagName || '' }; }, true);
  document.addEventListener('drop', () => { drag = null; }, true);
  document.addEventListener('dragend', () => { if (drag) send('DRAG', drag); drag = null; }, true);
```

- [ ] **Step 4: Remove the real timer from the test file** — in `tests/unit/content.test.js` replace `await import('../../src/content.js');` with:

```js
// content.js arms its 1 s debounce as soon as the stored config resolves; keep that off the real event loop
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
await import('../../src/content.js');
await new Promise((r) => realSetTimeout(r, 0));
globalThis.setTimeout = realSetTimeout;
```

and give tests 1 and 2 (`normaliser matches core/labels on the shared vectors`, `click on a matching start button ...`) a `(t)` parameter with `t.mock.timers.enable({ apis: ['setTimeout'] });` as their first line, so the `setConfig` calls inside them arm fake timers that `t.mock` discards at test end.

- [ ] **Step 5: Run** `node --test tests/unit/content.test.js` — expected PASS; the run must finish without a trailing wait (compare wall time with `time`).

- [ ] **Step 6: Spec** — line 355 of the spec becomes `| DRAG | CS dragend with no in-page drop (dragged out of the page, or cancelled) | len (selection length), tag | yes |`. In `docs/superpowers/plans/2026-09-15-review-hardening-plan.md` nothing changes (historical).

---

### Task 6: Spec and ledger

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-exameye-design.md` (§3 coalescing bullet ~line 426, §6a persistence paragraph ~line 536, §14 item 16 ~line 869), `.superpowers/sdd/2026-09-13-test-finish/progress.md` (append a section)

- [ ] **Step 1: §3 coalescing bullet** — after "This also guarantees unique file names (one per second at most)." append: "A clock set back (§14 item 16) breaks both assumptions, so a negative `now − at` captures afresh and a name already present in `shots` gets a `-2`, `-3`… suffix before `.jpg`; `tailshots.decide` treats a negative gap as elapsed for the same reason. `shots` and `meta.lastShot` are written in the same batched `storage.set` as the event (§7), never ahead of it."

- [ ] **Step 2: §6a persistence paragraph** — after "(window ids are not stable across restarts, so the old id is dropped, never closed)" append: "; before any window action (`closeHolderNow`, `askNow`) the SW checks that `holderWindowId` still hosts a tab at the holder URL with id `holderTabId` (`adapters/desktop.isHolderWindow`), so a step that runs ahead of `recover()` cannot close, show or minimise a foreign window. A `desktopAsk`/`tick` alarm delivered before `onStartup` can still open a holder that `recover()` then replaces; the orphan is told `{close:true}` on its `ready`."

- [ ] **Step 3: §14 item 16** — append: "After a set-back, screenshot coalescing and tail dedupe treat the negative gap as elapsed and file names are disambiguated (§3); `durations` in `counters.js` can still come out negative between an event pair that straddles the step."

- [ ] **Step 4: Ledger** — append to `.superpowers/sdd/2026-09-13-test-finish/progress.md`:

```
## 2026-09-16 review fixes (Fable plan; Sonnet implements; Opus reviews)
- Whole-branch review 7b69173..df66d8d (Fable, 2026-09-16): 1 Important (clock rollback vs shot coalescing/tail dedupe/file names), 6 Low. Plan: docs/superpowers/plans/2026-09-16-review-fixes-plan.md.
- Pitfall: a feature that admits a non-monotonic input (CLOCK_BACKWARDS) must be traced through every consumer that subtracts timestamps; the H6 task fixed the log and left takeShots/decide/shotFile assuming monotonic time. Rule: when adding an event that changes an invariant, grep for the invariant's consumers before closing the task.
- Fixed: T1 tailshots negative gap; T2 takeShots fresh capture + unique names + shots/lastShot in the batch (also closes the H8 arm-time and orphan-lastShot minors); T3 isHolderWindow guard in closeHolderNow/askNow (closes final-review minor 1 and the null-holderTabId dead end); T4 boot paint enqueued (minor 2); T5 DRAG on dragend without in-page drop; content.test real timer (minor 4).
- Left: orphan-lastShot minor 3 is closed by T2; F4 remains gated.
```

---

### Task 7: Verification and review

- [ ] **Step 1:** `npm test` (foreground, once) — expected 306/306 or the count the new tests produce; quote the totals line. `npm run test:integration` — 4/4. `npm run check` — clean.
- [ ] **Step 2:** Opus review of `git diff` (working tree vs df66d8d) against this plan: root cause addressed, whole class covered, nothing new broken, no test weakened.
- [ ] **Step 3:** Controller (Fable) final review, then a single commit command for the owner.
