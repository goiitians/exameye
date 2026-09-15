# ExamEye Review Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the interference and failure paths found in the 2026-09-15 code review: a page clock that silences marker detection, a forgeable holder channel, a lost exam window after a tab drag, silent config edits, drag-out of text, a clock set back, a service worker that never re-boots after re-enable, and a non-atomic per-event write.

**Architecture:** Unchanged (spec §2): `src/core/*` pure (no `chrome.*`), `src/adapters/*` thin, `src/sw.js` a serialised queue (every storage writer runs inside `enqueue`; `*Now` functions run inside the queue and never call `dispatch()`/enqueue-wrappers), `src/content.js` a classic script with no imports. Each task adds at most one reducer input kind and one event name, and each new flagged event is added to the `FLAGS` table so the report shows it.

**Tech Stack:** Manifest V3, plain ES modules, `node --test` (Node 22) with `tests/unit/fake-chrome.js` and `fake-dom.js`, Playwright Chromium for integration.

**Spec:** `docs/superpowers/specs/2026-09-12-exameye-design.md` (authority). Every task ends by updating the spec section it changes. The findings themselves are summarised in the table below; the full review lives in the session transcript of 2026-09-15 and is not needed to execute this plan.

## Global constraints

- Baseline before Task 1: `git status` clean on `main`; `npm test` 270/270; `npm run test:integration` 4/4; `npm run check` clean; `pgrep -fl "ms-playwright/chromium"` empty afterwards. Read `.superpowers/sdd/2026-09-13-test-finish/progress.md` first and append to it as you go.
- TDD: write the named failing test, run it and see it fail, then the minimal code, then the full command. `npm test`, `npm run test:integration`, `npm run check` run in the **foreground**; read the real output before ticking a step.
- Every task leaves `npm test` and `npm run check` green. Integration runs before every commit (owner ruling for this session). One commit per task, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, `git status` before, `git add` the intended paths only. Never push a broken main.
- No emojis. No comments unless the WHY is non-obvious. Surgical diffs: do not reformat neighbouring code. Match the existing style (2-space, single quotes, one-line arrow helpers).
- `now()` in the SW is `Date.now()`; tests drive `at` explicitly through `sw.dispatch()` or the reducer, and use `t.mock.timers` only in `content.test.js`.
- Tasks 1 and 3 touch disjoint files and may run in parallel; every other task edits `src/sw.js` or `src/core/session.js` and runs sequentially after them.
- Tasks 9 to 12 are **gated** on owner answers recorded at the top of each task. Do not start a gated task until the ledger has the owner's answer.
- The owner must Reload the unpacked extension after every push (`chrome://extensions`).

## Findings covered

| Task | Finding | Severity |
|---|---|---|
| 1 | Content-script debounce never fires on a page whose DOM mutates every second; END_MARKER and SCREEN_CHANGED are lost | high |
| 2 | Any extension page can send `desktop` messages; SW→holder traffic is a broadcast, so a second holder page disrupts or fakes capture | high |
| 3 | Exam tab dragged into another window: `examWindowId` stale, minimise tracking and tail shots target the old window | medium |
| 4 | Options page edits apply silently mid-session; a subfolder change splits one session across two folders | medium |
| 5 | Dragging selected text out of the page is not a copy event | low |
| 6 | A clock set back is invisible in the log; timers drift | medium |
| 7 | Enabling a disabled extension fires neither `onInstalled` nor `onStartup`, so boot never runs again; dev-mode bubble doc is wrong | medium |
| 8 | Per-event storage writes are three calls; a SW kill between them drops an event | low |
| 9 (gated) | Paper inside an iframe or shadow DOM: clipboard, labels and marker missed | depends on platform |
| 10 (gated) | Close exam tab, wait out abandon, reopen from history: never monitored again | high if platform allows resume |
| 11 (gated) | Duplicate exam tab: page events from the copy are dropped | medium |
| 12 (gated) | Result URL typed into a second tab ends the session | high if the platform never opens the result in a new tab |

## File map

| Path | Change |
|---|---|
| `src/content.js` | max-wait ceiling on the mutation debounce (T1); `dragstart` listener (T5); gated frame handling (T9) |
| `src/adapters/desktop.js` | messages addressed with `chrome.tabs.sendMessage(holderTabId, …)`; `openHolder` returns `{ windowId, tabId }` (T2) |
| `src/core/desktop.js` | `EMPTY_DESKTOP.holderTabId`; `closed` clears it (T2) |
| `src/core/session.js` | `trackWindow` + `EXAM_WINDOW_MOVED` (T3); `subfolder` frozen at arm, `CONFIG_CHANGED` handler (T4); `DRAG` in `CS_DIRECT` (T5); `CLOCK` handler (T6); gated handlers (T10–T12) |
| `src/core/config.js` | `changedKeys(before, after)` (T4) |
| `src/core/events.js` | `SHOT_EVENTS` + `CONFIG_CHANGED`, `DRAG` (T4, T5), gated names (T11, T12) |
| `src/core/summary-html.js` | `FLAGS` rows for `CONFIG_CHANGED`, `CLOCK_BACKWARDS`, `DRAG` (T4–T6), gated rows. If the follow-up plan's Task 1 has already moved `FLAGS` to `src/core/flags.js`, edit that file instead |
| `src/adapters/alarms.js` | `get(name)` (T7) |
| `src/sw.js` | holder tab addressing and sender check (T2); `CONFIG_CHANGED` dispatch and frozen subfolder (T4); `CLOCK_BACKWARDS` (T6); `ensureBoot()` at every SW start (T7); single batched write per dispatch (T8) |
| `tests/unit/fake-chrome.js` | `tabs.sendMessage/sent/responder` (T2); `alarms.get` (T7) |
| `tests/unit/session-hardening.test.js` (new) | reducer tests for T3–T6 |
| `tests/unit/sw-hardening.test.js` (new) | SW tests for T4, T6, T8 |
| `tests/unit/sw-boot.test.js` (new) | T7 |
| `docs/centre-setup.md` | §1 dev-mode bubble correction, §7 options-page and re-enable notes (T4, T7) |
| spec §3, §4, §5, §6a, §7, §9, §14 | per task |

---

## Task 1: mutation debounce with a ceiling (finding 1)

**Files:** `src/content.js` (lines 55–66), `tests/unit/content.test.js`, spec §5 "Content-script names on the wire" paragraph.

**Interfaces:** none new. `scheduleChange()` keeps its name; `runChange()` is the body it now delegates to.

- [ ] **Step 1: failing test** — append to `tests/unit/content.test.js` (after the `'a submitted screen already on the page…'` test):

```js
test('a mutation every 500 ms still yields one SCREEN_CHANGED within 5 s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const count = () => sent.filter(m => m.name === 'SCREEN_CHANGED').length;
  const n = count();
  for (let i = 0; i < 12; i++) { FakeObserver.last.trigger(); t.mock.timers.tick(500); }
  assert.equal(count(), n + 1);
  t.mock.timers.tick(1000);
  assert.equal(count(), n + 2);
});
```

- [ ] **Step 2: run it** — `node --test tests/unit/content.test.js`. Expected: FAIL, `count()` stays `n` (the 1 s timer is reset by every trigger).

- [ ] **Step 3: implement** — replace the `changeTimer`/`scheduleChange` block in `src/content.js` with:

