# Update While IDLE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The per-machine updater swaps the ExamEye folder while Chrome runs whenever the extension's session is IDLE, and the extension reloads itself onto the new files the next time it is IDLE.

**Architecture:** The service worker writes a one-word marker file `ExamEye-updater/state.txt` through `chrome.downloads` on every session transition and at Chrome start; the two updater scripts read it from `<home>/Downloads/` and treat `IDLE` as equivalent to "Chrome closed". On every 30 s tick the worker compares the on-disk `manifest.json` version with the running one and calls `chrome.runtime.reload()` when they differ and nothing is in flight.

**Tech Stack:** MV3 service worker (ES modules), `node --test` unit tests with `tests/unit/fake-chrome.js`, Windows batch, POSIX sh.

**Spec:** `docs/superpowers/specs/2026-09-22-update-while-idle-design.md`

## Global Constraints

- Marker filename passed to `chrome.downloads`: exactly `ExamEye-updater/state.txt`; content exactly `IDLE\n`, `ARMED\n` or `CLOSING\n` (text/plain data URL, `conflictAction: 'overwrite'`, `saveAs: false`, i.e. the existing `writeFile`).
- Marker written on: session state change inside `dispatchNow`, `chrome.runtime.onStartup`, `chrome.runtime.onInstalled`. Never on a plain service-worker start (`ensureBoot`).
- Reload only when: on-disk version differs from `chrome.runtime.getManifest().version` AND (no session or `session.state === 'IDLE'`) AND `meta.pendingEnd` is null/undefined AND `pending` has no keys. A failing manifest fetch does nothing.
- Updater gate (both OSes): swap allowed iff Chrome and Edge are not running OR the first line of `<home>/Downloads/ExamEye-updater/state.txt` is exactly `IDLE`. Skip log line: `skipped <latest>: chrome running (<ARMED|CLOSING|no state>)`.
- Windows script stays plain batch (policy blocks `.ps1`); CRLF is applied by `tools/build-installer.mjs`, not by hand.
- Do not commit or push unless the owner has said so for this plan; each task's commit step is the intended commit once that permission exists.
- `npm run check && npm test` must pass after every task (341 tests today).

---

### Task 1: State marker written by the service worker

**Files:**
- Modify: `src/sw.js` (constants near line 30; `dispatchNow` around line 86 and line 150; `installed` and the `onStartup` listener around lines 523-530)
- Modify: `tests/unit/sw-flush.test.js:20-30`
- Create: `tests/unit/sw-update.test.js`

**Interfaces:**
- Consumes: `writeFile(filename, url)` from `src/adapters/downloads.js`; `dataUrl(mime, b64)`, `toBase64(text)` from `src/core/sink.js`; `store.get`, `store.patchMeta` from `src/adapters/storage.js`.
- Produces: module-private `STATE_FILE = 'ExamEye-updater/state.txt'`, `writeState(state)`, `writeStateNow()` in `src/sw.js`. Task 2 adds to the same test file.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sw-update.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome } from './fake-chrome.js';

const chrome = installFakeChrome();
const config = { startPrefix: 'https://e.x/start', examPrefix: '', resultPrefix: 'https://e.x/result', seat: 'A17', subfolder: 'ExamEye', shotIntervalMin: 10, abandonMin: 10, startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 5, desktopCapture: 'off', desktopRepromptMin: 5 };
await chrome.storage.local.set({ config });
const sw = await import('../../src/sw.js');
chrome.windows.list = [{ id: 3, focused: true, state: 'normal' }];
chrome.tabs.list = [{ id: 1, windowId: 3, url: 'https://e.x/start', title: 'Exam', incognito: false, active: true }];
const STATE = 'ExamEye-updater/state.txt';
const decode = (url) => Buffer.from(url.split(',')[1], 'base64').toString('utf8');
const markers = () => chrome.downloads.calls.filter(c => c.filename === STATE).map(c => decode(c.url));
const later = () => new Promise((r) => setTimeout(r, 30));

test('a plain worker start does not write the state marker', async () => {
  await later();
  await sw.settled();
  assert.deepEqual(markers(), []);
});

test('onInstalled writes the current state (IDLE with no session)', async () => {
  await chrome.runtime.onInstalled.emit({ reason: 'update' });
  await later();
  await sw.settled();
  assert.deepEqual(markers(), ['IDLE\n']);
});

