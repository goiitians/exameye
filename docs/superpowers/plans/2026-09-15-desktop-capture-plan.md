# ExamEye Desktop Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When focus leaves Chrome during a paper, record JPEG frames of the whole screen: one at `FOCUS_LEFT_CHROME`, one every 10 s while away (hash-deduped, 3 s min gap, max 40 per episode), one at `FOCUS_RETURNED`, one per `PERIODIC`. The candidate grants the screen once through Chrome's own share dialog, opened without any invigilator click. Declines, stops and failures are logged and re-asked per policy. Session logic is untouched.

**Architecture:** Unchanged (spec §2): `src/core/*` pure, `src/adapters/*` thin, `src/sw.js` serialised queue (every storage writer runs inside `enqueue`; `dispatchNow` inside the queue; never call `dispatch()` from inside a queued step). New: `src/holder/holder.html` + `holder.js`, an extension page in its own popup window that **both requests the stream id (`chrome.desktopCapture.chooseDesktopMedia`) and consumes it (`getUserMedia`)** — the id is bound to the page that asked for it. **The SW never calls `chooseDesktopMedia`.** Holder ↔ SW traffic is `chrome.runtime` messages: holder → SW `{type:'desktop', name}` (`ready`, `started`, `cancelled`, `failed`, `ended`, `frame`), SW → holder `{type:'holder', name}` (`ask`, `grab`, `ping`, `away`).

**Spec:** `/Users/pawank/DiskAlpha/Development/exameye/docs/superpowers/specs/2026-09-12-exameye-design.md` — already updated (§2, §3, §4 inputs, §5, **§6a**, §7, §8, §9, §10, §11, §12, §13, §14). Read §6a first; every task cites what it implements. Owner decisions: `/Users/pawank/DiskAlpha/Development/exameye/.superpowers/sdd/2026-09-13-test-finish/desktop-capture-brief.md` (final). The spike branch `spike/desktop-capture` is throwaway; do not cherry-pick from it.

## Global constraints

- TDD: write the named failing test, run it and see it fail, then the minimal code, then the full command. `npm test`, `npm run test:integration`, `npm run check` run in the **foreground**; read the real output before ticking a step. `npm run check` must list `src/holder/holder.js` once it exists (Task 7 edits `package.json`).
- Each task leaves `npm test` and `npm run check` green (integration runs in Task 13 only). Each task ends with a ready-to-run commit command; do **not** run it unless the owner says so.
- Fixtures: every `cfg`/`config` constant in `tests/unit/sw-*.test.js`, `options.test.js`, `popup.test.js` and `tests/integration/session.test.js` gets `desktopCapture: 'off', desktopRepromptMin: 5` appended (Task 1). New desktop tests set `desktopCapture: 'on'` explicitly and install `chrome.desktopCapture = {}` on the fake **before** importing `sw.js`; the fake never defines it by default, so existing SW tests can never open a holder.
- Time: SW code uses `now()`; tests drive `at` explicitly where the reducer/core is called directly and `Date.now()` mocking (`node:test` `mock.timers`) only in the holder test.
- No emojis. No comments unless the WHY is non-obvious. Surgical diffs; do not reformat neighbouring code.
- Windows first: no code path may depend on macOS behaviour; macOS is documentation only (Task 14).

## File map

| Path | Change |
|---|---|
| `manifest.json`, `tests/unit/manifest.test.js` | permission `desktopCapture` |
| `src/core/config.js` | `DEFAULTS`/`STR`/`NUM` gain `desktopCapture`, `desktopRepromptMin`; `validate` rules |
| `src/core/events.js`, `src/core/ids.js` | `SHOT_EVENTS` + 4 names; `needsDesktopFrame`; `desktopShotFile` |
| `src/core/desktop.js` (new) | `EMPTY_DESKTOP`, `shouldPrompt`, `onHolder`, `describeDesktop` |
| `src/core/session.js` | `HANDLERS.DESKTOP` |
| `src/core/counters.js` | `tally.desktop` |
| `src/core/summary-text.js`, `summary-html.js` | `describeDesktopSummary`, `Desktop:` line, Desktop capture section, desktop column, desktop files in the screenshots section |
| `src/holder/holder.html`, `src/holder/holder.js` (new) | the holder page |
| `src/adapters/desktop.js` (new) | `supported`, `holderUrl`, `openHolder`, `showWindow`, `minimizeWindow`, `closeWindow`, `grabDesktop`, `pingHolder`, `setAway`, `askHolder` |
| `tests/unit/fake-chrome.js` | `runtime.sendMessage/getURL`, `windows.create/update/remove` |
| `src/sw.js` | holder-input filter, `desktopMessage`, `promptDesktop`/`askNow`, `applyHolder`, arm hook, `takeShots` desktop branch, away messages, `desktopFrame`, tick ping, `desktopAsk` alarm, END close, config sync, `recover()` reset |
| `src/popup/popup.html`, `popup.js`, `src/options/options.html` | desktop line; two fields |
| `tests/integration/harness.js`, `session.test.js` | `launch(config, { args })`; one new scenario |
| `docs/centre-setup.md` | §4 rows, dry-run steps, macOS permission, candidate notice |

---

## Task 1: config fields, manifest permission, fixtures (spec §3, §9)

**Files:** `src/core/config.js`, `tests/unit/config.test.js`, `manifest.json`, `tests/unit/manifest.test.js`, the fixture files listed in Global constraints.