```js
  const MAX_WAIT_MS = 5000;
  let changeTimer = null, firstPendingAt = null;
  function runChange() {
    changeTimer = null; firstPendingAt = null;
    send('SCREEN_CHANGED', {});
    if (marker && !markerSent && norm(document.body?.innerText).includes(marker)) {
      send('END_MARKER', { marker });
      markerSent = true;
    }
  }
  // trailing debounce with a ceiling: a page clock ticking every second would otherwise reset the timer forever
  function scheduleChange() {
    const at = Date.now();
    if (firstPendingAt === null) firstPendingAt = at;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(runChange, Math.max(0, Math.min(1000, firstPendingAt + MAX_WAIT_MS - at)));
  }
```

- [ ] **Step 4: verify** — `node --test tests/unit/content.test.js` (all pass, including the existing `'mutations are debounced to one SCREEN_CHANGED per second'`), then `npm test`, `npm run check`.

- [ ] **Step 5: spec** — in §5, after the sentence "The marker is matched as a substring of the whole page text", add: "The content script runs the marker check and `SCREEN_CHANGED` on a trailing 1 s debounce of DOM mutations with a 5 s ceiling, so a page element that updates every second (a countdown) cannot postpone it forever."

- [ ] **Step 6: commit**

```bash
git add src/content.js tests/unit/content.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "fix(content): mutation debounce gets a 5 s ceiling; a ticking page clock no longer silences the marker check"
```

## Task 2: holder channel bound to the holder tab (finding 2)

**Files:** `src/adapters/desktop.js`, `src/core/desktop.js`, `src/sw.js` (`askNow`, `desktopMessageNow`, `takeShots`, `desktopPingNow`, the `setAway` calls in `dispatchNow`), `tests/unit/fake-chrome.js`, `tests/unit/desktop.test.js`, `tests/unit/sw-desktop.test.js`, `tests/unit/sw-desktop-frames.test.js`, `tests/unit/adapters.test.js`, spec §6a "Messages" and "State".

**Interfaces:**
- Produces `openHolder(): Promise<{ windowId, tabId }>`; `grabDesktop(tabId)`, `setAway(tabId, on)`, `askHolder(tabId)`; `EMPTY_DESKTOP.holderTabId: null`.
- Fake: `chrome.tabs.sendMessage(tabId, msg)` records `{ tabId, msg }` in `chrome.tabs.sent` and answers with `chrome.tabs.responder(msg, tabId)` or throws `'Could not establish connection'`.

- [ ] **Step 1: fake** — in `tests/unit/fake-chrome.js` add to `tabs`:

```js
      sent: [], responder: null,
      async sendMessage(tabId, msg) {
        c.tabs.sent.push({ tabId, msg });
        if (c.tabs.responder) return c.tabs.responder(msg, tabId);
        throw new Error('Could not establish connection');
      },
```

- [ ] **Step 2: failing tests** — in `tests/unit/sw-desktop.test.js` insert immediately before the `'started: on, minimised, …'` test (state is `prompting`, holder tab is 9 via the `windows.create` override at the top of the file):

```js
test('desktop messages from a tab that is not the holder are ignored', async () => {
  const d = await desktop();
  assert.equal(d.state, 'prompting');
  assert.equal(d.holderTabId, 9);
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'started', width: 1, height: 1, pickMs: 1 }, { tab: { id: 77, windowId: d.holderWindowId } }, () => {});
  await settle();
  assert.equal((await desktop()).state, 'prompting');
  const n = (await names()).length;
  await chrome.runtime.onMessage.emit({ type: 'desktop', name: 'frame', b64: 'QUJD' }, { tab: { id: 77, windowId: 5 } }, () => {});
  await settle();
  assert.equal((await names()).length, n);
});
```

and immediately after the test that asserts a re-ask (`assert.deepEqual(chrome.runtime.sent.at(-1), { type: 'holder', name: 'ask' })`, ~line 116):

```js
test('SW to holder traffic is addressed to the holder tab, never broadcast', () => {
  assert.ok(!chrome.runtime.sent.some(m => m.type === 'holder'));
  assert.ok(chrome.tabs.sent.length > 0);
  assert.ok(chrome.tabs.sent.every(s => s.tabId === 9), JSON.stringify(chrome.tabs.sent.map(s => s.tabId)));
});
```

In `tests/unit/desktop.test.js` add:

```js
test('closed clears holderTabId as well as holderWindowId', () => {
  const on = { ...EMPTY_DESKTOP, state: 'on', at: T0, since: T0, holderWindowId: 7, holderTabId: 9, asks: 1 };
  const r = onHolder(on, { name: 'closed' }, { at: T0 + 1, repromptMin: 5 });
  assert.equal(r.desktop.holderWindowId, null);
  assert.equal(r.desktop.holderTabId, null);
  assert.equal(EMPTY_DESKTOP.holderTabId, null);
});
```

- [ ] **Step 3: run** — `node --test tests/unit/sw-desktop.test.js tests/unit/desktop.test.js`. Expected: the three new tests FAIL (`holderTabId` undefined; `started` from tab 77 flips state to `on`; `chrome.tabs.sent` empty).

- [ ] **Step 4: implement**

`src/core/desktop.js`: add `holderTabId: null` to `EMPTY_DESKTOP` (after `holderWindowId`). In `onHolder`, every branch that sets `holderWindowId: null` also sets `holderTabId: null` (three places under `msg.name === 'closed'`).

`src/adapters/desktop.js`:

```js
export const supported = () => Boolean(chrome.desktopCapture);
export const holderUrl = () => chrome.runtime.getURL('src/holder/holder.html');

async function send(tabId, name, extra = {}) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'holder', name, ...extra });
  } catch {
    return null;
  }
}

export async function openHolder() {
  const win = await chrome.windows.create({ url: holderUrl(), type: 'popup', width: 460, height: 140, focused: true });
  const tabId = win.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: win.id }))[0]?.id ?? null;
  return { windowId: win.id, tabId };
}
export const showWindow = (id) => chrome.windows.update(id, { state: 'normal', focused: true });
export const minimizeWindow = (id) => chrome.windows.update(id, { state: 'minimized' });
export const closeWindow = (id) => chrome.windows.remove(id).catch(() => {});

export async function grabDesktop(tabId) {
  return (await send(tabId, 'grab')) ?? { b64: null, alive: false };
}

export const setAway = (tabId, on) => send(tabId, 'away', { on });
export const askHolder = (tabId) => send(tabId, 'ask');
```

`src/sw.js`:
- `askNow`:
```js
async function askNow(d, cfg) {
  if (cfg.desktopCapture !== 'on') return;
  let { holderWindowId: id, holderTabId: tabId } = d;
  if (id !== null && (await getWindow(id))) {
    await showWindow(id);
    await askHolder(tabId);
  } else {
    ({ windowId: id, tabId } = await openHolder());
  }
  await store.patchMeta({ desktop: { ...d, state: 'prompting', at: now(), holderWindowId: id, holderTabId: tabId, asks: d.asks + 1 } });
  await alarms.clear('desktopAsk');
}
```
- `desktopMessageNow`: after computing `d`:
```js
  const fromHolder = d.holderTabId !== null && sender.tab?.id === d.holderTabId;
  if (msg.name === 'ready') { respond(fromHolder ? { ask: d.state === 'prompting' } : { close: true }); return; }
  if (!fromHolder) { respond({}); return; }
```
(remove the old `sender.tab?.windowId === d.holderWindowId` check).
- `dispatchNow`: `await setAway(meta.desktop.holderTabId, true)` and `await setAway(meta.desktop.holderTabId, false)`.
- `takeShots`: `const { b64, alive } = await grabDesktop(meta.desktop?.holderTabId);`
- `desktopPingNow`: `const { b64, alive } = await grabDesktop(d.holderTabId);`