test('the marker is written on every session transition, once, with the new state', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 1000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n']);
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/q/1', at: 2000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n'], 'an event without a state change writes nothing');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: 3000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n', 'CLOSING\n']);
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: 4000 });
  assert.deepEqual(markers(), ['IDLE\n', 'ARMED\n', 'CLOSING\n', 'IDLE\n']);
  const last = chrome.downloads.calls.filter(c => c.filename === STATE).at(-1);
  assert.equal(last.conflictAction, 'overwrite');
  assert.equal(last.saveAs, false);
  assert.match(last.url, /^data:text\/plain;base64,/);
});

// recover() on onStartup stamps meta.lastSeenAt with the wall clock, so every later input in this
// file uses Date.now() rather than a small fixed timestamp (a fixed one would read as clock skew).
test('onStartup rewrites the marker from the stored session (a crash while ARMED leaves a stale file)', async () => {
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: 5000 });
  const n = markers().length;
  chrome.runtime.onStartup.emit();
  await later();
  await sw.settled();
  assert.deepEqual(markers().slice(n), ['ARMED\n']);
});

test('a refused marker write records meta.lastError and does not stop the session', async () => {
  chrome.downloads.failWhen = (o) => o.filename === STATE;
  try {
    await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: Date.now() });
  } finally { chrome.downloads.failWhen = null; }
  const { session, meta } = await chrome.storage.local.get(['session', 'meta']);
  assert.equal(session.state, 'CLOSING');
  assert.match(meta.lastError, /state marker/);
  assert.ok(chrome.downloads.calls.some(c => c.filename.endsWith('/log.txt') && decode(c.url).includes('SESSION_DISARMED')), 'the disarm was still flushed');
});
```

Check the `TAB_REMOVED` input shape and the disarm event name before relying on them:

Run: `grep -n "TAB_REMOVED\|SESSION_DISARMED" src/core/session.js src/sw.js | head`
Expected: `TAB_REMOVED` handled in the reducer; `SESSION_DISARMED` emitted on the result page. If the CLOSING→IDLE input is named differently, use the one the reducer handles (the `sw-end.test.js` file shows a working CLOSING→IDLE sequence to copy).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/unit/sw-update.test.js`
Expected: FAIL — `markers()` is `[]` in the onInstalled and transition tests (no marker code yet).

- [ ] **Step 3: Implement the marker in `src/sw.js`**

Add next to the other constants (after the `NAV_BORN` line ~33):

```js
// Read by installer/Update-ExamEye.cmd and update-exameye.sh from <home>/Downloads: the updater
// may swap the extension folder under a running Chrome only while the session is IDLE.
const STATE_FILE = 'ExamEye-updater/state.txt';
```

Add these two functions above `dispatchNow`:

```js
async function writeState(state) {
  try { await writeFile(STATE_FILE, dataUrl('text/plain', toBase64(`${state}\n`))); }
  catch (e) { await store.patchMeta({ lastError: `${new Date().toISOString()} state marker: ${e?.message || e}` }); }
}

async function writeStateNow() {
  const { session } = await store.get('session');
  await writeState(session?.state ?? 'IDLE');
}
```

In `dispatchNow`, right after `let session = st.session || initial();` add:

```js
  const prevState = session.state;
```

and right after `await store.set(batch);` add:

```js
  if (r.session.state !== prevState) await writeState(r.session.state);
```

Change `installed`:

```js
async function installed(d) {
  const reason = d?.reason;
  if (reason === 'install') await seedDefaults();
  await boot();
  await enqueue(writeStateNow);
  if (reason === 'install') await chrome.runtime.openOptionsPage();
}
```

Change the `onStartup` listener:

```js
chrome.runtime.onStartup.addListener(() => { recover(); enqueue(writeStateNow); return boot(); });
```

(`recover()` is itself enqueued, so the marker write runs after the recovered session is stored.)

- [ ] **Step 4: Run the new tests**