- [ ] Append `desktopCapture: 'off', desktopRepromptMin: 5` to every existing fixture config; run `npm test` — must stay green (normalize already tolerates unknown keys; this makes the intent explicit).
- [ ] Failing tests (`config.test.js`, `good` extended with `desktopCapture: 'on', desktopRepromptMin: 5`):
  - `'desktop fields default on / 5'` — `normalize({})` has `desktopCapture 'on'`, `desktopRepromptMin 5`; `normalize({ desktopRepromptMin: '0' })` gives `0`.
  - `'desktopCapture must be on or off'` — `'yes'` → fields `['desktopCapture']`; `'OFF'` → `['desktopCapture']` (exact lower-case strings only).
  - `'desktopRepromptMin integer 0-60'` — `-1`, `61`, `2.5` → `['desktopRepromptMin']`; `0` valid.
  - `manifest.test.js`: expected permissions array ends with `'scripting', 'desktopCapture'`.
- [ ] Implement: `DEFAULTS` + `STR` gain `desktopCapture: 'on'`; `DEFAULTS` + `NUM` gain `desktopRepromptMin: 5`; `validate`: `if (cfg.desktopCapture !== 'on' && cfg.desktopCapture !== 'off')` → `'on or off'`; integer 0–60 rule. `manifest.json` permissions: append `"desktopCapture"`.
- [ ] Verify: `npm test`, `npm run check`.
- [ ] Commit: `git add manifest.json src/core/config.js tests/unit/config.test.js tests/unit/manifest.test.js tests/unit/sw-*.test.js tests/unit/options.test.js tests/unit/popup.test.js tests/integration/session.test.js && git commit -m "feat(config): desktopCapture and desktopRepromptMin; desktopCapture permission"`

## Task 2: event catalogue and file names (spec §5, §6a)

**Files:** `src/core/events.js`, `src/core/ids.js`, `tests/unit/events.test.js`, `tests/unit/ids.test.js`.

- [ ] Failing tests:
  - `'needsShot true for the four DESKTOP_CAPTURE_* events, false for DESKTOP_FRAME'`.
  - `'needsDesktopFrame true for FOCUS_LEFT_CHROME, FOCUS_RETURNED, PERIODIC, DESKTOP_FRAME; false for TAB_SWITCH and SESSION_ARMED'`.
  - `ids.test.js`: `'desktopShotFile puts frames under screenshots/desktop/'` — `desktopShotFile(t, 'PERIODIC')` matches `/^screenshots\/desktop\/\d{8}-\d{6}_PERIODIC\.jpg$/` and equals `shotFile(t, 'PERIODIC').replace('screenshots/', 'screenshots/desktop/')`.
- [ ] Implement: add `DESKTOP_CAPTURE_STARTED`, `DESKTOP_CAPTURE_DECLINED`, `DESKTOP_CAPTURE_STOPPED`, `DESKTOP_CAPTURE_FAILED` to `SHOT_EVENTS`; `export const DESKTOP_FRAME_EVENTS = new Set([...4 names above])` and `needsDesktopFrame = (ev) => DESKTOP_FRAME_EVENTS.has(ev.name)`; `ids.desktopShotFile(date, eventName)`.
- [ ] Verify: `npm test`. Commit: `git add src/core/events.js src/core/ids.js tests/unit/events.test.js tests/unit/ids.test.js && git commit -m "feat(events): desktop capture events and desktop frame file names"`

## Task 3: desktop state module (spec §6a State, Trigger and re-prompt)

**Files:** `src/core/desktop.js` (new), `tests/unit/desktop.test.js` (new).

API (pure, never mutates its argument):
- `EMPTY_DESKTOP = { state:'off', at:0, since:null, holderWindowId:null, asks:0, width:null, height:null, error:null, nextAskAt:null }`.
- `shouldPrompt(desktop, { at, repromptMin })` → boolean: true for `off`/`stopped`/`error`; for `declined` only when `repromptMin > 0 && at - desktop.at >= repromptMin * 60000`; false for `prompting`/`on`; `undefined` desktop = `EMPTY_DESKTOP`.
- `onHolder(desktop, msg, { at, repromptMin })` → `{ desktop, input, effects }` where `input` is a `DESKTOP` reducer input (`{ kind:'DESKTOP', name, data, at }`) or `null`, `effects` is an array of `{ type }`:
  - `started{width,height,pickMs}` → `on`, `since: at`, `error:null`, `nextAskAt:null`; input `STARTED{width,height,pickMs}`; effects `[{type:'MINIMIZE'}, {type:'ASK_ALARM_CLEAR'}]`.
  - `cancelled{pickMs}` → `declined`, `nextAskAt = repromptMin > 0 ? at + repromptMin*60000 : null`; input `DECLINED{asks}`; effects `[{type:'ASK_ALARM_SET', when}]` only when `nextAskAt` set.
  - `failed{error}` → `error` with `error`; input `FAILED{error}`; same timer effects as `cancelled`.
  - `ended` → `stopped`, `since:null`; input `STOPPED{reason:'stop-sharing'}`; effects `[{type:'REASK'}]`.
  - `closed` (holder window removed) → `holderWindowId:null`; from `on`: `stopped`, `STOPPED{reason:'window-closed'}`, `[REASK]`; from `prompting`: as `cancelled`; from any other state: no input, no effects (the SW closed it).
  - `dead{error}` (ping not alive) → from `on`: `stopped`, `STOPPED{reason:'error', error}`, `[REASK]`; otherwise no-op.
  - every transition sets `at`.