- [ ] **Step 5: migrate existing tests** — grep `runtime.responder\|runtime.sent` in `tests/unit/adapters.test.js` (lines 128–141), `sw-desktop-frames.test.js` (25, 68, 75, 84, 141–155, 161–164, 189–197) and `sw-desktop.test.js` (105–137). Replace `chrome.runtime.responder` with `chrome.tabs.responder` and `chrome.runtime.sent` with `chrome.tabs.sent`, reading the message as `s.msg` (`chrome.tabs.sent.some(s => s.msg.name === 'ask')`, `assert.deepEqual(chrome.tabs.sent.at(-1).msg, { type: 'holder', name: 'ask' })`, `assert.deepEqual(chrome.tabs.sent[0], { tabId: 9, msg: { type: 'holder', name: 'away', on: true } })`). In `adapters.test.js` call the adapters with a tab id: `setAway(9, true)`, `askHolder(9)`, `grabDesktop(9)`. If `sw-desktop-frames.test.js` has no `windows.create` override that registers a holder tab, copy the override from `sw-desktop.test.js` lines 11–17 so `holderTabId` resolves to 9.

- [ ] **Step 6: verify** — `npm test` (all green), `npm run check`, `npm run test:integration` (the desktop scenario proves the real `tabs.sendMessage` path).

- [ ] **Step 7: spec §6a** — "Messages": SW → holder messages are sent with `chrome.tabs.sendMessage(meta.desktop.holderTabId, …)`, never broadcast; holder → SW messages other than `ready` are accepted only when `sender.tab.id === meta.desktop.holderTabId`, and `ready` from any other tab is answered `{close:true}`. "State": add `holderTabId` to the field list (tab id of the holder page; `null` when no holder exists). §14 item 12: add "a second holder page opened by the candidate cannot answer for the real one".

- [ ] **Step 8: commit**

```bash
git add src/adapters/desktop.js src/core/desktop.js src/sw.js tests/unit/fake-chrome.js tests/unit/desktop.test.js tests/unit/sw-desktop.test.js tests/unit/sw-desktop-frames.test.js tests/unit/adapters.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "fix(desktop): holder channel bound to the holder tab; other pages can neither answer for it nor inject frames"
```

## Task 3: follow the exam tab into another window (finding 3)

**Files:** `src/core/session.js`, `tests/unit/session-hardening.test.js` (new), spec §4 (ARMED/CLOSING inputs) and §5.

**Interfaces:** new event `EXAM_WINDOW_MOVED{ from, to }` (no screenshot, not a flag). No new input kind.

- [ ] **Step 1: failing tests** — create `tests/unit/session-hardening.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, reduce } from '../../src/core/session.js';

const cfg = { startPrefix: 'https://e.x/start', examPrefix: 'https://e.x/', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
const T0 = Date.UTC(2026, 8, 15, 4, 0, 0);
const nav = (tabId, url, at = T0, windowId = 3) => ({ kind: 'NAV', tabId, windowId, url, at });
const activate = (tabId, windowId, url, at) => ({ kind: 'TAB_ACTIVATED', tabId, windowId, url, title: 'T', incognito: false, at });
const arm = () => reduce(initial(), nav(41, 'https://e.x/start?c=1'), cfg);
const names = (r) => r.events.map(e => e.name);
const cs = (name, data, tabId = 41, url = 'https://e.x/q/1', at = T0 + 500) => ({ kind: 'CS', name, data, tabId, windowId: 3, url, at });

test('exam tab activated in another window moves the exam window and tracking follows', () => {
  let r = reduce(arm().session, activate(41, 7, 'https://e.x/q/1', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['EXAM_WINDOW_MOVED']);
  assert.deepEqual(r.events[0].data, { from: 3, to: 7 });
  assert.equal(r.session.examWindowId, 7);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 7, state: 'minimized', at: T0 + 2000 }, cfg);
  assert.deepEqual(names(r), ['WINDOW_MINIMIZED']);
  r = reduce(r.session, { kind: 'WINDOW_STATE', windowId: 3, state: 'minimized', at: T0 + 3000 }, cfg);
  assert.deepEqual(names(r), []);
});

test('exam tab navigation from a new window also moves it; same window and windowId -1 emit nothing', () => {
  let r = reduce(arm().session, nav(41, 'https://e.x/q/2', T0 + 1000, 7), cfg);
  assert.deepEqual(names(r), ['EXAM_WINDOW_MOVED', 'EXAM_NAV']);
  r = reduce(r.session, activate(41, 7, 'https://e.x/q/2', T0 + 2000), cfg);
  assert.deepEqual(names(r), []);
  r = reduce(r.session, nav(41, 'https://e.x/q/3', T0 + 3000, -1), cfg);
  assert.deepEqual(names(r), ['EXAM_NAV']);
  assert.equal(r.session.examWindowId, 7);
});

test('a move out of a fullscreen window does not fake a FULLSCREEN_EXIT on the next tick', () => {
  let r = reduce(arm().session, { kind: 'WINDOW_STATE', windowId: 3, state: 'fullscreen', at: T0 + 1000 }, cfg);
  r = reduce(r.session, activate(41, 7, 'https://e.x/q/1', T0 + 2000), cfg);
  r = reduce(r.session, { kind: 'TICK', at: T0 + 3000, windows: [{ id: 7, state: 'normal' }], examTabPresent: true }, cfg);
  assert.deepEqual(names(r), []);
});
```

- [ ] **Step 2: run** — `node --test tests/unit/session-hardening.test.js`. Expected: FAIL (no `EXAM_WINDOW_MOVED`; `examWindowId` stays 3).

- [ ] **Step 3: implement** — in `src/core/session.js` add above `examTabNav`:

```js
function trackWindow(s, input, emit) {
  if (input.windowId === undefined || input.windowId < 0 || input.windowId === s.examWindowId) return;
  emit('EXAM_WINDOW_MOVED', { from: s.examWindowId, to: input.windowId }, input);
  s.examWindowId = input.windowId;
  s.windowState = 'normal';
}
```

Call it as the first line of `examTabNav` (`trackWindow(s, input, emit);`) and as the first line inside `TAB_ACTIVATED`'s `if (input.tabId === s.examTabId) {` branch.

- [ ] **Step 4: verify** — `node --test tests/unit/session-hardening.test.js`, then `npm test`, `npm run check`.

- [ ] **Step 5: spec** — §5 row: `| EXAM_WINDOW_MOVED | tabs.onActivated / onCommitted on the exam tab with a different windowId | from, to | no |`. §4: under the ARMED/CLOSING handling of `TAB_ACTIVATED` and `NAV` for the exam tab add "if the input's windowId differs from `examWindowId` (and is not −1), `EXAM_WINDOW_MOVED` is emitted first, `examWindowId` follows the tab and `windowState` resets to `normal`".

- [ ] **Step 6: commit**