Run: `node --test tests/unit/sw-update.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Fix the one existing test that lists every download call**

In `tests/unit/sw-flush.test.js` the test `every event flushes log.txt and new screenshots under <subfolder>/<sessionId>/` asserts on `chrome.downloads.calls` positionally; the marker is now among them. Replace lines 24-27 with:

```js
  const files = chrome.downloads.calls.filter(c => c.filename !== 'ExamEye-updater/state.txt');
  const names = files.map(c => c.filename);
  assert.deepEqual(names, [`ExamEye/${session.id}/log.txt`, `ExamEye/${session.id}/screenshots/${session.id.slice(0, 15)}_SESSION_ARMED.jpg`]);
  assert.match(decode(files[0].url), /^# ExamEye session .*\n.* SESSION_ARMED .*\n$/);
  assert.equal(files[1].url, 'data:image/jpeg;base64,/9j/FAKE');
```

- [ ] **Step 6: Run the whole suite**

Run: `npm run check && npm test`
Expected: all pass (346 tests). If `tests/unit/sw-hardening.test.js:30` (`calls.at(-1).filename.startsWith(...)`) fails because the marker is the last call, apply the same filter there: `const own = chrome.downloads.calls.filter(c => c.filename !== 'ExamEye-updater/state.txt'); assert.ok(own.at(-1).filename.startsWith(...))`. Do not touch any other test.

- [ ] **Step 7: Commit**

```bash
git add src/sw.js tests/unit/sw-update.test.js tests/unit/sw-flush.test.js tests/unit/sw-hardening.test.js
git commit -m "feat(sw): write ExamEye-updater/state.txt on session transitions and at Chrome start so the updater can swap while IDLE"
```

---

### Task 2: Service worker reloads itself onto a swapped folder when IDLE

**Files:**
- Modify: `tests/unit/fake-chrome.js:11-15` (add `runtime.reload`)
- Modify: `src/sw.js` (`tick` around line 435, `dispatchNow` tail, new `reloadIfUpdatedNow`)
- Modify: `tests/unit/sw-update.test.js` (append tests)

**Interfaces:**
- Consumes: `writeState` / `prevState` from Task 1; `chrome.runtime.getURL`, `chrome.runtime.getManifest`, `chrome.runtime.reload`.
- Produces: `reloadIfUpdatedNow()` in `src/sw.js`, called at the end of `tick()` and after a transition to IDLE in `dispatchNow`.

- [ ] **Step 1: Add `reload` to the fake**

In `tests/unit/fake-chrome.js`, inside `runtime: {` after `getManifest: () => ({ version: '0.1.0' }),` add:

```js
      reloads: 0, reload() { c.runtime.reloads += 1; },
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/unit/sw-update.test.js`:

```js
const withDisk = (version) => { globalThis.fetch = async (url) => { if (!String(url).endsWith('/manifest.json')) throw new Error('unexpected ' + url); if (version === null) throw new Error('ENOENT'); return { json: async () => ({ version }) }; }; };
const state = async () => (await chrome.storage.local.get('session')).session?.state ?? 'IDLE';

test('tick does not reload when the on-disk version matches the running one', async () => {
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: Date.now() });
  assert.equal(await state(), 'IDLE');
  withDisk('0.1.0');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 0);
});

test('tick reloads when the on-disk version differs and the session is IDLE with nothing pending', async () => {
  withDisk('0.1.9');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1);
});

test('no reload while ARMED or CLOSING; the transition to IDLE reloads without waiting for a tick', async () => {
  withDisk('0.1.9');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() });
  assert.equal(await state(), 'ARMED');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1, 'ARMED');
  await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/result', at: Date.now() });
  assert.equal(await state(), 'CLOSING');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 1, 'CLOSING');
  await sw.dispatch({ kind: 'TAB_REMOVED', tabId: 1, windowId: 3, at: Date.now() });
  await sw.settled();
  assert.equal(await state(), 'IDLE');
  assert.equal(chrome.runtime.reloads, 2, 'IDLE transition');
});

test('no reload while files are still pending', async () => {
  withDisk('0.1.9');
  await chrome.storage.local.set({ pending: { 'ExamEye/x/log.txt': { mime: 'text/plain', b64: 'aGk=' } } });
  chrome.downloads.failWhen = (o) => o.filename.endsWith('/log.txt');
  try { await sw.tick(); await sw.settled(); } finally { chrome.downloads.failWhen = null; }
  assert.equal(chrome.runtime.reloads, 2);
  await sw.flush();
  assert.deepEqual((await chrome.storage.local.get('pending')).pending, {});
});