- `describeDesktop(desktop, frames)` → popup string per spec §6a (`on since HH:MM:SS (N frames)`, `asking…`, `off — declined Nx, next ask HH:MM:SS` / `off — declined Nx`, `stopped at HH:MM:SS`, `error: <message>`, `off`). Use `fmtLocal(...).slice(11)` from `ids.js`.
- [ ] Failing tests: one per bullet above (`'shouldPrompt: off/stopped/error yes, prompting/on no'`, `'declined re-asks only after the interval and only when repromptMin > 0'`, `'started → on with MINIMIZE and alarm clear'`, `'cancelled → declined with the alarm when repromptMin > 0'`, `'failed → error'`, `'ended → stopped with REASK'`, `'closed while on / while prompting / after SW close'`, `'dead only matters while on'`, `'describeDesktop renders every state'`, `'onHolder does not mutate its input'` (deepEqual before/after)).
- [ ] Implement (~50 lines).
- [ ] Verify: `npm test`. Commit: `git add src/core/desktop.js tests/unit/desktop.test.js && git commit -m "feat(core): desktop capture state transitions and prompt gating"`

## Task 4: reducer DESKTOP input (spec §4 inputs, §5)

**Files:** `src/core/session.js`, `tests/unit/session-b.test.js`.

- [ ] Failing tests (`armed = arm().session`; `desk = (name, data, at = T0 + 1000) => ({ kind:'DESKTOP', name, data, at })`):
  - `'DESKTOP STARTED/DECLINED/STOPPED/FAILED/FRAME become DESKTOP_* events with data copied'` — five reductions from `armed`; names `DESKTOP_CAPTURE_STARTED`, `DESKTOP_CAPTURE_DECLINED`, `DESKTOP_CAPTURE_STOPPED`, `DESKTOP_CAPTURE_FAILED`, `DESKTOP_FRAME`; `events[0].data` deepEquals the input data; no `tabId`/`windowId` keys on the event; state unchanged.
  - `'DESKTOP in CLOSING carries phase tail'` — after an END_CLICK with `tailMin: 5`, a `DESKTOP FRAME{n:1}` event has `data.phase === 'tail'`.
  - `'DESKTOP while IDLE emits nothing'` — `reduce(initial(), desk('STARTED', {...}), cfg)` → no events, state IDLE.
- [ ] Implement: `const DESKTOP_EVENT = { STARTED:'DESKTOP_CAPTURE_STARTED', DECLINED:'DESKTOP_CAPTURE_DECLINED', STOPPED:'DESKTOP_CAPTURE_STOPPED', FAILED:'DESKTOP_CAPTURE_FAILED', FRAME:'DESKTOP_FRAME' }`; `HANDLERS.DESKTOP(s, input, cfg, emit) { const name = DESKTOP_EVENT[input.name]; if (name) emit(name, input.data || {}); }`. The IDLE branch already ignores unknown kinds.
- [ ] Verify: `npm test`. Commit: `git add src/core/session.js tests/unit/session-b.test.js && git commit -m "feat(session): DESKTOP input to DESKTOP_* events"`

## Task 5: tally.desktop (spec §8)

**Files:** `src/core/counters.js`, `tests/unit/counters.test.js`.

- [ ] Failing tests (`ev = (name, t, data = {}, shot = null)`):
  - `'tally.desktop counts frames over desktopShot and DESKTOP_FRAME shots, distinct files'` — FOCUS_LEFT_CHROME with `desktopShot:'screenshots/desktop/a.jpg'`, DESKTOP_FRAME with `shot:'screenshots/desktop/b.jpg'`, PERIODIC with the same `a.jpg` → `frames 2`.
  - `'spans open at STARTED and close at STOPPED; the last one stays open'` — STARTED(t1), STOPPED(t2), STARTED(t3) → `spans` deepEqual `[{from:t1,to:t2,stopped:true},{from:t3,to:null,stopped:false}]`.
  - `'asks, declined, failed'` — STARTED(resumed:true), DECLINED, DECLINED, FAILED, STARTED → `asks 4` (STARTED with `resumed` not counted), `declined 2`, `failed 1`.
  - `'no desktop events → frames 0, empty spans'`.
- [ ] Implement inside the single loop of `tally`; return `desktop: { frames: desktopFiles.size, asks, declined, failed, spans }`.
- [ ] Verify: `npm test`. Commit: `git add src/core/counters.js tests/unit/counters.test.js && git commit -m "feat(counters): desktop capture tally"`

## Task 6: summary renderers (spec §8)

**Files:** `src/core/summary-text.js`, `src/core/summary-html.js`, `tests/unit/summary-text.test.js`, `tests/unit/summary-html.test.js`.

- [ ] Failing tests:
  - `'describeDesktopSummary'` (`summary-text.test.js`): `{frames:0,asks:0,declined:0,failed:0,spans:[]}` → `'off'`; `{asks:3,declined:3,spans:[]}` → `'declined (3 asks)'`; `{failed:1, spans:[]}` with the last FAILED error passed as `lastError` → `'failed: NotAllowedError'`; one open span → `'on 09:15:04 - 12:15:44 (37 frames)'` (`to:null` rendered as `endedAt`); two spans with a stop and a decline between → `'on 09:15:04 - 09:40:02, stopped at 09:40:02, re-shared 09:41:30 - 12:15:44 (37 frames); declined 1x'`.
  - `'summary.txt has the Desktop line after Log chain and a Desktop frames line when frames > 0'` — `/^Desktop:   on /m`; `/^Desktop frames: 37 \(screenshots\/desktop\/\)$/m`; with `frames 0` the second line is absent.
  - `summary-html.test.js`: `'Desktop capture section lists DESKTOP_* events and the status line'` — `<h2>Desktop capture</h2>`, a row with `DESKTOP_CAPTURE_STARTED`; `'timeline row links the desktop frame and the screenshots section includes desktop files'` — `href="#screenshots/desktop/…"` in the row, `<h3 id="screenshots/desktop/…">` with `<img src="data:image/jpeg;base64,…">` inline and `src="screenshots/desktop/…"` linked.