```bash
git add src/core/session.js tests/unit/session-hardening.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "fix(session): exam window id follows the exam tab when it is dragged into another window"
```

## Task 4: subfolder frozen at arm; CONFIG_CHANGED logged (finding 4)

**Files:** `src/core/config.js`, `src/core/session.js`, `src/core/events.js`, `src/core/summary-html.js` (`FLAGS`), `src/sw.js`, `tests/unit/config.test.js`, `tests/unit/session-hardening.test.js`, `tests/unit/sw-hardening.test.js` (new), `docs/centre-setup.md` §7, spec §3, §4, §5, §7.

**Interfaces:**
- `changedKeys(before, after): string[]` in `src/core/config.js` (keys of `DEFAULTS` whose normalised value differs, in `DEFAULTS` order).
- Input `{ kind: 'CONFIG_CHANGED', keys, at }`; event `CONFIG_CHANGED{ keys }` (screenshot yes, flag `critical`).
- `session.subfolder` set at arm; the SW derives every file path from `session.subfolder ?? cfg.subfolder`.

Ruling (record in the ledger): only `subfolder` is frozen. The rest of the config stays live because spec §6a promises that `desktopCapture` switched mid-session acts at once and three existing tests change `endButton`/`tailMin` while ARMED. Every change is logged instead. The options page only writes valid configs, so an invalid mid-session config can only come from DevTools, which is out of this task's reach.

- [ ] **Step 1: failing tests**

`tests/unit/config.test.js` append:

```js
test('changedKeys lists the normalised fields that differ, in DEFAULTS order', () => {
  const a = { ...DEFAULTS, startPrefix: 'https://e.x/start', seat: 'A' };
  assert.deepEqual(changedKeys(a, { ...a, tailMin: '2', subfolder: ' ExamEye ' }), ['tailMin']);
  assert.deepEqual(changedKeys(a, { ...a, desktopRepromptMin: 0, seat: 'B' }), ['seat', 'desktopRepromptMin']);
  assert.deepEqual(changedKeys(a, a), []);
  assert.deepEqual(changedKeys(undefined, {}), []);
});
```
(import `changedKeys` and `DEFAULTS` at the top.)

`tests/unit/session-hardening.test.js` append:

```js
test('CONFIG_CHANGED with keys is logged while not IDLE; empty keys and IDLE emit nothing', () => {
  let r = reduce(arm().session, { kind: 'CONFIG_CHANGED', keys: ['tailMin'], at: T0 + 1000 }, cfg);
  assert.deepEqual(names(r), ['CONFIG_CHANGED']);
  assert.deepEqual(r.events[0].data, { keys: ['tailMin'] });
  r = reduce(r.session, { kind: 'CONFIG_CHANGED', keys: [], at: T0 + 2000 }, cfg);
  assert.deepEqual(names(r), []);
  assert.deepEqual(names(reduce(initial(), { kind: 'CONFIG_CHANGED', keys: ['seat'], at: T0 }, cfg)), []);
});

test('arm freezes the subfolder into the session', () => {
  assert.equal(arm().session.subfolder, 'ExamEye');
});
```

Create `tests/unit/sw-hardening.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
const get = (k) => chrome.storage.local.get(k);
const events = async () => (await get('events')).events;

test('a config change while ARMED is logged with the changed keys and a screenshot', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 100000 });
  await chrome.storage.local.set({ config: { ...config, tailMin: 2, desktopRepromptMin: 0 } });
  await sw.settled();
  const ev = (await events()).at(-1);
  assert.equal(ev.name, 'CONFIG_CHANGED');
  assert.deepEqual(ev.data.keys, ['tailMin', 'desktopRepromptMin']);
  assert.match(ev.shot, /CONFIG_CHANGED\.jpg$/);
});

test('subfolder is frozen at arm: a mid-session change does not move the files', async () => {
  await chrome.storage.local.set({ config: { ...config, subfolder: 'Elsewhere' } });
  await sw.settled();
  const { session } = await get('session');
  assert.equal(session.state, 'ARMED');
  assert.equal(session.subfolder, 'ExamEye');
  assert.ok(chrome.downloads.calls.at(-1).filename.startsWith(`ExamEye/${session.id}/`), chrome.downloads.calls.at(-1).filename);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 105000 });
  const summary = chrome.downloads.calls.filter(c => c.filename.endsWith('summary.txt')).at(-1);
  assert.ok(summary.filename.startsWith(`ExamEye/${session.id}/`), summary.filename);
  assert.equal((await get('session')).session.state, 'IDLE');
  await chrome.storage.local.set({ config });
  await sw.settled();
});
```

- [ ] **Step 2: run** — `node --test tests/unit/config.test.js tests/unit/session-hardening.test.js tests/unit/sw-hardening.test.js`. Expected: FAIL (`changedKeys` not exported; no `CONFIG_CHANGED`; `session.subfolder` undefined; files land under `Elsewhere/`).

- [ ] **Step 3: implement**

`src/core/config.js` append:
```js
export function changedKeys(before, after) {
  const a = normalize(before ?? {}), b = normalize(after ?? {});
  return Object.keys(DEFAULTS).filter(k => a[k] !== b[k]);
}
```

`src/core/session.js`: in `arm()`'s `Object.assign` add `subfolder: cfg.subfolder,` after `seat: cfg.seat,`. Add to `HANDLERS` (first block, after `CLOSING_TIMER`):
```js
  CONFIG_CHANGED(s, input, cfg, emit) {
    if (input.keys.length) emit('CONFIG_CHANGED', { keys: input.keys }, input);
  },
```

`src/core/events.js`: add `'CONFIG_CHANGED'` to `SHOT_EVENTS` (after `'MAX_TIME_REACHED', 'SCREEN_CHANGED',`).

`src/core/summary-html.js` `FLAGS`: append `['CONFIG_CHANGED', 'Config changed', 'critical'],`.

`src/sw.js`:
- import `changedKeys` from `./core/config.js`.
- storage listener:
```js
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.config) return;
  applyConfig();
  dispatch({ kind: 'CONFIG_CHANGED', keys: changedKeys(changes.config.oldValue, changes.config.newValue), at: now() });
});
```
- `dispatchNow`: replace `const base = \`${cfg.subfolder}/${(r.session.state !== 'IDLE' ? r.session : session).id}\`;` with
```js
    const sess = r.session.state !== 'IDLE' ? r.session : session;
    const base = `${sess.subfolder ?? cfg.subfolder}/${sess.id}`;
```
- `endSession`: `const base = \`${session.subfolder ?? cfg.subfolder}/${session.id}\`;`

- [ ] **Step 4: run the whole suite** — `npm test`. Tests that change config while a session is ARMED or CLOSING now get one extra `CONFIG_CHANGED` event and one extra screenshot: `sw-desktop.test.js` (~215, `desktopCapture: 'off'` while ARMED), `sw-end.test.js` (~176), `sw-shots.test.js` (~66), `sw-startup.test.js` (~60), and every trailing `await chrome.storage.local.set({ config })` that restores the config while a session is still CLOSING (`sw-dispatch.test.js` ~138). Fix only assertions that count events, screenshots or `captureVisibleTab` calls absolutely; relative assertions (`before`/`after` deltas) stay. Do not change the behaviour to keep a test green.