// tick() replays meta.pendingEnd before the reload check, so the only way it is still set at
// check time is a replay that could not run: no valid config. Hide the config for that one tick.
test('no reload while a session end is unfinished', async () => {
  withDisk('0.1.9');
  const { meta, config } = await chrome.storage.local.get(['meta', 'config']);
  await chrome.storage.local.set({ meta: { ...meta, pendingEnd: { outcome: 'closed', session: { id: 'zz', state: 'IDLE', subfolder: 'ExamEye', seat: 'A17' }, events: [], lines: [], shots: {} } }, config: null });
  await sw.settled();
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 2);
  await chrome.storage.local.set({ meta: { ...(await chrome.storage.local.get('meta')).meta, pendingEnd: null }, config });
  await sw.settled();
});

test('a failing manifest read (file mid-rename) is ignored until the next tick', async () => {
  withDisk(null);
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 2);
  withDisk('0.1.9');
  await sw.tick();
  await sw.settled();
  assert.equal(chrome.runtime.reloads, 3);
});
```

`sw.tick()` returns early from its `dispatch` when `loadConfig()` finds no valid config, which is why hiding the config keeps `pendingEnd` in place for the guard to see; the reload check must therefore sit at the end of `tick()` itself, not inside `dispatchNow`. Setting `config: null` also fires the `storage.onChanged` listener (`applyConfig`), which unregisters the content script and re-registers it when the config is restored; the two `sw.settled()` calls let that finish.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/unit/sw-update.test.js`
Expected: FAIL — `chrome.runtime.reloads` stays 0 in the "differs and IDLE" test.

- [ ] **Step 4: Implement the reload check in `src/sw.js`**

Add below `writeStateNow`:

```js
// The updater (installer/Update-ExamEye.cmd, update-exameye.sh) swaps the folder under a running
// Chrome; an unpacked extension keeps serving the old worker until it reloads itself, and only
// an idle one with nothing left to write may.
async function reloadIfUpdatedNow() {
  let disk;
  try { disk = (await (await fetch(chrome.runtime.getURL('manifest.json'))).json()).version; } catch { return; }
  if (disk === chrome.runtime.getManifest().version) return;
  const { session, meta = {}, pending = {} } = await store.get(['session', 'meta', 'pending']);
  if ((session && session.state !== 'IDLE') || meta.pendingEnd || Object.keys(pending).length) return;
  chrome.runtime.reload();
}
```

At the end of `tick()` (after `await flush();`) add:

```js
  await enqueue(reloadIfUpdatedNow);
```

In `dispatchNow`, change the Task 1 line to:

```js
  if (r.session.state !== prevState) {
    await writeState(r.session.state);
    if (r.session.state === 'IDLE') enqueue(reloadIfUpdatedNow);
  }
```

(`enqueue` without `await`: the check runs as its own step after this dispatch has finished its flush, so the final files of the ended session are written before the reload.)

- [ ] **Step 5: Run the new tests**

Run: `node --test tests/unit/sw-update.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Run the whole suite**

Run: `npm run check && npm test`
Expected: all pass. Other test files stub `globalThis.fetch` narrowly or leave Node's own `fetch`, which rejects `chrome-extension://` URLs; both paths hit the `catch { return; }` and change nothing.

- [ ] **Step 7: Commit**

```bash
git add src/sw.js tests/unit/fake-chrome.js tests/unit/sw-update.test.js
git commit -m "feat(sw): reload onto a swapped extension folder when IDLE with nothing pending"
```

---

### Task 2b: Retry a refused marker write on the next tick

**Why (ruling from Task 1 review):** `writeState` is one-shot. If the `ARMED\n` write is refused, the file on disk still says `IDLE\n` during a live exam — the one failure that would let the updater swap mid-exam. The tick already runs every 30 s; make it re-sync the marker when the last successful write does not match the session state.

**Files:**
- Modify: `src/sw.js` (`writeState`, new `resyncStateNow`, `tick`)
- Modify: `tests/unit/sw-update.test.js` (append two tests at the end)