- [ ] Implement: `export function describeDesktopSummary(desktop, endedAt, lastError)` in `summary-text.js` (`lastError` = data.error of the last `DESKTOP_CAPTURE_FAILED`, computed by the caller from `events`); `renderSummaryText` inserts `Desktop:   ${…}` after the `Log chain:` line and `Desktop frames: N (screenshots/desktop/)` after `Screenshots:` when `N > 0`. `renderSummaryHtml`: `files` = tab shots ∪ desktop files (`e.shot`, `e.data.desktopShot`) in event order; new `<h2>Desktop capture</h2>` block after Time away (status line + table `['Time','Event','Details']` over `DESKTOP_*` events); timeline table gains a `Desktop` column linking `e.data.desktopShot ?? (e.name === 'DESKTOP_FRAME' ? e.shot : null)`.
- [ ] Verify: `npm test`. Commit: `git add src/core/summary-text.js src/core/summary-html.js tests/unit/summary-text.test.js tests/unit/summary-html.test.js && git commit -m "feat(summary): desktop capture line, section, frames"`

## Task 7: holder page (spec §6a Why a holder window, Messages)

**Files:** `src/holder/holder.html` (new), `src/holder/holder.js` (new, module), `tests/unit/holder.test.js` (new), `package.json` (`check` script gains `&& node --check src/holder/holder.js`).

`holder.html`: `<title>ExamEye screen capture</title>`, a one-line `<p id="msg">` ("ExamEye is recording the screen for this paper. Do not close this window."), `<video id="v" autoplay muted playsinline hidden>`, `<canvas id="c" hidden>`, `<script type="module" src="holder.js">`. No imports from `core/`.

`holder.js` behaviour:
- `send(m)` = `chrome.runtime.sendMessage({ type:'desktop', ...m }).catch(() => null)`.
- On load: `send({ name:'ready' })` → response `{close}` → `window.close()`; `{ask}` → `ask()`.
- `ask()`: stop any current stream; `t0 = Date.now()`; `chrome.desktopCapture.chooseDesktopMedia(['screen'], cb)`; `cb(streamId)`: `pickMs = Date.now() - t0`; empty id → `send({ name:'cancelled', pickMs })`; else `getUserMedia({ audio:false, video:{ mandatory:{ chromeMediaSource:'desktop', chromeMediaSourceId: streamId, maxFrameRate:2 } } })` → `video.srcObject = stream`, await `video.onloadedmetadata`, track `ended` listener → `stream = null; setAway(false); send({ name:'ended' })`; then `send({ name:'started', width: video.videoWidth, height: video.videoHeight, pickMs })`; rejection → `send({ name:'failed', error: String(e?.message || e), pickMs })`.
- `grab()`: `null` without a stream or zero dimensions; else draw scaled to `min(1, 1280 / w)` and return the base64 body of `canvas.toDataURL('image/jpeg', 0.5)`.
- `setAway(on)`: clear the interval; when `on` and a stream exists, `setInterval(10000)` posting `send({ name:'frame', b64 })` when `grab()` returns a frame.
- `chrome.runtime.onMessage` listener for `type === 'holder'`: `grab` → `respond({ b64: grab(), alive: Boolean(stream) })`; `ping` → `respond({ alive })`; `away` → `setAway(m.on)`; `ask` → `ask()`.
- [ ] Failing tests (hand-rolled globals in the test file, like `content.test.js`: `document.getElementById` returning `{v:{videoWidth:1920,videoHeight:1080,onloadedmetadata:null}, c:{width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=>'data:image/jpeg;base64,QUJD'}, msg:{textContent:''}}`, `navigator.mediaDevices.getUserMedia` recording its constraints and resolving a fake stream `{ getVideoTracks: () => [track], getTracks: () => [track] }` with `track.addEventListener`/`stop`, `chrome.desktopCapture.chooseDesktopMedia` capturing the callback, `chrome.runtime.sendMessage` recording and returning a settable promise, `chrome.runtime.onMessage.addListener` capturing the listener, `window.close` recording; `mock.timers.enable({ apis:['setInterval'] })`):
  - `'holder.html has the three ids, a module script and no core import'`.
  - `'sends ready on load; ask:true opens the dialog for screen only; close:true closes the window'`.
  - `'cancel sends cancelled with pickMs'`.
  - `'the stream id is consumed by getUserMedia with chromeMediaSource desktop; started carries width/height'` — `constraints.video.mandatory.chromeMediaSourceId === 'sid-1'`.
  - `'grab answers b64 and alive; ping answers alive; no stream → b64 null, alive false'`.
  - `'away on posts a frame every 10 s; away off stops it'` — `mock.timers.tick(10000)` twice → two `frame` messages; after `away{on:false}` a further tick posts nothing.
  - `'track ended sends ended and stops the away loop'`.
  - `'ask message stops the current stream and re-asks'` — `track.stop` called once, `chooseDesktopMedia` called twice.