- [ ] **Step 5: docs** — `docs/centre-setup.md` §7 add: "The Options page is reachable by anyone at the machine. Every saved change during a paper is logged as `CONFIG_CHANGED` with the field names and a screenshot, and the session's output folder is fixed when the paper starts, so a changed subfolder cannot split or hide a session in progress. On managed machines lock the page with the `ExtensionSettings` policy." Spec §3: "The SW logs `CONFIG_CHANGED{keys}` (`config.changedKeys`) for every `storage.onChanged` on `config` while a session is ARMED or CLOSING; `subfolder` is copied into `session.subfolder` at arm and used for every path of that session." §4: `CONFIG_CHANGED` input row. §5: event row `| CONFIG_CHANGED | storage.onChanged on config while ARMED/CLOSING | keys | yes |`. §7: "paths use `session.subfolder`".

- [ ] **Step 6: verify** — `npm test`, `npm run check`, `npm run test:integration`.

- [ ] **Step 7: commit**

```bash
git add src/core/config.js src/core/session.js src/core/events.js src/core/summary-html.js src/sw.js tests/unit/config.test.js tests/unit/session-hardening.test.js tests/unit/sw-hardening.test.js tests/unit/sw-desktop.test.js tests/unit/sw-end.test.js tests/unit/sw-shots.test.js tests/unit/sw-startup.test.js tests/unit/sw-dispatch.test.js docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(session): log CONFIG_CHANGED with the edited fields; freeze the output subfolder at arm"
```
(add only the test files you actually touched.)

## Task 5: DRAG event (finding 5)

**Files:** `src/content.js`, `src/core/session.js` (`CS_DIRECT`), `src/core/events.js`, `src/core/summary-html.js` (`FLAGS`), `tests/unit/content.test.js`, `tests/unit/session-hardening.test.js`, `tests/unit/events.test.js`, spec §5.

**Interfaces:** CS name `DRAG{ len, tag }`; event `DRAG{ len, tag }` (screenshot yes, flag `serious`).

- [ ] **Step 1: failing tests**

`tests/unit/content.test.js` (after `'clipboard events report lengths only'`):
```js
test('dragstart reports selection length and the dragged element tag', () => {
  L['doc:dragstart']({ target: { tagName: 'P' } });
  assert.deepEqual(last(), { type: 'cs', name: 'DRAG', data: { len: 3, tag: 'P' } });
});
```
`tests/unit/session-hardening.test.js`:
```js
test('DRAG from the exam tab is logged with its data; from another tab it is dropped', () => {
  let r = reduce(arm().session, cs('DRAG', { len: 12, tag: 'P' }), cfg);
  assert.deepEqual(names(r), ['DRAG']);
  assert.deepEqual(r.events[0].data, { len: 12, tag: 'P' });
  r = reduce(r.session, cs('DRAG', { len: 12, tag: 'P' }, 42, 'https://g.x/'), cfg);
  assert.deepEqual(names(r), []);
});
```
`tests/unit/events.test.js`: extend the `needsShot` test so `needsShot({ name: 'DRAG', data: {} })` is `true`.

- [ ] **Step 2: run** — `node --test tests/unit/content.test.js tests/unit/session-hardening.test.js tests/unit/events.test.js`. Expected: FAIL (`L['doc:dragstart']` undefined; no `DRAG` event; `needsShot` false).

- [ ] **Step 3: implement**
- `src/content.js` after the `contextmenu` listener: `document.addEventListener('dragstart', (e) => send('DRAG', { len: String(getSelection() || '').length, tag: e.target?.tagName || '' }), true);`
- `src/core/session.js`: `const CS_DIRECT = new Set(['COPY', 'CUT', 'PASTE', 'CONTEXTMENU', 'PRINT', 'DRAG']);`
- `src/core/events.js`: add `'DRAG'` to `SHOT_EVENTS` next to `'PRINT'`.
- `src/core/summary-html.js` `FLAGS`: after the `PRINT` row add `['DRAG', 'Drag out', 'serious'],`.

- [ ] **Step 4: verify** — `npm test`, `npm run check`.

- [ ] **Step 5: spec §5** — row `| DRAG | CS dragstart | len (selection length), tag | yes |`; add `DRAG{len,tag}` to the "Content-script names on the wire" list.

- [ ] **Step 6: commit**

```bash
git add src/content.js src/core/session.js src/core/events.js src/core/summary-html.js tests/unit/content.test.js tests/unit/session-hardening.test.js tests/unit/events.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(content): log DRAG when text is dragged out of the exam page"
```

## Task 6: CLOCK_BACKWARDS (finding 6)

**Files:** `src/sw.js` (`dispatchNow`, next to the GAP check), `src/core/session.js` (`CLOCK` handler), `src/core/summary-html.js` (`FLAGS`), `tests/unit/session-hardening.test.js`, `tests/unit/sw-hardening.test.js`, spec §4, §5, §14.

**Interfaces:** input `{ kind: 'CLOCK', at, lastSeenAt }`; event `CLOCK_BACKWARDS{ lastSeenAt, backMs }` (no screenshot, flag `critical`). Constant `CLOCK_SLACK_MS = 5000` in `sw.js`.

- [ ] **Step 1: failing tests**

`tests/unit/session-hardening.test.js`:
```js
test('CLOCK input emits CLOCK_BACKWARDS with the size of the jump', () => {
  const r = reduce(arm().session, { kind: 'CLOCK', at: T0 + 1000, lastSeenAt: T0 + 61000 }, cfg);
  assert.deepEqual(names(r), ['CLOCK_BACKWARDS']);
  assert.deepEqual(r.events[0].data, { lastSeenAt: T0 + 61000, backMs: 60000 });
});
```
`tests/unit/sw-hardening.test.js`:
```js
test('an input timestamped more than 5 s before the last seen time logs CLOCK_BACKWARDS first', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 200000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 250000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 210000 });
  let evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['CLOCK_BACKWARDS', 'PERIODIC']);
  assert.deepEqual(evs.at(-2).data, { lastSeenAt: 250000, backMs: 40000 });
  await sw.dispatch({ kind: 'PERIODIC', at: 208000 });
  evs = await events();
  assert.deepEqual(evs.slice(-2).map(e => e.name), ['PERIODIC', 'PERIODIC']);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 209000 });
  assert.equal((await get('session')).session.state, 'IDLE');
});
```

- [ ] **Step 2: run** — expected FAIL (no `CLOCK_BACKWARDS`).

- [ ] **Step 3: implement**

`src/sw.js`: `const CLOCK_SLACK_MS = 5000;` next to `GAP_MS`. In `dispatchNow`, directly after the GAP block:
```js
  if (session.state !== 'IDLE' && meta.lastSeenAt && input.at < meta.lastSeenAt - CLOCK_SLACK_MS) {
    const c = reduce(session, { kind: 'CLOCK', at: input.at, lastSeenAt: meta.lastSeenAt }, cfg);
    session = c.session;
    newEvents.push(...c.events);
  }
```
`src/core/session.js` `HANDLERS` (first block):
```js
  CLOCK(s, input, cfg, emit) {
    emit('CLOCK_BACKWARDS', { lastSeenAt: input.lastSeenAt, backMs: input.lastSeenAt - input.at }, input);
  },
```
`src/core/summary-html.js` `FLAGS`: append `['CLOCK_BACKWARDS', 'Clock set back', 'critical'],`.

- [ ] **Step 4: verify** — `npm test`, `npm run check`.