**Interfaces:**
- Consumes: `writeState(state)`, `writeStateNow()`, `tick()`, `reloadIfUpdatedNow` from Tasks 1-2; `store.patchMeta`.
- Produces: `meta.markerState` = the state word of the last marker write that succeeded; `resyncStateNow()`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/sw-update.test.js`:

```js
test('a refused marker write is retried on the next tick', async () => {
  withDisk('0.1.0');
  const before = markers().length;
  chrome.downloads.failWhen = (o) => o.filename === STATE;
  try { await sw.dispatch({ kind: 'NAV', tabId: 1, windowId: 3, url: 'https://e.x/start', at: Date.now() }); } finally { chrome.downloads.failWhen = null; }
  assert.equal(await state(), 'ARMED');
  assert.equal(markers().length, before + 1, 'the refused attempt is recorded by the fake but was rejected');
  assert.notEqual((await chrome.storage.local.get('meta')).meta.markerState, 'ARMED');
  await sw.tick();
  await sw.settled();
  assert.equal(markers().at(-1), 'ARMED\n');
  assert.equal((await chrome.storage.local.get('meta')).meta.markerState, 'ARMED');
});

test('a tick does not rewrite a marker that already matches the session', async () => {
  const n = markers().length;
  await sw.tick();
  await sw.settled();
  assert.equal(markers().length, n);
});
```

Check first how the fake records a refused download: `grep -n "failWhen" tests/unit/fake-chrome.js`. If `failWhen` throws *before* pushing to `calls`, change the `before + 1` assertion to `before` (the refused attempt is not recorded). Do not change anything else in the test.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/unit/sw-update.test.js`. Expected: the first new test fails (`markerState` undefined / marker not rewritten).

- [ ] **Step 3: Implement in `src/sw.js`**

Change `writeState` so a successful write remembers what is on disk:

```js
async function writeState(state) {
  try {
    await writeFile(STATE_FILE, dataUrl('text/plain', toBase64(`${state}\n`)));
    await store.patchMeta({ markerState: state });
  } catch (e) { await store.patchMeta({ lastError: `${new Date().toISOString()} state marker: ${e?.message || e}` }); }
}
```

Add below `writeStateNow`:

```js
// A refused write (download blocked, disk full) would otherwise leave a stale IDLE on disk for
// the whole exam — exactly the file the updater trusts.
async function resyncStateNow() {
  const { session, meta = {} } = await store.get(['session', 'meta']);
  const state = session?.state ?? 'IDLE';
  if (meta.markerState !== state) await writeState(state);
}
```

In `tick()`, before the existing `await enqueue(reloadIfUpdatedNow);` add `await enqueue(resyncStateNow);`.

`writeStateNow` (onStartup/onInstalled) stays unconditional: the file may be missing or hand-deleted even when `markerState` matches.

- [ ] **Step 4: Run the file** — `node --test tests/unit/sw-update.test.js`. Expected: PASS. Earlier tests in the file that call `sw.tick()` may now show one extra marker download where the state on disk lagged; if an earlier assertion on `markers()` breaks, report it rather than loosening it.

- [ ] **Step 5: Full suite** — `npm run check && npm test`. Expected: all pass (354).

- [ ] **Step 6: Commit**

```bash
git add src/sw.js tests/unit/sw-update.test.js
git commit -m "feat(sw): re-sync the state marker on tick when a write was refused"
```

---

### Task 3: Windows updater swaps while the marker says IDLE

**Files:**
- Modify: `installer/Update-ExamEye.cmd:5,33,47,87-90`

**Interfaces:**
- Consumes: `%USERPROFILE%\Downloads\ExamEye-updater\state.txt` written by Task 1.
- Produces: `:gate` label that sets `SKIP` (empty when the swap may proceed, else the reason text).

- [ ] **Step 1: Read the current gate**

Run: `sed -n 1,15p installer/Update-ExamEye.cmd; sed -n 85,92p installer/Update-ExamEye.cmd`
Expected: header comment mentions "Chrome is closed"; `:chrome` label uses `tasklist` for `chrome.exe` and `msedge.exe`; two `call :chrome && (... skipped ...)` lines at 33 and 47.

- [ ] **Step 2: Replace the gate**

Change the header comment line 5 to:

```bat
rem Chrome is closed or ExamEye's own marker says its session is IDLE, so a running exam never sees mixed files. Log: %USERPROFILE%\ExamEye-updater\update.log
```

After `set "DIR=%USERPROFILE%\ExamEye-updater"` add:

```bat
set "STATE=%USERPROFILE%\Downloads\ExamEye-updater\state.txt"
```

Replace both lines

```bat
call :chrome && (call :log "skipped %LATEST%: chrome running" & goto :cleanup)
```

with

```bat
call :gate
if defined SKIP (call :log "skipped %LATEST%: chrome running (%SKIP%)" & goto :cleanup)
```

Replace the `:chrome` label block with:

```bat
rem SKIP is empty when the swap may go ahead: no browser running, or the extension's marker says IDLE
:gate
set "SKIP="
call :chrome || exit /b 0
set "SKIP=no state"
if not exist "%STATE%" exit /b 0
for /f "usebackq delims=" %%l in ("%STATE%") do (set "SKIP=%%l" & goto :gateread)
:gateread
if "%SKIP%"=="IDLE" set "SKIP="
exit /b 0

:chrome
tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | find /I "chrome.exe" >nul && exit /b 0
tasklist /FI "IMAGENAME eq msedge.exe" /NH 2>nul | find /I "msedge.exe" >nul && exit /b 0
exit /b 1
```

Keep the existing final `exit /b 1` of `:chrome` if it is already there (do not duplicate it). The `for /f` reads only the first line and stops; an empty file leaves `SKIP=no state`.

- [ ] **Step 3: Syntax sanity check on macOS**

Batch cannot run here; check the structure by eye and by grep:

Run: `grep -n ":gate\|:chrome\|SKIP\|STATE" installer/Update-ExamEye.cmd`
Expected: `STATE` set once; `call :gate` twice; `:gate` and `:chrome` labels once each; no remaining `call :chrome &&` lines.

- [ ] **Step 4: Run the packaging test**

Run: `npm test -- tests/unit/build-installer.test.js` (or `node --test tests/unit/build-installer.test.js`)
Expected: PASS (CRLF conversion and packaging of the `.cmd` still succeed).

- [ ] **Step 5: Commit**

```bash
git add installer/Update-ExamEye.cmd
git commit -m "feat(updater): Windows swap allowed while Chrome runs if the ExamEye marker says IDLE"
```

---

### Task 4: macOS updater swaps while the marker says IDLE

**Files:**
- Modify: `installer/update-exameye.sh:3,16,36,50`

**Interfaces:**
- Consumes: `$HOME/Downloads/ExamEye-updater/state.txt` written by Task 1.
- Produces: `gate()` function that prints nothing and returns 0 when the swap may proceed, else prints the reason and returns 1.

- [ ] **Step 1: Replace the gate**

Change the comment on line 3 to say the swap happens "only while Chrome is closed or ExamEye's marker says its session is IDLE".

Replace

```sh
chrome_running() { pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'; }
```

with

```sh
STATE="$HOME/Downloads/ExamEye-updater/state.txt"
chrome_running() { pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'; }
# prints nothing and returns 0 when the swap may go ahead: no browser running, or the marker says IDLE
gate() {
  chrome_running || return 0
  local state
  state=$(head -n 1 "$STATE" 2>/dev/null)
  [ "$state" = IDLE ] && return 0
  printf '%s' "${state:-no state}"
  return 1
}
```

Replace both lines

```sh
chrome_running && { log "skipped $latest: chrome running"; exit 0; }
```

with

```sh
why=$(gate) || { log "skipped $latest: chrome running ($why)"; exit 0; }
```

- [ ] **Step 2: Exercise the gate locally**

Run in the scratchpad (do not touch `~/Downloads`):

```bash
cd /private/tmp/claude-501/-Users-pawank-DiskAlpha-Development-exameye/75578c83-9458-48a2-8720-325d7cdde143/scratchpad && mkdir -p home/Downloads/ExamEye-updater && sh -c '
STATE="$PWD/home/Downloads/ExamEye-updater/state.txt"
chrome_running() { return 0; }
gate() { chrome_running || return 0; local state; state=$(head -n 1 "$STATE" 2>/dev/null); [ "$state" = IDLE ] && return 0; printf "%s" "${state:-no state}"; return 1; }
rm -f "$STATE"; why=$(gate) && echo "missing: proceed (BUG)" || echo "missing: skip ($why)"
printf "ARMED\n" > "$STATE"; why=$(gate) && echo "ARMED: proceed (BUG)" || echo "ARMED: skip ($why)"
printf "IDLE\n" > "$STATE"; why=$(gate) && echo "IDLE: proceed" || echo "IDLE: skip (BUG)"
: > "$STATE"; why=$(gate) && echo "empty: proceed (BUG)" || echo "empty: skip ($why)"
'
```