- [ ] Implement (~70 lines).
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add package.json src/holder tests/unit/holder.test.js && git commit -m "feat(holder): extension page that requests, consumes and serves the desktop stream"`

## Task 8: desktop adapter and fake-chrome (spec §2, §12)

**Files:** `src/adapters/desktop.js` (new), `tests/unit/fake-chrome.js`, `tests/unit/adapters.test.js`.

- [ ] Fake additions: `runtime.getURL = (p) => 'chrome-extension://fake-ext-id/' + p`; `runtime.sent = []`, `runtime.responder = null`, `runtime.sendMessage(msg)` pushes to `sent` and returns `responder ? Promise.resolve(responder(msg)) : Promise.reject(new Error('Could not establish connection'))`; `windows.nextId = 100`, `windows.create(opts)` → pushes `{ id, focused:true, state:'normal', type: opts.type, url: opts.url }`, emits `onCreated(win)`, returns the window; `windows.update(id, info)` → `Object.assign` (`state`, `focused`), returns it; `windows.remove(id)` → splice and emit `onRemoved(id)`. `desktopCapture` stays undefined.
- [ ] Failing tests (`adapters.test.js`): `'openHolder creates a focused 460x140 popup at the holder URL'`; `'grabDesktop/pingHolder fall back to not-alive when nobody answers'` (responder null → `{ b64:null, alive:false }` / `{ alive:false }`); `'setAway and askHolder send holder messages'`; `'showWindow restores and focuses; minimizeWindow minimises; closeWindow removes and swallows a missing id'`; `'supported reflects chrome.desktopCapture'`.
- [ ] Implement per the File map: `supported = () => Boolean(chrome.desktopCapture)`; `holderUrl = () => chrome.runtime.getURL('src/holder/holder.html')`; `openHolder`, `showWindow` (`{ state:'normal', focused:true }`), `minimizeWindow`, `closeWindow` (`.catch(() => {})`), `grabDesktop`, `pingHolder`, `setAway(on)`, `askHolder()` all via one `send(name, extra)` helper that catches to `null`.
- [ ] Verify: `npm test`. Commit: `git add src/adapters/desktop.js tests/unit/fake-chrome.js tests/unit/adapters.test.js && git commit -m "feat(adapters): desktop holder window and messaging"`

## Task 9: SW — holder lifecycle, prompts, re-asks, session end (spec §6a Trigger and re-prompt, §10)

**Files:** `src/sw.js`, `tests/unit/sw-desktop.test.js` (new; config `desktopCapture:'on', desktopRepromptMin:5, startButton:''`, `chrome.desktopCapture = {}` before the import, `chrome.tabs.list` gains a holder tab `{ id: 9, windowId: <holder id>, url: chrome.runtime.getURL('src/holder/holder.html') }` after each `windows.create`).

Queue steps to add (all storage writes inside `enqueue`; `dispatchNow` only from inside these):
- `promptDesktop = () => enqueue(promptDesktopNow)`; `promptDesktopNow()`: `cfg = await loadConfig()`; return unless `cfg && cfg.desktopCapture === 'on' && supported()`; `d = meta.desktop || EMPTY_DESKTOP`; return unless `shouldPrompt(d, { at: now(), repromptMin: cfg.desktopRepromptMin })`; `await askNow(d, cfg)`.
- `askNow(d, cfg)`: return unless `cfg.desktopCapture === 'on'`; if `d.holderWindowId !== null && await getWindow(d.holderWindowId)` → `showWindow`, `askHolder()`; else `id = (await openHolder()).id`; `patchMeta({ desktop: { ...d, state:'prompting', at: now(), holderWindowId: id, asks: d.asks + 1 } })`; `alarms.clear('desktopAsk')`.
- `applyHolder(d, msg, cfg)`: `r = onHolder(d, msg, { at: now(), repromptMin: cfg?.desktopRepromptMin ?? 0 })`; `patchMeta({ desktop: r.desktop })`; effects: `MINIMIZE` → `minimizeWindow(r.desktop.holderWindowId)`, `ASK_ALARM_SET` → `alarms.setAt('desktopAsk', when)`, `ASK_ALARM_CLEAR` → `alarms.clear('desktopAsk')`; `if (r.input) await dispatchNow(r.input)`; then `if (REASK) await askNow(r.desktop, cfg)` (after the STOPPED event is logged).
- `desktopMessageNow(msg, sender, respond)`: `ready` → `respond(sender.tab?.windowId === d.holderWindowId ? { ask: d.state === 'prompting' } : { close: true })`; `frame` → `desktopFrameNow(msg.b64)` (Task 10); else `applyHolder(d, msg, cfg)`.
- `holderRemovedNow(windowId)`: if `windowId === d.holderWindowId` → `applyHolder(d, { name:'closed' }, cfg)`.
- `closeHolderNow()`: `d = meta.desktop`; if `d.state === 'off' && d.holderWindowId === null` return; `patchMeta({ desktop: { ...EMPTY_DESKTOP, holderWindowId: d.holderWindowId } })` (id kept so the coming `WINDOW_REMOVED` is filtered and `closed` is a no-op); `alarms.clear('desktopAsk')`; `if (d.holderWindowId !== null) await closeWindow(d.holderWindowId)`.
- `desktopAskNow()` (alarm): return if `session` is missing or IDLE; else `promptDesktopNow()`.

Wiring:
- `dispatchNow`, right after `const meta = st.meta || {}`: `if (HOLDER_KINDS.has(input.kind) && (input.url === holderUrl() || input.windowId === meta.desktop?.holderWindowId)) return;` with `HOLDER_KINDS = new Set(['NAV', 'TAB_ACTIVATED', 'WINDOW_CREATED', 'WINDOW_REMOVED'])`.
- `dispatchNow`, at the very end (after `flushNow`), when `r.session.state === 'ARMED' && session.state === 'IDLE'`: re-read `meta.desktop`; `patchMeta({ desktop: { ...d, asks: 0 } })`; if `d.state === 'on'` → `await dispatchNow({ kind:'DESKTOP', name:'STARTED', data:{ width: d.width, height: d.height, pickMs: null, resumed: true }, at: input.at })`; else `await promptDesktopNow()`.
- `onNav`: after the existing `dispatch(...)`, `const cfg = await loadConfig(); if (cfg && classify(d.url, cfg) === 'start') promptDesktop();`.
- `chrome.runtime.onMessage`: `if (msg?.type === 'desktop') { enqueue(() => desktopMessageNow(msg, sender, respond)); return true; }` before the `cs` branch.
- `chrome.windows.onRemoved`: keep the existing `dispatch(...)` **first**, then `enqueue(() => holderRemovedNow(windowId))` (the filter must still see the id).
- `runEffects` `END`: `await endSession(pendingEnd, cfg); await closeHolderNow();`.
- `applyConfigNow` (after `setPeriodic`): `if (cfg.desktopCapture === 'off') await closeHolderNow(); else if (session ARMED/CLOSING) await promptDesktopNow();`.
- `onAlarm`: `else if (a.name === 'desktopAsk') enqueue(desktopAskNow);`.
- [ ] Failing tests (`sw-desktop.test.js`; `holderMsg = (m, wid) => chrome.runtime.onMessage.emit({ type:'desktop', ...m }, { tab: { id: 9, windowId: wid } }, respond)`):
  - `'start NAV opens one holder window and marks prompting; a second NAV does not open another'` — after `onCommitted` on the start URL: `windows.list` has one popup at the holder URL, `meta.desktop` `{ state:'prompting', holderWindowId: id, asks: 1 }`; second `onCommitted` → still one window, `asks 1`.
  - `'holder window/tab inputs never reach the reducer'` — emit `windows.onCreated(holderWin)`, `tabs.onActivated({ tabId: 9, windowId: holderId })`, `webNavigation.onCommitted({ tabId: 9, frameId: 0, url: holderUrl })` → `names()` unchanged (no `WINDOW_OPENED`, `TAB_SWITCH`, `PARALLEL_PAGE`).
  - `'ready from the holder is answered ask:true; from an unknown window close:true'`.
  - `'started: on, minimised, DESKTOP_CAPTURE_STARTED with a tab shot, desktopAsk cleared'` — `holderMsg({ name:'started', width:1920, height:1080, pickMs:2400 }, holderId)`; `meta.desktop.state 'on'`, `since` set; holder window `state 'minimized'`; last event name/data; `shot` matches `/_DESKTOP_CAPTURE_STARTED\.jpg$/`; `chrome.alarms.alarms.desktopAsk` undefined.
  - `'cancelled: declined, DECLINED{asks:1}, alarm at +5 min; a start NAV inside the interval is silent; the alarm re-asks in the same window'` — `alarms.desktopAsk.when === desktop.at + 300000`; `onCommitted` start → `runtime.sent` has no `ask`; `onAlarm({ name:'desktopAsk' })` → `runtime.sent` last is `{ type:'holder', name:'ask' }`, holder window `state 'normal'`, `desktop.state 'prompting'`, `asks 2`.
  - `'ended: STOPPED{reason:stop-sharing} then an immediate re-ask in the same window'`.
  - `'holder window closed while on: STOPPED{reason:window-closed} and a fresh holder window'` — `windows.remove(holderId)` → event, `holderWindowId` is a new id, `windows.list` has one holder; no `WINDOW_CLOSED` event.
  - `'failed: error state and DESKTOP_CAPTURE_FAILED{error} with the alarm'`.
  - `'arming while already on logs DESKTOP_CAPTURE_STARTED{resumed:true} and resets asks'` — set `meta.desktop` to an `on` record while IDLE, arm → events `['SESSION_ARMED', 'DESKTOP_CAPTURE_STARTED']`, `data.resumed === true`.
  - `'desktop messages while IDLE change meta only'`.
  - `'session end closes the holder, clears the alarm and resets desktop to off'` — navigate to the result URL (`tailMin: 0`) → `windows.list` has no holder, `desktop.state 'off'`, `holderWindowId null` after the fake's `onRemoved`, no `WINDOW_CLOSED` event in the ended session's lines.
  - `'desktopCapture off closes the holder and never opens one'` — `storage.local.set({ config: { ...config, desktopCapture:'off' } })`, `sw.settled()` → no holder; start NAV → still none.
  - `'desktopAsk while IDLE does nothing'`.
- [ ] Implement as specified. Existing tests must stay green: `sw-listeners`/`sw-shots` never define `chrome.desktopCapture`, so `supported()` is false there.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/sw.js tests/unit/sw-desktop.test.js && git commit -m "feat(sw): desktop capture holder lifecycle, prompts and re-asks"`