- [ ] **Step 5: spec** — §4: "before reducing any input while not IDLE, the SW reduces `CLOCK{at,lastSeenAt}` when `at < meta.lastSeenAt − 5000`". §5 row `| CLOCK_BACKWARDS | SW: input time precedes meta.lastSeenAt by more than 5 s | lastSeenAt, backMs | no |`. §14 new item: "System clock. All times are wall-clock; a clock set back is logged as `CLOCK_BACKWARDS`, a clock set forward is indistinguishable from a recording gap and appears as `EXTENSION_GAP`. Absolute alarms (`max`, `abandon`, `closing`, `desktopAsk`) fire early or late by the same amount."

- [ ] **Step 6: commit**

```bash
git add src/sw.js src/core/session.js src/core/summary-html.js tests/unit/session-hardening.test.js tests/unit/sw-hardening.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "feat(sw): log CLOCK_BACKWARDS when an input is timestamped before the last seen time"
```

## Task 7: boot on every service-worker start; dev-mode bubble doc (finding 7)

**Files:** `src/adapters/alarms.js`, `src/sw.js`, `tests/unit/fake-chrome.js`, `tests/unit/sw-boot.test.js` (new), `docs/centre-setup.md` §1 line 12 and §7, spec §2 or §10.

**Interfaces:** `alarms.get(name): Promise<Alarm | undefined>`; `ensureBoot()` in `sw.js` (not exported): `suppressUi()` always, full `boot()` when the `tick` alarm is missing (the signature of an enabled lifetime that never booted).

- [ ] **Step 1: fake** — `tests/unit/fake-chrome.js` `alarms`: add `async get(name) { const a = c.alarms.alarms[name]; return a ? { name, ...a } : undefined; },`.

- [ ] **Step 2: failing tests** — create `tests/unit/sw-boot.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0, desktopCapture: 'off', desktopRepromptMin: 5 };
const later = () => new Promise((r) => setTimeout(r, 20));

test('a service worker start without the tick alarm boots fully', async () => {
  const chrome = installFakeChrome();
  await chrome.storage.local.set({ config });
  const sw = await import('../../src/sw.js?boot=1');
  await later();
  await sw.settled();
  assert.deepEqual(chrome.alarms.alarms.tick, { periodInMinutes: 0.5 });
  assert.deepEqual(chrome.alarms.alarms.periodic, { periodInMinutes: 10 });
  assert.equal(chrome.scripting.registered.length, 1);
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
});

test('a service worker start with the tick alarm present only re-applies the download UI option', async () => {
  const chrome = installFakeChrome();
  await chrome.storage.local.set({ config });
  chrome.alarms.alarms.tick = { periodInMinutes: 0.5 };
  const sw = await import('../../src/sw.js?boot=2');
  await later();
  await sw.settled();
  assert.equal(chrome.scripting.registered.length, 0);
  assert.equal(chrome.alarms.alarms.periodic, undefined);
  assert.deepEqual(chrome.downloads.uiOptions, { enabled: false });
});
```

- [ ] **Step 3: run** — `node --test tests/unit/sw-boot.test.js`. Expected: first test FAILS (`alarms.tick` undefined, `uiOptions` null).

- [ ] **Step 4: implement**
- `src/adapters/alarms.js`: `export const get = (name) => chrome.alarms.get(name);`
- `src/sw.js` after `boot()`:
```js
// Enabling a disabled extension fires neither onInstalled nor onStartup; a missing tick alarm is
// the signature of an enabled lifetime that never booted.
async function ensureBoot() {
  if (await alarms.get('tick')) { await suppressUi(); return; }
  await boot();
}
```
and replace the top-level `eraseOwnCompleted();` line with `eraseOwnCompleted();` followed by `ensureBoot();`.

- [ ] **Step 5: run everything** — `npm test`. Every `sw-*.test.js` now boots on import (config errors recorded, `tick` alarm created, content script registered when the config is valid). Fix only assertions on the complete alarms map or on `scripting.registered.length` that assumed no boot; leave behaviour alone.

- [ ] **Step 6: docs** — `docs/centre-setup.md` §1 replace line 12 with: "Chrome shows a "Disable developer mode extensions" bubble on each start. Click Cancel or close it: its Disable button switches off every unpacked extension, ExamEye included, and a candidate can click it too. The bubble does not appear when Developer mode is left ON, and the store or policy route has no bubble at all." §7 add: "If ExamEye is disabled and enabled again, it re-creates its timers on its next start; the gap shows as `EXTENSION_GAP` on the next event." Spec §10: note that `tick` doubles as the boot marker and that `ensureBoot()` runs at every SW start. Owner verification list (ledger NEXT): confirm on Windows what the bubble's Disable button does to ExamEye.

- [ ] **Step 7: verify** — `npm test`, `npm run check`, `npm run test:integration`.

- [ ] **Step 8: commit**

```bash
git add src/adapters/alarms.js src/sw.js tests/unit/fake-chrome.js tests/unit/sw-boot.test.js docs/centre-setup.md docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "fix(sw): boot on every service worker start when the tick alarm is missing; correct the dev-mode bubble note"
```

## Task 8: one storage write per dispatch (finding 8)

**Files:** `src/sw.js` (`dispatchNow`), `tests/unit/sw-hardening.test.js`, spec §7.

**Interfaces:** none new. The three writes (`pending`; `session/events/lines/lastHash[/shots/meta.pendingEnd]`; `meta.lastSeenAt`) become one `store.set(batch)`.

- [ ] **Step 1: failing test** — `tests/unit/sw-hardening.test.js`:

```js
test('one dispatch writes pending, session, events, lines, lastHash and meta in a single storage call', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 300000 });
  const realSet = chrome.storage.local.set.bind(chrome.storage.local);
  const calls = [];
  chrome.storage.local.set = async (obj) => { calls.push(Object.keys(obj).sort()); return realSet(obj); };
  try {
    await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/8', at: 301000 });
  } finally { chrome.storage.local.set = realSet; }
  const want = ['events', 'lastHash', 'lines', 'meta', 'pending', 'session'];
  assert.ok(calls.some(k => want.every(w => k.includes(w))), JSON.stringify(calls));
  assert.equal((await get('meta')).meta.lastSeenAt, 301000);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 302000 });
});
```

- [ ] **Step 2: run** — expected FAIL (no single call carries all six keys).

- [ ] **Step 3: implement** — in `dispatchNow` replace the block from `if (newEvents.length) {` (the pending write) through `await store.patchMeta({ lastSeenAt: input.at });` with:

```js
  const batch = { session: r.session, events, lines, lastHash };
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
  if (endEffect) {
    const { shots: endShots = {} } = await store.get('shots');
    pendingEnd = { outcome: endEffect.outcome, session: endEffect.session, events: [...events], lines: [...lines], shots: endShots };
    // events/lines/shots are cleared here, atomically with the pendingEnd snapshot that now
    // holds them: leaving the live clear for endSession's own (later, possibly much later)
    // final write would risk wiping a NEW session armed in between (see below).
    Object.assign(batch, { events: [], lines: [], shots: {}, meta: { ...batch.meta, pendingEnd } });
  }
  await store.set(batch);
```
Keep everything after (`runEffects`, `flushNow`, the arm-time desktop prompt) unchanged. `meta` is read fresh here because `takeShots` and `setAway` patched it earlier in the same step.