Expected output, in order: `missing: skip (no state)`, `ARMED: skip (ARMED)`, `IDLE: proceed`, `empty: skip (no state)`.

- [ ] **Step 3: Syntax check and packaging test**

Run: `sh -n installer/update-exameye.sh && node --test tests/unit/build-installer.test.js`
Expected: no output from `sh -n`; packaging test PASS.

- [ ] **Step 4: Commit**

```bash
git add installer/update-exameye.sh
git commit -m "feat(updater): macOS swap allowed while Chrome runs if the ExamEye marker says IDLE"
```

---

### Task 5: Documentation of the IDLE rule

**Files:**
- Modify: `installer/READ-ME-FIRST.txt:18-23`
- Modify: `docs/centre-setup.md:16`

- [ ] **Step 1: READ-ME-FIRST**

Replace the "Automatic updates" paragraph with:

```
Automatic updates
  The installer registers a job that runs at logon and once an hour. It downloads a newer release
  when there is one and replaces the ExamEye folder only while Chrome is closed or while ExamEye
  is idle (no exam armed or closing), so a running exam is never touched. ExamEye reports its
  state in <home>\Downloads\ExamEye-updater\state.txt (IDLE, ARMED or CLOSING); an idle ExamEye
  reloads itself onto the new version within a minute, otherwise right after the exam ends. The
  ExamEye popup shows the running version. Log: <home>\ExamEye-updater\update.log (one line per
  run; "skipped ...: chrome running (ARMED)" means it is waiting for the exam to end).
  The updater owns <home>\ExamEye.new and <home>\ExamEye.old and deletes them; do not keep a backup under those names.
```

Also in "Publish a new version (owner)" change `on one Windows PC with Chrome closed, run the updater by hand` to `on one Windows PC with Chrome open and ExamEye idle, run the updater by hand`.

- [ ] **Step 2: centre-setup.md**

In `docs/centre-setup.md:16` replace `**and Chrome is closed**` with `**and Chrome is closed or ExamEye's marker (\`<home>/Downloads/ExamEye-updater/state.txt\`) says IDLE**`, and append to the same bullet: `A running ExamEye reloads itself onto the swapped folder at its next idle 30 s tick. Design: \`docs/superpowers/specs/2026-09-22-update-while-idle-design.md\`.`

- [ ] **Step 3: Packaging test (READ-ME-FIRST is shipped in the zip)**

Run: `node --test tests/unit/build-installer.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add installer/READ-ME-FIRST.txt docs/centre-setup.md
git commit -m "docs: updater swaps while ExamEye is idle; name the state marker and the reload behaviour"
```

---

### Task 6: Verification on the Windows PC (owner, after the next release)

Not code; the acceptance test for the whole change and the only way to learn whether Windows lets the folder be renamed under a running Chrome.

- [ ] **Step 1:** Run the GitHub "Release" workflow on `main`; note the new version `v0.1.<n>`.
- [ ] **Step 2:** On the Windows PC with Chrome **open** and the popup showing `IDLE`, run `schtasks /Run /TN "ExamEye Update"`, wait 30 s, read `%USERPROFILE%\ExamEye-updater\update.log`.
  Expected: `updated <old> -> 0.1.<n>`; within a minute the popup shows `Installed version 0.1.<n>`.
  If the log says `failed: swap`: Windows refused the rename under a running Chrome; the live folder is untouched. Report the line back — the swap technique needs a follow-up design (copy-over instead of rename, or a Chrome-closed retry), and this plan's Tasks 1-5 stay valid.
- [ ] **Step 3:** Arm a session (open the start URL), run the task again.
  Expected: `skipped 0.1.<n>: chrome running (ARMED)` — no change to the folder.