## Task 10: SW — frames, away loop, liveness (spec §6a Frames)

**Files:** `src/sw.js`, `tests/unit/sw-desktop-frames.test.js` (new; same setup as Task 9 plus `chrome.runtime.responder = (m) => m.name === 'grab' ? { b64: current, alive: true } : m.name === 'ping' ? { alive } : undefined`).

- `takeShots(events, pre)`: read `meta` first; `desktopOn = meta.desktop?.state === 'on'`; `wantDesktop = events.some(e => e.name === 'DESKTOP_FRAME' || (needsDesktopFrame(e) && desktopOn))`; return `[]` unless `events.some(needsShot) || wantDesktop` (the existing "never loads the shots map" test must still pass — read `shots` only past this point). In the loop, before the `needsShot` check: `DESKTOP_FRAME` → `file = desktopShotFile(ev.t, ev.name)`, `shots[file] = pre.desktop`, `added.push`, `ev.shot = file`; other `needsDesktopFrame` events while `desktopOn` → `{ b64, alive } = await grabDesktop()`; `b64` → file/shots/added and `ev.data.desktopShot = file`; else `ev.data.desktopShotError = alive ? 'no frame' : 'stream not alive'`. No coalescing, `meta.lastShot` untouched by desktop files.
- `dispatchNow`, after `takeShots`, when `desktopOn`: for `FOCUS_LEFT_CHROME` → `patchMeta({ desktopAway: EMPTY_TAIL })`, `setAway(true)`; for `FOCUS_RETURNED` → `setAway(false)`.
- `desktopFrameNow(b64)`: drop unless `session` ARMED/CLOSING and `desktop.state === 'on'` and `b64`; `hash = await shortHash(b64)`; `{ keep, tail } = decide(meta.desktopAway, { hash, at }, { cap: 40 })`; drop unless `keep`; `patchMeta({ desktopAway: tail })`; `dispatchNow({ kind:'DESKTOP', name:'FRAME', data:{ n: tail.count }, at, pre:{ desktop: b64 } })`.
- `tick()`: after `finishPendingEnd()`, `await enqueue(desktopPingNow)`: if `desktop.state === 'on'` → `{ alive } = await pingHolder()`; `!alive` → `applyHolder(d, { name:'dead', error:'ping failed' }, cfg)`.
- [ ] Failing tests:
  - `'PERIODIC while on files a desktop frame as data.desktopShot and enqueues it'` — event `data.desktopShot` matches `/^screenshots\/desktop\/\d{8}-\d{6}_PERIODIC\.jpg$/`, `shots[file] === current`, `pending` has `ExamEye/<id>/<file>`, `event.shot` is a normal tab shot.
  - `'FOCUS_LEFT_CHROME grabs, resets desktopAway and sends away on; FOCUS_RETURNED grabs and sends away off'` — `windows.onFocusChanged.emit(-1)` then `emit(3)`; `runtime.sent` contains `{ type:'holder', name:'away', on:true }` then `on:false`; both events carry `desktopShot`; `meta.desktopAway` deepEquals `EMPTY_TAIL` after the first.
  - `'holder frames: first kept as DESKTOP_FRAME{n:1} with shot the desktop file; same hash dropped; within 3 s dropped; the 41st dropped'` — emit `{ type:'desktop', name:'frame', b64 }` messages, varying `b64`, spacing `at` by stubbing `Date.now` (`mock.method(Date, 'now', ...)`) or by 3 s real gaps only for the first pair; `DESKTOP_FRAME` events have no `data.desktopShot`, `shot` under `screenshots/desktop/`, and `needsShot` never ran (`captureVisibleTab` call count unchanged).
  - `'frames are ignored while desktop is not on or the session is IDLE'`.
  - `'grab without a frame records desktopShotError and keeps the event'` — responder `{ b64:null, alive:true }` → `desktopShotError 'no frame'`; responder throws → `'stream not alive'`.
  - `'no desktop grab is attempted while state is not on'` — `runtime.sent` has no `grab` after a PERIODIC with `desktop.state 'declined'`.
  - `'tick ping not alive → STOPPED{reason:error} and a re-ask'` — `alive = false`, `sw.tick()`.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/sw.js tests/unit/sw-desktop-frames.test.js && git commit -m "feat(sw): desktop frames on focus loss, away loop, periodic frame, liveness ping"`

## Task 11: SW — browser restart (spec §6a Persistence and restart)

**Files:** `src/sw.js` (`recover()`), `tests/unit/sw-startup.test.js`.

- [ ] Failing test: `'recover() after a browser restart drops the stale holder id, resets desktop and prompts once for an ARMED session'` — `chrome.desktopCapture = {}`, config `desktopCapture:'on'`; store `session` ARMED, `meta.desktop = { ...on record, holderWindowId: 77 }`, `meta.desktopAway = { count: 5, ... }`; emit `runtime.onStartup` → `sw.settled()`; `meta.desktop.state 'prompting'`, `holderWindowId !== 77`, `desktopAway` deepEquals `EMPTY_TAIL`, `windows.list` has one holder, no `windows.remove(77)` happened (fake `windows.list` had no 77, and no throw). Second test: `'recover() with an IDLE session resets desktop and does not prompt'`.
- [ ] Implement: inside the enqueued function of `recover()`, before the existing `finishPendingEndNow()`: `await store.patchMeta({ desktop: EMPTY_DESKTOP, desktopAway: EMPTY_TAIL })`; after the `STARTUP` dispatch (session not IDLE): `await promptDesktopNow()`.
- [ ] Verify: `npm test`. Commit: `git add src/sw.js tests/unit/sw-startup.test.js && git commit -m "feat(sw): re-prompt desktop capture after a browser restart"`

## Task 12: popup and options (spec §3, §6a State)

**Files:** `src/popup/popup.html`, `src/popup/popup.js`, `tests/unit/popup.test.js`, `src/options/options.html`, `tests/unit/options.test.js`.

- [ ] Failing tests: popup `'popup has the live-state slots…'` id list gains `desktop`; `'render shows the desktop line'` — `meta.desktop` on record with two `desktopShot` events stored → `dom.desktop.textContent === 'on since HH:MM:SS (2 frames)'`; idle/no meta → `'off'`. Options: `'form has desktopCapture select and desktopRepromptMin input'` (regex on the HTML: `<select name="desktopCapture">` with `on`/`off` options, `name="desktopRepromptMin" type="number" min="0" max="60"`); `installFakeDom` field list gains both names; `'save round-trips desktopCapture off'`.
- [ ] Implement: `<dt>Desktop capture</dt><dd id="desktop"></dd>` after Session; `popup.js`: `$('desktop').textContent = describeDesktop(meta.desktop, tally(events).desktop.frames)`. Options: `<label>Desktop capture (screen frames while focus leaves Chrome)<select name="desktopCapture"><option value="on">on</option><option value="off">off</option></select></label>` and `<label>Re-ask after a declined share (minutes; 0 = ask once)<input name="desktopRepromptMin" type="number" min="0" max="60"></label>` after the abandon field; `options.js` needs no change (`Object.keys(DEFAULTS)` + `form.elements[k].value` works for a select). Add `select { width: 100%; padding: 6px; }` to the options style.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/popup src/options/options.html tests/unit/popup.test.js tests/unit/options.test.js && git commit -m "feat(ui): desktop capture popup line and options fields"`