- [ ] **Step 4: verify** — `npm test` (watch `sw-end.test.js` and `sw-startup.test.js`: the pendingEnd snapshot semantics must be unchanged), `npm run check`, `npm run test:integration`.

- [ ] **Step 5: spec §7** — Flush protocol / Storage layout: "each dispatch persists `pending`, `session`, `events`, `lines`, `lastHash` and `meta.lastSeenAt` (plus the END snapshot) in one `storage.local.set`, so a service-worker kill mid-step loses the whole input or nothing."

- [ ] **Step 6: commit**

```bash
git add src/sw.js tests/unit/sw-hardening.test.js docs/superpowers/specs/2026-09-12-exameye-design.md
git commit -m "fix(sw): persist each dispatch in a single storage write"
```

---

## Gated tasks

Each needs the owner's answer in the ledger first. Write the answer as a `Ruling:`/`Owner:` line before starting.

## Task 9 (gated): iframes and shadow DOM (finding 9)

**Gate:** the owner confirms the paper is rendered inside an iframe or web components. If the paper is a plain top-level document, skip this task and record `Owner: paper is top-level; Task 9 skipped`.

**Files:** `src/adapters/scripting.js`, `src/content.js`, `src/sw.js` (the `cs` branch of `onMessage`), `src/core/session.js` (`CS` handler), `tests/unit/adapters.test.js`, `tests/unit/content.test.js`, `tests/unit/sw-listeners.test.js`, `tests/unit/session-hardening.test.js`, spec §5, §9.

**Interfaces:** CS input gains `frameId` (`sender.frameId ?? 0`); `CS_DIRECT` and `DEVTOOLS` events carry `data.frame` when non-zero.

- [ ] **Step 1: failing tests**
- `adapters.test.js`: the registration test expects `allFrames: true`.
- `content.test.js`: (a) a click whose `composedPath()[0]` is a button inside a shadow root sends `END_CLICK` even though `e.target` is the host: `L['doc:click']({ target: { closest: () => null }, composedPath: () => [{ closest: () => ({ innerText: 'Finish' }) }] })`; (b) with `globalThis.window.top = {}` (not `window`) before import, no `resize`/`fullscreenchange`/`visibilitychange`/`blur`/`focus` listener is installed (`L['win:resize']` undefined) while `copy` and `click` still are. Use the `?case=` import trick from `holder.test.js` to load `content.js` a second time with a different `window.top`.
- `sw-listeners.test.js`: a `cs` message with `sender.frameId: 4` produces an input with `frameId: 4`; without it, `0`.
- `session-hardening.test.js`: `cs('COPY', { len: 3 })` with `frameId: 4` emits `COPY{ len: 3, frame: 4 }`; with `frameId: 0` emits `COPY{ len: 3 }`.

- [ ] **Step 2: implement**
- `scripting.js`: `allFrames: true`.
- `content.js`: `const top = window === window.top;` at the top of the IIFE; wrap the `fullscreenchange`, `visibilitychange`, `blur`, `focus`, `resize` listeners and the initial `checkDevtools()` in `if (top) { … }`; click handler uses `const target = e.composedPath?.()[0] ?? e.target; const control = target?.closest?.('button, a, input[type=submit], input[type=button], [role=button]');`.
- `sw.js`: `const input = { kind: 'CS', name: msg.name, data: msg.data, tabId: sender.tab.id, windowId: sender.tab.windowId, frameId: sender.frameId ?? 0, url: sender.url, at: now() };`
- `session.js` `CS` handler: `const data = { ...(input.data || {}), ...(input.frameId ? { frame: input.frameId } : {}) };` and use `data` for the `CS_DIRECT` and `DEVTOOLS` emits.

- [ ] **Step 3: verify** — `npm test`, `npm run check`, `npm run test:integration`. Spec §9: `allFrames:true`; §5: "`frame` is present on clipboard/contextmenu/print/drag/devtools events raised in a sub-frame; the debounced marker check runs in every frame, `SCREEN_CHANGED` duplicates are dropped by the tail hash dedupe (§6)".

- [ ] **Step 4: commit** — `git commit -m "feat(content): run in every frame of the exam page; clicks resolved through composedPath"`.

## Task 10 (gated): arm on an in-progress URL while IDLE (finding 10)

**Gate:** execute only if the owner sets `examPrefix` to the in-paper path (not the origin) **and** confirms that no page under that prefix is visited before the paper starts. With a blank `examPrefix` (the NTA configuration) this task would arm a session on every visit to the site's origin, including after the result page. Record the answer as `Owner: Task 10 yes/no`.

**Files:** `src/core/session.js` (IDLE branch), `src/core/summary-html.js` (`FLAGS`), `tests/unit/session-hardening.test.js`, spec §4, §5, `docs/centre-setup.md` §4 (examPrefix row).

**Interfaces:** `SESSION_ARMED{ url, trigger: 'exam-url' }` followed by `LATE_START{ url }` (no screenshot beyond the arm shot; flag `critical`).

- [ ] **Step 1: failing tests**
```js
test('IDLE + navigation to an in-progress URL arms with trigger exam-url and flags a late start', () => {
  const r = reduce(initial(), nav(41, 'https://e.x/q/3'), cfg);
  assert.equal(r.session.state, 'ARMED');
  assert.deepEqual(names(r), ['SESSION_ARMED', 'LATE_START']);
  assert.equal(r.events[0].data.trigger, 'exam-url');
  assert.deepEqual(r.events[1].data, { url: 'https://e.x/q/3' });
});
test('IDLE + in-progress URL arms even when a start button is configured; result and foreign URLs still do not', () => {
  const withButton = { ...cfg, startButton: 'Start' };
  assert.equal(reduce(initial(), nav(41, 'https://e.x/q/3'), withButton).session.state, 'ARMED');
  assert.equal(reduce(initial(), nav(41, 'https://e.x/result'), cfg).session.state, 'IDLE');
  assert.equal(reduce(initial(), nav(41, 'https://g.x/'), cfg).session.state, 'IDLE');
});
```
- [ ] **Step 2: implement** — in `reduce`'s IDLE branch add a third `else if`:
```js
    } else if (input.kind === 'NAV' && classify(input.url, cfg) === 'exam') {
      arm(s, input, cfg, emit, out, { trigger: 'exam-url' });
      emit('LATE_START', { url: input.url }, input);
    }
```
`FLAGS`: `['LATE_START', 'Late start', 'critical'],`. Spec §4 IDLE transitions; §5 row `| LATE_START | NAV to the in-progress prefix while IDLE (paper resumed after an abandoned or ended session) | url | no |`.
- [ ] **Step 3: verify + commit** — `npm test`, `npm run check`, `npm run test:integration`; `git commit -m "feat(session): arm on an in-progress URL while IDLE and flag the late start"`.

## Task 11 (gated): adopt the active exam-origin tab as the exam tab (finding 11)

**Gate:** the owner confirms the platform does not itself open helper windows or tabs on the exam origin that the candidate flips between during the paper (otherwise every flip logs `EXAM_TAB_CHANGED`). Record as `Owner: Task 11 yes/no`.

**Files:** `src/core/session.js` (`TAB_ACTIVATED`), `src/core/events.js`, `tests/unit/session-hardening.test.js`, spec §4, §5.

**Interfaces:** event `EXAM_TAB_CHANGED{ from, to, url }` (screenshot yes, not a flag).