## Task 13: integration (spec §12)

**Files:** `tests/integration/harness.js`, `tests/integration/session.test.js`.

- [ ] `launch(config, { args = [] } = {})` appends `args` to the Chromium args. Existing scenarios already carry `desktopCapture:'off'` (Task 1).
- [ ] New scenario `'desktop capture: auto-accepted share logs STARTED, a PERIODIC desktop frame and the summary line'` with `desktopCapture:'on', desktopRepromptMin:0, tailMin:0` and `args: ['--auto-select-desktop-capture-source=Entire screen']`, collector page as in scenario 1:
  1. `goto` start → `ARMED`; `waitFor` an event `DESKTOP_CAPTURE_STARTED` (20 s); `meta.desktop.state === 'on'`; `b.context.pages()` includes a page whose URL ends with `/src/holder/holder.html`.
  2. Force a periodic: `b.worker.evaluate(() => chrome.alarms.create('periodic', { when: Date.now() + 500 }))` (unpacked extensions are exempt from the 30 s floor); `waitFor` a `PERIODIC` event with `data.desktopShot` matching `/^screenshots\/desktop\//`; `waitFor` `pending` empty; assert one more `image/jpeg` download than before the alarm (collector `__dl`).
  3. `goto` result → `IDLE`; summary.txt (collector, as scenario 1) matches `/^Desktop:   on \d\d:\d\d:\d\d - \d\d:\d\d:\d\d \(\d+ frames\)$/m` and `/^Desktop frames: [1-9]\d* \(screenshots\/desktop\/\)$/m`; events.jsonl has no `WINDOW_OPENED` and no `PARALLEL_PAGE` whose `data.url` starts with `chrome-extension://`; the log chain verifies.
  Never assert on pixel content: Playwright's Chromium on the dev Mac has no Screen Recording permission, so frames may be black.
- [ ] Decline path: Chrome's native picker cannot be dismissed from Playwright (it is not a page dialog; keyboard input goes to the page), so no integration scenario runs without the flag; decline/stop/closed are covered by Tasks 3 and 9 unit tests. State this in the scenario's leading comment.
- [ ] Verify: `npm run test:integration` (foreground, all scenarios), then `npm test`, `npm run check`. If `DESKTOP_CAPTURE_STARTED` never arrives under the flag on this machine, stop and report the holder's `cancelled`/`failed` message from `meta.desktop` — do not weaken the assertion.
- [ ] Commit: `git add tests/integration/harness.js tests/integration/session.test.js && git commit -m "test(integration): desktop capture auto-accepted share, periodic frame, summary line"`

## Task 14: centre checklist (brief: centre-setup.md)

**Files:** `docs/centre-setup.md`.

- [ ] §4 table: two rows — `Desktop capture` → `on` (default; set `off` only where the centre forbids screen recording) and `Re-ask after a declined share (minutes; 0 = ask once)` → `5` (default).
- [ ] New `## 5a. Screen recording permission (macOS only)`: Windows needs nothing. macOS: System Settings → Privacy & Security → Screen Recording → enable Chrome (or Edge), then quit and reopen the browser; without it every desktop frame is black and nothing warns.
- [ ] §6 dry run: after step 1 add `1a.` — when the start page loads a small "ExamEye screen capture" window and Chrome's "Choose what to share" dialog appear; click **Share**. The popup must show `Desktop capture: on since HH:MM:SS`. The small window minimises itself; do not close it. After step 2 add `2a.` — click the desktop or another application for 15 s, then return to Chrome. After the session (step 6) `screenshots/desktop/` must contain at least 2 JPEGs and `summary.html` must show them next to `FOCUS_LEFT_CHROME`/`DESKTOP_FRAME`; on macOS confirm they are not black. Step 6 file list gains `screenshots/desktop/` and `summary.txt` gains a `Desktop:` line.
- [ ] New `## 8. Candidate notice`: text to display or read out before the paper — "Your screen is recorded during this paper. Chrome will ask you to share your screen when the exam page opens; choose Share. Do not close the small ExamEye window or press Stop sharing." Also state that Cancel/Stop are logged and re-asked.
- [ ] Verify: `npm test` (nothing to run for docs, but the tree must still be green). Commit: `git add docs/centre-setup.md && git commit -m "docs(centre): desktop capture setup, macOS permission, dry-run steps, candidate notice"`

---

## Handoff

After Task 14: run `npm test`, `npm run test:integration`, `npm run check` once more in the foreground and paste the tails. Then the owner dry run on a Windows machine (docs/centre-setup.md §6 steps 1a/2a) is the acceptance test the harness cannot give (real frames, the sharing bar, Stop sharing → re-ask).