- [ ] **Step 1: failing tests**
```js
test('activating another tab on the exam origin adopts it; page events from it now count; the old tab is a plain tab', () => {
  let r = reduce(arm().session, activate(42, 3, 'https://e.x/q/1', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CHANGED']);
  assert.deepEqual(r.events[0].data, { from: 41, to: 42, url: 'https://e.x/q/1' });
  assert.equal(r.session.examTabId, 42);
  r = reduce(r.session, cs('COPY', { len: 3 }, 42), cfg);
  assert.deepEqual(names(r), ['COPY']);
  r = reduce(r.session, activate(41, 3, 'https://e.x/q/1', T0 + 3000), cfg);
  assert.deepEqual(names(r), ['EXAM_TAB_CHANGED']);
  assert.equal(r.session.examTabId, 41);
});
test('returning from a parallel page straight into a second exam tab closes the away episode first', () => {
  let r = reduce(arm().session, activate(50, 3, 'https://g.x/', T0 + 1000), cfg);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
  r = reduce(r.session, activate(42, 3, 'https://e.x/q/1', T0 + 5000), cfg);
  assert.deepEqual(names(r), ['TAB_RETURN', 'EXAM_TAB_CHANGED']);
  assert.equal(r.events[0].data.awayMs, 4000);
});
test('a result-URL tab or a foreign tab is never adopted', () => {
  let r = reduce(arm().session, activate(42, 3, 'https://e.x/result', T0 + 1000), cfg);
  assert.equal(r.session.examTabId, 41);
  assert.deepEqual(names(r), ['TAB_SWITCH', 'PARALLEL_PAGE']);
});
```
- [ ] **Step 2: implement** — in `TAB_ACTIVATED`, after the `if (input.tabId === s.examTabId) {…}` block and before `const incognito = …`:
```js
    const cls = classify(input.url, cfg);
    if (cls === 'start' || cls === 'exam') {
      if (s.away.tabAt !== null) { emit('TAB_RETURN', { awayMs: input.at - s.away.tabAt }); s.away.tabAt = null; s.away.tabId = null; s.away.tabUrl = null; }
      emit('EXAM_TAB_CHANGED', { from: s.examTabId, to: input.tabId, url: input.url });
      Object.assign(s, { examTabId: input.tabId, examWindowId: input.windowId, examUrl: input.url, tabLostAt: null });
      out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
      return;
    }
```
(`out` must be added to the handler's parameter list.) `SHOT_EVENTS` += `'EXAM_TAB_CHANGED'`.
- [ ] **Step 3: verify + commit** — `npm test` (existing tests that activate a second exam-origin tab and expect `TAB_SWITCH` must be re-pointed at a foreign URL; check `session-b.test.js`, `sw-shots.test.js`, `sw-focus.test.js`), `npm run check`, `npm run test:integration`; spec §4 TAB_ACTIVATED rule, §5 row; `git commit -m "feat(session): the active exam-origin tab becomes the exam tab; EXAM_TAB_CHANGED"`.

## Task 12 (gated): a result URL in another tab only flags (finding 12)

**Gate:** the owner confirms the platform never opens the result page in a new tab or window. If it does, keep today's behaviour and record `Owner: Task 12 no`.

**Files:** `src/core/session.js` (`NAV`), `src/core/events.js`, `src/core/summary-html.js` (`FLAGS`), `tests/unit/session-hardening.test.js`, every test that ends a session with a result NAV from a non-exam tab (grep `url: 'https://e.x/result'` with a `tabId` other than the exam tab: `sw-dispatch.test.js` ~110, `session-a.test.js`, `session-b.test.js`, `sw-*.test.js`), spec §4, §5, `docs/centre-setup.md` §6 item 9.

**Interfaces:** event `FOREIGN_RESULT_PAGE{ url }` (screenshot yes, flag `critical`); the session stays ARMED.

- [ ] **Step 1: failing tests**
```js
test('a result URL committed in another tab is flagged and the session stays ARMED', () => {
  const r = reduce(arm().session, nav(42, 'https://e.x/result', T0 + 1000), cfg);
  assert.equal(r.session.state, 'ARMED');
  assert.deepEqual(names(r), ['FOREIGN_RESULT_PAGE', 'PARALLEL_PAGE']);
  assert.deepEqual(r.effects, []);
});
```
- [ ] **Step 2: implement** — in `HANDLERS.NAV` replace
```js
    if (s.state !== 'CLOSING' && classify(input.url, cfg) === 'result') {
      emit('RESULT_PAGE', { url: input.url }, input);
      return beginTail(s, out, emit, input, cfg, 'RESULT', 'result', input.url);
    }
```
with `if (classify(input.url, cfg) === 'result') emit('FOREIGN_RESULT_PAGE', { url: input.url }, input);` and let the handler fall through to the parallel-page logic. `SHOT_EVENTS` += `'FOREIGN_RESULT_PAGE'`; `FLAGS` += `['FOREIGN_RESULT_PAGE', 'Result URL in another tab', 'critical'],`.
- [ ] **Step 3: migrate tests** — every test that used a non-exam-tab result NAV to end a session must end it from the exam tab instead (`tabId` = the armed `examTabId`). Update `docs/centre-setup.md` §6 item 9 to: "A result page opened in a different tab does not end the session; it is flagged as `FOREIGN_RESULT_PAGE`. The session ends when the exam tab itself reaches the result URL, on the end button/marker, on the max-time backstop, or on abandon." Spec §4 (NAV from a non-exam tab) and §5 (replace the RESULT_PAGE source "any tab" wording; add the row).
- [ ] **Step 4: verify + commit** — `npm test`, `npm run check`, `npm run test:integration`; `git commit -m "feat(session): a result URL in another tab flags FOREIGN_RESULT_PAGE instead of ending the session"`.

---

## Close-out (after the last executed task)

- [ ] `npm test`, `npm run test:integration`, `npm run check`; `pgrep -fl "ms-playwright/chromium"` empty.
- [ ] Opus review of `7b69173..HEAD` with `/code-review high`; fix findings with tests; re-run the three commands.
- [ ] Push `main`; tell the owner to Reload the extension.
- [ ] Ledger: DONE lines per task, the rulings below, and the owner-verification items (Windows dev-mode bubble; a 3-hour run).

## Rulings made while planning (copy into the ledger when executing)

- Ruling: debounce ceiling is 5 s (`MAX_WAIT_MS`), the trailing wait stays 1 s.
- Ruling: only `subfolder` is frozen at arm; the rest of the config stays live and every change is logged as `CONFIG_CHANGED` (spec §6a promises live `desktopCapture`).
- Ruling: `CLOCK_SLACK_MS` = 5 s; forward jumps stay `EXTENSION_GAP`.
- Ruling: `ensureBoot()` uses the missing `tick` alarm as the "never booted in this enabled lifetime" signature; a boot on first install may run twice (idempotent).
- Ruling: SW to holder traffic uses `chrome.tabs.sendMessage(holderTabId)`; `runtime.sendMessage` is no longer used from the SW.
- Ruling: `EXAM_WINDOW_MOVED` resets `windowState` to `normal` so a fullscreen exit is not faked on the next tick.
- Ruling: Tasks 9 to 12 stay gated; the NTA configuration (blank in-progress prefix) makes Task 10 a likely "no".
