# ExamEye — Design Spec

Date: 2026-09-12. Owner: Pawan. Source of decisions: `exameye-brief.md` (2026-09-12). This
spec turns those decisions into a concrete design; it does not reopen them.

## 1. Purpose & constraints

ExamEye is a Manifest V3 extension for Chrome and Edge that observes a candidate's browser during
a ~3-hour online exam at a test centre and writes an evidence trail (log, events, screenshots,
summary) to a folder under the browser's download directory. It **records only; it never blocks**.

Hard constraints (from the brief):

- The exam website cannot be modified. Everything is keyed off configured URL prefixes.
- Installed once per machine; after install + one-time configuration there are **no further
  prompts or clicks** — not on browser start, not on exam start.
- Persistence is `chrome.downloads.download` with `data:` URLs from the service worker (decided by
  spike; File System Access is out). `chrome.storage.local` is the source of truth.
- MV3 service worker (SW) sleeps after ~30 s idle: all state is persisted; periodic work uses
  `chrome.alarms`.
- Plain JS ES modules, no framework, no bundler. Unit tests via `node --test` (Node ≥ 22).
  Integration via Playwright's bundled Chromium (`~/Library/Caches/ms-playwright`).
- Must run on Chrome and Edge (Chromium ≥ 120, see §11).

Two brief items cannot be implemented literally on MV3 and are adjusted here (see §5, §8):
`chrome.alarms` has a 30 s minimum period on packed extensions since Chrome 120, so the "~1 s
window poll" becomes event-driven detection with a 30 s reconciliation tick, and the "10 s flush
alarm" becomes flush-on-every-event plus a 30 s replay alarm.

## 2. Architecture

```
manifest.json
src/
  sw.js                 service worker: the only place chrome.* events are wired; orchestrates
  content.js            classic (non-module) content script, registered dynamically on exam URLs;
                        reads `config` from storage for button/marker labels (no imports)
  holder/holder.html, holder.js
                        extension page in its own popup window: requests AND consumes the desktop
                        stream, holds it, answers frame requests (§6a); module page, no core imports
  core/                 PURE modules — no chrome.*, no DOM; fully unit-tested
    urlmatch.js         prefix matching, prefix → match pattern, URL classification
    config.js           defaults, normalize, validate, effectiveExamPrefix
    labels.js           button-label / marker normalisation and matching (mirrored in content.js)
    ids.js              timestamps, session id, screenshot file names
    events.js           event catalogue, needsShot(), makeEvent()
    tailshots.js        post-submit tail screenshot keep/drop decision (hash dedupe, min gap, cap)
    desktop.js          desktop capture state (`meta.desktop`): transitions, prompt gating, popup line
    session.js          session state machine reducer
    hashchain.js        SHA-256 short hash, chain verification
    logline.js          log.txt line grammar (header, event lines, chained lines)
    sink.js             pending-write map and data: URL encoding
    counters.js         tally(events): counts, durations, parallel-page table
    summary-text.js     summary.txt renderer
    summary-html.js     summary.html renderer
  adapters/             THIN wrappers around chrome.*; no business logic
    storage.js          get/set/patch on chrome.storage.local
    alarms.js           create/clear named alarms
    capture.js          captureVisibleTab → base64 JPEG
    downloads.js        download(data URL), UI suppression, erase-on-complete
    scripting.js        (re)register the content script from config
    desktop.js          holder window open/show/minimise/close; holder messages (ask/grab/away)
  options/options.html, options.js
  popup/popup.html, popup.js
tests/
  unit/                 node --test; imports core/* directly, adapters/sw with fake-chrome.js
  unit/fake-chrome.js   in-memory chrome.* double (events, storage.local, downloads, tabs, windows)
  integration/          Playwright harness + fake exam site
docs/centre-setup.md    manual centre setup checklist
```

Components:

- **Service worker (`src/sw.js`)** — registers every listener at top level (required so Chrome can
  wake it), converts each chrome event into a reducer *input*, calls `reduce()`, appends the
  resulting events to storage, takes screenshots for events that need one, formats and chains log
  lines, enqueues file writes, and flushes. It holds **no state in memory across events**; every
  handler loads what it needs from `chrome.storage.local` and writes it back. Handlers are
  serialised through a single in-memory promise chain (`queue = queue.then(...)`) so two events
  arriving in the same SW lifetime cannot interleave their read-modify-write.
- **Content script (`src/content.js`)** — DOM listeners on the exam page (copy/cut/paste/
  contextmenu/print/fullscreen/visibility/blur/focus/resize), a capture-phase `click` listener
  that matches the clicked control's label against `config.startButton` / `config.endButton`
  (`START_CLICK` / `END_CLICK`), and one `MutationObserver` on `document.documentElement`
  (`childList` + `characterData`, `subtree`; `document.body` does not exist yet at
  `document_start`) debounced to ~1 s that sends `SCREEN_CHANGED` and, once per page load,
  `END_MARKER` when `config.endMarker` appears in `document.body.innerText`. Sends
  `{type:'cs', name, data}` via `chrome.runtime.sendMessage`. It is a classic script (no imports)
  because `scripting.registerContentScripts` does not load ES modules; it therefore cannot import
  `core/labels.js` and instead reads the raw `config` key from `chrome.storage.local` (available to
  content scripts), inlines the label normaliser in exactly one small function (parity with
  `core/labels.js` is asserted by `tests/unit/content.test.js`), and follows
  `chrome.storage.onChanged` for live updates. The SW ignores messages from tabs other than the
  exam tab, except `START_CLICK` while IDLE (that is how a session begins).
- **Options page** — the one-time configuration form; writes `config` to `chrome.storage.local`.
  The SW reacts to `storage.onChanged` by re-registering the content script and the periodic alarm.
- **Popup** — read-only live view of `session`, `events` tally, `meta.lastFlushAt`, config errors;
  refreshes on `storage.onChanged`.
- **Holder window (`src/holder/`)** — one small extension popup window the SW opens for desktop
  capture (§6a). The page calls `chrome.desktopCapture.chooseDesktopMedia` itself, consumes the
  stream id with `getUserMedia`, keeps the stream for the rest of the browser session and answers
  `grab`/`away`/`ask` messages from the SW. The SW never calls `chooseDesktopMedia`. Its
  own window/tab activity is filtered out of the reducer inputs by window id and holder URL.
- **Offscreen document — not used.** The only reason to want one would be `URL.createObjectURL`
  for blob: URLs instead of data: URLs. The spike verified data: URLs work from the SW with no
  page; an offscreen document would add a lifecycle to manage for no verified need. It stays the
  fallback if summary.html data: URLs prove too large (§12), and is not built in phase 1.

## 3. Configuration

Stored under key `config` in `chrome.storage.local` (managed machines may later supply the same
shape via `chrome.storage.managed`; phase 1 reads only `local`).

| Field | Type | Default | Validation |
|---|---|---|---|
| `startPrefix` | string | `''` | required; `http(s)://` URL; matched "starts with" |
| `examPrefix` | string | `''` | optional; if non-empty must be `http(s)://` URL |
| `resultPrefix` | string | `''` | optional; if non-empty must be `http(s)://` URL and differ from `startPrefix` |
| `startButton` | string | `''` | optional; visible label of the button that starts the paper, max 80 chars after normalisation; blank = arm on start-prefix navigation |
| `endButton` | string | `''` | optional; comma-separated list of visible labels that end the paper; each label 1–80 chars after normalisation; a non-blank value must yield at least one label |
| `endMarker` | string | `''` | optional; phrase visible only on the submitted screen, max 200 chars after normalisation |
| `maxMin` | number | `0` | integer 0–600; `0` = no backstop; otherwise the paper is ended `maxMin` minutes after arming (`TIMED_OUT`) |
| `tailMin` | number | `5` | integer 0–60; length of the post-submit tail; `0` = end immediately, no tail |
| `seat` | string | `''` | required; sanitised to `[A-Za-z0-9_-]`, max 32 chars for file names (raw value kept for summary) |
| `subfolder` | string | `'ExamEye'` | required; no `/`, `\`, `..`, leading/trailing spaces; max 64 chars |
| `shotIntervalMin` | number | `10` | integer 1–60 |
| `abandonMin` | number | `10` | integer 1–120 |
| `desktopCapture` | string | `'on'` | `'on'` or `'off'`; whether the screen-share dialog is opened at all (§6a) |
| `desktopRepromptMin` | number | `5` | integer 0–60; minutes between re-asks after a decline; `0` = ask once per trigger, never by timer |

**Default for the open "in-progress URL" question:** when `examPrefix` is blank, the effective
exam-domain prefix is the *origin* of `startPrefix` (`scheme://host[:port]/`). Any URL under that
origin counts as the exam site (for re-adoption after restart and for content-script injection).
When `examPrefix` is set it is used instead of the origin. `config.effectiveExamPrefix(cfg)`
implements this rule; nothing else decides it.

At least one of `endButton`, `endMarker`, `resultPrefix` must be non-empty (error reported on
`endButton`). `startPrefix` and `resultPrefix` must differ when both are set (error on
`resultPrefix`).

Label normalisation (`core/labels.js`, mirrored verbatim in `content.js`): `normalizeLabel(s)` =
trim, collapse all whitespace runs to one space, lower-case. `parseLabels(csv)` splits on `,`,
normalises each part and drops empties. `matchLabel(text, labels)` is **exact** equality of
`normalizeLabel(text)` with one of `labels` (never substring). The marker is matched as a
substring of the normalised page text.

`config.validate(cfg)` returns `[{field, message}]`; an empty array means valid. The SW refuses to
arm while the config is invalid and stores the errors in `meta.configErrors` for the popup.

The SW logs `CONFIG_CHANGED{keys}` (`config.changedKeys`) for every `storage.onChanged` on
`config` while a session is ARMED or CLOSING; `subfolder` is copied into `session.subfolder` at
arm and used for every path of that session.

## 4. Session state machine

Pure reducer in `src/core/session.js`:
`reduce(session, input, cfg) → { session, events, effects }`. It never calls chrome.*; the SW
turns effects into API calls.

### States

- `IDLE` — no session. Record: `{ state:'IDLE' }`.
- `ARMED` — session running. Record:
  ```
  { state:'ARMED', id, seat, startedAt, examTabId, examWindowId, examUrl, seq,
    lastActivityAt, tabLostAt: null|ms, windowState: 'normal'|'minimized'|'fullscreen'|..,
    away: { tabAt:null|ms, focusAt:null|ms, minAt:null|ms, idleAt:null|ms, idleState:null|'idle'|'locked' },
    maxAt: null|ms, endClickAt: null|ms, markerSeen: false,
    outcome: null, trigger: null, triggerLabel: null, examEndedAt: null, closingUntil: null }
  ```
  `tabLostAt !== null` is the "exam tab gone" sub-condition (no separate state; it must survive
  restarts and keeps the reducer small). `maxAt = startedAt + maxMin*60000` when `maxMin > 0`.
- `CLOSING` — the paper has ended, the post-submit tail is running. Same record as ARMED with
  `state:'CLOSING'`, `outcome` ∈ `SUBMITTED`/`AUTO_SUBMITTED`/`RESULT`/`TIMED_OUT`, `trigger` ∈
  `button`/`marker`/`result`/`max`, `triggerLabel` (the matched label, marker phrase or result
  URL), `examEndedAt` = the trigger's `at`, `closingUntil = examEndedAt + tailMin*60000`. All
  monitoring continues; every event emitted in CLOSING carries `data.phase:'tail'`.

### Inputs (all carry `at` = epoch ms)

`NAV{tabId,windowId,url}` · `TAB_ACTIVATED{tabId,windowId,url,title,incognito}` ·
`TAB_REMOVED{tabId}` · `FOCUS{windowId}` (−1 = none) · `WINDOW_STATE{windowId,state}` ·
`WINDOW_CREATED{windowId,incognito}` · `WINDOW_REMOVED{windowId}` ·
`CS{name,tabId,windowId,data}` · `IDLE{state}` · `DOWNLOAD{url,filename,mime}` ·
`TICK{windows:[{id,state}], examTabPresent}` · `STARTUP{examTabs:[{tabId,windowId,url}]}` ·
`GAP{lastSeenAt,reason}` · `ABANDON_TIMER{}` · `MAX_TIMER{}` · `CLOSING_TIMER{}` · `PERIODIC{}` ·
`DESKTOP{name,data,pre?}` (§6a; `name` ∈ STARTED/DECLINED/STOPPED/FAILED/FRAME, reduced to the
matching `DESKTOP_*` event with `data` copied through, only while ARMED/CLOSING) ·
`CONFIG_CHANGED{keys}` (§3; `keys` from `config.changedKeys`, logged only while not IDLE and only
when non-empty).

`NAV` is dispatched from `webNavigation.onCommitted`, `onHistoryStateUpdated` and
`onReferenceFragmentUpdated` (frameId 0) alike, so single-page-app route changes and fragment
changes are classified exactly like full navigations. `CS` carries `url` (`sender.url`) as well as
the ids; the CS names that drive the state machine are `START_CLICK{label}`, `END_CLICK{label}`,
`END_MARKER{marker}` and `SCREEN_CHANGED{}` (the SW attaches `hash` after capture, §6).

### Transitions

| From | Input | Condition | Events emitted | To / side effects |
|---|---|---|---|---|
| IDLE | NAV | `startButton` blank, `classify(url)==='start'` | `SESSION_ARMED{url,trigger:'nav'}` | ARMED; `id = sessionId(at, seat)`, examTabId/WindowId = input; effects `ABANDON_ALARM_CLEAR`, `MAX_ALARM_SET{when:maxAt}` when `maxMin>0` |
| IDLE | CS START_CLICK | `startButton` set, `classify(url)==='start'` | `SESSION_ARMED{url,trigger:'button',label}` | ARMED, same as above |
| IDLE | anything else | — | none | IDLE (a start-prefix NAV does **not** arm while `startButton` is set) |
| ARMED | NAV | tab is exam tab, class `result` | `RESULT_PAGE{url}` | **tail start** (below) with `outcome:'RESULT'`, `trigger:'result'`, `triggerLabel:url` |
| ARMED | NAV | tab is exam tab, class ≠ `result`, url ≠ examUrl, class ≠ null | `EXAM_NAV{url}` | ARMED, examUrl updated |
| ARMED | NAV | tab is exam tab navigated off-site (`classify(url)===null`), url ≠ examUrl | `EXAM_NAV{url}` then `PARALLEL_PAGE{url,trigger:'committed',incognito:false}` | ARMED, examUrl updated |
| ARMED | NAV | other tab, `tabLostAt!==null`, class ∈ {start,exam,result} | `EXAM_NAV{url,adopted:true}` then re-run the exam-tab NAV rule (so a result page disarms) | examTabId/WindowId = input, tabLostAt=null; effect `ABANDON_ALARM_CLEAR` |
| ARMED | NAV | any other tab, class `result` | `RESULT_PAGE{url}`, ids from the tab that committed it | tail start with `outcome:'RESULT'`, `trigger:'result'` |
| ARMED | NAV | other tab, otherwise | `PARALLEL_PAGE{url,trigger:'committed',incognito:false}` | ARMED |
| ARMED | TAB_ACTIVATED | exam tab, `away.tabAt!==null` | `TAB_RETURN{awayMs}` | away.tabAt=null |
| ARMED | TAB_ACTIVATED | other tab, `away.tabAt===null` | `TAB_SWITCH{toTabId,toUrl,toTitle,toWindowId,incognito}`, `PARALLEL_PAGE{url,title,trigger:'activated',incognito}` | away.tabAt=at |
| ARMED | TAB_ACTIVATED | other tab, already away | `PARALLEL_PAGE{...,trigger:'activated'}` | ARMED |
| ARMED | TAB_REMOVED | exam tab, `tabLostAt===null` | `EXAM_TAB_CLOSED{}` | tabLostAt=at; effect `ABANDON_ALARM_SET{when: at + abandonMin*60000}` |
| ARMED | FOCUS | windowId −1, `away.focusAt===null` | `FOCUS_LEFT_CHROME{}` | away.focusAt=at |
| ARMED | FOCUS | windowId ≥ 0, `away.focusAt!==null` | `FOCUS_RETURNED{awayMs}` | away.focusAt=null |
| ARMED | WINDOW_STATE | exam window, state `minimized`, `away.minAt===null` | `WINDOW_MINIMIZED{}` | away.minAt=at |
| ARMED | WINDOW_STATE | exam window, state ≠ minimized, `away.minAt!==null` | `WINDOW_RESTORED{minimizedMs}` | away.minAt=null |
| ARMED | WINDOW_STATE | exam window, previous `fullscreen` → now not | `FULLSCREEN_EXIT{source:'window'}` | windowState updated |
| ARMED | WINDOW_CREATED | incognito | `INCOGNITO_WINDOW_OPENED{windowId}` | ARMED |
| ARMED | WINDOW_CREATED | not incognito | `WINDOW_OPENED{windowId}` | ARMED |
| ARMED | WINDOW_REMOVED | — | `WINDOW_CLOSED{windowId}` | ARMED |
| ARMED | CS | tabId ≠ examTabId | none | ARMED |
| ARMED | CS | name ∈ COPY/CUT/PASTE/CONTEXTMENU/PRINT | same-named event, `data` passed through | ARMED |
| ARMED | CS | name FULLSCREEN_EXIT | `FULLSCREEN_EXIT{source:'document'}` | ARMED |
| ARMED | CS | name DEVTOOLS | `DEVTOOLS_OPENED{dw,dh}` | ARMED |
| ARMED | CS | name START_CLICK | `START_BUTTON_CLICKED{label}` | ARMED (logged only) |
| ARMED | CS | name END_CLICK | `END_BUTTON_CLICKED{label}` | endClickAt=at; tail start with `outcome:'SUBMITTED'`, `trigger:'button'`, `triggerLabel:label` |
| ARMED | CS | name END_MARKER, `!markerSeen` | `END_MARKER_SEEN{marker}` | markerSeen=true; tail start with `outcome:'AUTO_SUBMITTED'`, `trigger:'marker'`, `triggerLabel:marker` |
| ARMED | CS | name END_MARKER, `markerSeen` | none | ARMED |
| ARMED | CS | name SCREEN_CHANGED | none | ARMED (tail-only input) |
| ARMED | CS | name VISIBILITY / BLUR / FOCUS | none | effect `PROBE` (SW queries focus + window state and dispatches FOCUS and WINDOW_STATE) |
| ARMED | IDLE | state ≠ active, `away.idleAt===null` | `IDLE_START{state}` | away.idleAt=at, away.idleState=state |
| ARMED | IDLE | state ≠ active, `away.idleAt!==null`, state ≠ `away.idleState` | `IDLE_END{idleMs}` then `IDLE_START{state}` | away.idleAt=at, away.idleState=state |
| ARMED | IDLE | state ≠ active, state === `away.idleState` | none | ARMED |
| ARMED | IDLE | state active, `away.idleAt!==null` | `IDLE_END{idleMs}` | away.idleAt=null, away.idleState=null |
| ARMED | DOWNLOAD | — | `DOWNLOAD_STARTED{url,filename,mime}` | ARMED |
| ARMED | TICK | — | as WINDOW_STATE for exam window; if `!examTabPresent && tabLostAt===null` as TAB_REMOVED | lastActivityAt=at |
| ARMED | STARTUP | `examTabs` non-empty | none (GAP is a separate input) | examTabId/WindowId = examTabs[0], tabLostAt=null; away.* reset to null (open intervals cannot be closed correctly after a restart); effect `ABANDON_ALARM_CLEAR` |
| ARMED | STARTUP | `examTabs` empty | none | tabLostAt = tabLostAt ?? at; effect `ABANDON_ALARM_SET{when: tabLostAt + abandonMin*60000}` |
| ARMED | GAP | — | `EXTENSION_GAP{lastSeenAt,gapMs,reason}` | ARMED |
| ARMED | ABANDON_TIMER | `tabLostAt!==null` | `SESSION_DISARMED{outcome:'ABANDONED',trigger:'abandon'}` | IDLE; effects `MAX_ALARM_CLEAR`, `END{outcome:'ABANDONED'}` |
| ARMED | MAX_TIMER | `tabLostAt===null` | `MAX_TIME_REACHED{maxAt}` (ids = exam tab/window) | tail start with `outcome:'TIMED_OUT'`, `trigger:'max'` |
| ARMED | MAX_TIMER | `tabLostAt!==null` | `MAX_TIME_REACHED{maxAt}`, `SESSION_DISARMED{outcome:'TIMED_OUT',trigger:'max'}` | IDLE; no tail (no tab to watch); effects `ABANDON_ALARM_CLEAR`, `END` |
| ARMED | CLOSING_TIMER | — | none | ARMED (stale alarm) |
| ARMED | PERIODIC | — | `PERIODIC{}` | ARMED |

**Window tracking:** in the ARMED/CLOSING handling of `TAB_ACTIVATED` and `NAV` for the exam
tab, if the input's windowId differs from `examWindowId` (and is not −1), `EXAM_WINDOW_MOVED`
is emitted first, `examWindowId` follows the tab and `windowState` resets to `normal`.

**Tail start** (shared by the four triggers above): set `outcome`, `trigger`, `triggerLabel`,
`examEndedAt = at`; effect `MAX_ALARM_CLEAR`. If `tailMin === 0`: emit
`SESSION_DISARMED{outcome,trigger,label?,url?}` and effect `END{outcome}` → IDLE. Otherwise
`state = 'CLOSING'`, `closingUntil = at + tailMin*60000`, effect `CLOSING_ALARM_SET{when:
closingUntil}`. The trigger event (`END_BUTTON_CLICKED`, `END_MARKER_SEEN`, `RESULT_PAGE`,
`MAX_TIME_REACHED`) is emitted **before** the state changes, so it belongs to the exam phase.

| From | Input | Condition | Events emitted | To / side effects |
|---|---|---|---|---|
| CLOSING | any ARMED-row input not listed below | as the ARMED row | as the ARMED row, with `data.phase:'tail'` | CLOSING; `lastActivityAt=at` |
| CLOSING | NAV | tab is exam tab, class `result` | `EXAM_NAV{url}` if url ≠ examUrl | CLOSING (no second trigger) |
| CLOSING | NAV | other tab, class `result` | `PARALLEL_PAGE{url,trigger:'committed'}` | CLOSING |
| CLOSING | CS | name START_CLICK | `START_BUTTON_CLICKED{label}` | CLOSING (logged only) |
| CLOSING | CS | name END_CLICK | `END_BUTTON_CLICKED{label}` | endClickAt=at, `closingUntil = at + tailMin*60000`; effect `CLOSING_ALARM_SET{when}` (timer reset; `outcome` unchanged) |
| CLOSING | CS | name END_MARKER, `!markerSeen` | `END_MARKER_SEEN{marker}` | markerSeen=true; CLOSING (outcome unchanged, timer not reset) |
| CLOSING | CS | name SCREEN_CHANGED | `SCREEN_CHANGED{hash}` | CLOSING (the SW dispatches this input only for a kept capture, §6) |
| CLOSING | TAB_REMOVED / TICK | exam tab gone | `EXAM_TAB_CLOSED{}`, `SESSION_DISARMED{outcome,trigger}` | IDLE immediately; effects `CLOSING_ALARM_CLEAR`, `END{outcome}` |
| CLOSING | CLOSING_TIMER | — | `SESSION_DISARMED{outcome,trigger}` (ids = exam tab/window) | IDLE; effect `END{outcome}` |
| CLOSING | STARTUP | `examTabs` non-empty, `closingUntil > at` | none | re-adopt `examTabs[0]`, away.* reset; effect `CLOSING_ALARM_SET{when:closingUntil}` |
| CLOSING | STARTUP | `examTabs` empty or `closingUntil <= at` | `SESSION_DISARMED{outcome,trigger}` | IDLE; effects `CLOSING_ALARM_CLEAR`, `END{outcome}` |
| CLOSING | MAX_TIMER / ABANDON_TIMER | — | none | CLOSING (stale alarms) |

Every input in ARMED or CLOSING sets `lastActivityAt = at`. Every emitted event gets
`seq = ++session.seq` and carries `tabId`/`windowId` from the input when present; while
`state === 'CLOSING'` the reducer prepends `phase:'tail'` to `data` (the log line grammar is
unchanged: `phase` is an ordinary data key). Result/start/exam classification precedence is
**result > start > exam** (`urlmatch.classify`).

### Persistence & restart recovery

- `session` is written to `chrome.storage.local` after every reduce, before effects run.
- **SW restart** (normal sleep/wake): nothing special — state is in storage. `meta.lastSeenAt`
  is updated by every `dispatch()` and every `tick`. Inside `dispatch()`, before reducing the
  incoming input, if `session.state!=='IDLE'` and `input.at − meta.lastSeenAt > 90000` (three
  missed 30 s ticks — only possible if the extension could not run), a `GAP` input is reduced
  first with `reason: input.kind==='STARTUP' ? 'browser-restart' : 'sw-restart'`. Doing it inside
  `dispatch` (not at SW top level) avoids a race between module evaluation and `onStartup`.
- **Chrome restart / crash**: `runtime.onStartup` → query all tabs; those whose URL classifies as
  start/exam/result form `examTabs`; dispatch `STARTUP{examTabs}` (the gap rule above emits
  `EXTENSION_GAP{reason:'browser-restart'}` in the same dispatch). Tab ids change across restarts,
  so re-adoption is by URL, never by id. `recover()` runs for ARMED **and** CLOSING sessions; in
  CLOSING the STARTUP rows above either re-arm the `closing` alarm or end the session at once
  when `closingUntil` has already passed. `chrome.alarms` (`abandon`, `max`, `closing`) persist
  across SW and browser restarts on their own; re-setting them is idempotent.
- **Page refresh** in the exam tab: `NAV` on the same tabId → `EXAM_NAV` only if the URL changed.

### ABANDONED timeout

Alarm name `abandon`, created with `{ when }` (absolute), cleared when the exam tab is adopted
again. On alarm the SW dispatches `ABANDON_TIMER`. Default 10 minutes (`abandonMin`).

### MAX and CLOSING timers

Alarm `max` is created at arming with `{ when: maxAt }` when `maxMin > 0` and cleared at tail
start or disarm; on alarm the SW dispatches `MAX_TIMER`. Alarm `closing` is created at tail start
(and re-created by an `END_CLICK` in CLOSING) with `{ when: closingUntil }`; on alarm the SW
dispatches `CLOSING_TIMER`. Both are one-shot. A stale alarm (fired after the state it belonged
to ended) is a no-op in the reducer.

### Session end (`END` effect)

1. Render `summary.txt` and `summary.html` (inline screenshots) from `events`, `shots`, session.
2. Enqueue final `log.txt`, `events.jsonl`, `summary.txt`, `summary.html`; flush.
3. If the `summary.html` download is rejected, enqueue the linked variant
   (`renderSummaryHtml({... inlineShots:false})`, screenshots referenced as `screenshots/<file>`).
4. Clear `session`→IDLE, `events`, `lines`, `shots`. `pending` is **kept** (file names include the
   session id, so unflushed writes of an ended session replay safely later).

## 5. Event catalogue

Field `data` per event; every event also has `seq`, `ts` (ISO 8601 UTC), `t` (epoch ms),
`name`, `tabId?`, `windowId?`, `shot` (`screenshots/…jpg` or `null`).

| Event | Source API | `data` fields | Screenshot |
|---|---|---|---|
| SESSION_ARMED | webNavigation.onCommitted (frameId 0) / CS `START_CLICK` | url, trigger (`nav`/`button`), label? | yes |
| SESSION_DISARMED | alarm `closing` / exam tab gone in CLOSING / alarm `abandon` / `MAX_TIMER` with tab gone / any trigger when `tailMin=0` | outcome (`SUBMITTED`/`AUTO_SUBMITTED`/`RESULT`/`TIMED_OUT`/`ABANDONED`), trigger (`button`/`marker`/`result`/`max`/`abandon`), label?, url? | yes unless ABANDONED (ids = exam tab/window; best effort) |
| START_BUTTON_CLICKED | CS `START_CLICK` while ARMED/CLOSING | label | yes |
| END_BUTTON_CLICKED | CS `END_CLICK` on exam tab | label | yes |
| END_MARKER_SEEN | CS `END_MARKER` on exam tab (once per session) | marker | yes |
| RESULT_PAGE | onCommitted/onHistoryStateUpdated/onReferenceFragmentUpdated to the result prefix while ARMED | url | yes (from the tab that committed) |
| MAX_TIME_REACHED | alarm `max` | maxAt | yes (exam window) |
| SCREEN_CHANGED | CS `SCREEN_CHANGED` while CLOSING, only when the capture is kept (§6) | hash, phase | yes (always: the event exists only because a new shot was kept) |
| EXAM_NAV | onCommitted / onHistoryStateUpdated / onReferenceFragmentUpdated on exam tab | url, adopted? | no |
| EXAM_WINDOW_MOVED | tabs.onActivated / onCommitted on the exam tab with a different windowId | from, to | no |
| EXAM_TAB_CLOSED | tabs.onRemoved / TICK backstop | — | no |
| TAB_SWITCH | tabs.onActivated | toTabId, toUrl, toTitle, toWindowId, incognito | yes |
| TAB_RETURN | tabs.onActivated (exam tab) | awayMs | no |
| PARALLEL_PAGE | onCommitted (other tab, or exam tab navigated off-site) / onActivated | url, title?, trigger (`committed`/`activated`), incognito | yes when trigger=`activated` |
| WINDOW_MINIMIZED | windows.onFocusChanged→windows.get; TICK poll; CS visibility PROBE | — | no |
| WINDOW_RESTORED | same | minimizedMs | no |
| FOCUS_LEFT_CHROME | windows.onFocusChanged (WINDOW_ID_NONE); CS blur PROBE — both re-check the focused window after a 500 ms settle, because a modal dialog (the site's alert/confirm, Chrome's share dialog) reports no focus for ~200 ms and then the window again; the event keeps the time of the first observation | desktopShot? (§6a) | yes (best effort) |
| FOCUS_RETURNED | windows.onFocusChanged | awayMs, desktopShot? | no |
| WINDOW_OPENED | windows.onCreated | windowId | yes |
| WINDOW_CLOSED | windows.onRemoved | windowId | no |
| INCOGNITO_WINDOW_OPENED | windows.onCreated (incognito) | windowId | yes |
| FULLSCREEN_EXIT | CS fullscreenchange; window state fullscreen→other | source (`document`/`window`) | yes |
| COPY / CUT / PASTE | CS clipboard events | len (selection or pasted text length; content never recorded) | yes |
| CONTEXTMENU | CS contextmenu | tag (target element tag) | yes |
| PRINT | CS beforeprint | — | yes |
| DRAG | CS dragstart | len (selection length), tag | yes |
| DEVTOOLS_OPENED | CS resize heuristic (outer−inner ≥ 160 px) | dw, dh | yes |
| IDLE_START | chrome.idle.onStateChanged | state (`idle`/`locked`) | no |
| IDLE_END | chrome.idle.onStateChanged | idleMs | no |
| DOWNLOAD_STARTED | downloads.onCreated (not `byExtensionId===runtime.id`, and not a `data:` URL — see §14) | url, filename, mime | yes |
| EXTENSION_GAP | SW boot / runtime.onStartup | lastSeenAt, gapMs, reason (`sw-restart`/`browser-restart`) | no |
| CONFIG_CHANGED | storage.onChanged on config while ARMED/CLOSING | keys | yes |
| PERIODIC | alarm `periodic` | desktopShot? | yes |
| DESKTOP_CAPTURE_STARTED | holder `started` (§6a); at arm when already sharing | width, height, pickMs, resumed? | yes |
| DESKTOP_CAPTURE_DECLINED | holder `cancelled`; holder window closed while prompting | asks | yes |
| DESKTOP_CAPTURE_STOPPED | holder `ended`; holder window closed while on; tick `grab` not alive | reason (`stop-sharing`/`window-closed`/`error`), error? | yes |
| DESKTOP_CAPTURE_FAILED | holder `failed` (`getUserMedia` rejected) | error | yes |
| DESKTOP_FRAME | holder `frame` while focus is away, when kept (§6a) | n | desktop frame only: `shot` is the desktop file, no tab capture |

### 5a. Screensaver / lock attribution (added 2026-09-12)

A screensaver or lock screen makes the exam page lose focus exactly like Alt-Tab does, and the
exam site itself reacts to that blur. The extension must tell the two apart. Signal:
`chrome.idle.onStateChanged` fires `"locked"` when "the screen is locked or the screensaver
activates" (Chrome docs), and `"idle"` when no input has been generated system-wide for the
detection interval. Both are recorded as `IDLE_START{state}` / `IDLE_END{idleMs}`; a real machine
commonly reports `idle` first (detection interval) and only `locked` once the screensaver actually
engages, so the reducer closes the `idle` interval and opens a fresh `locked` one on that
transition (§4) instead of silently dropping the second state. Attribution itself happens in
`tally` (pure, at summary time), so the append-only log format is unchanged.

Rule, applied per `FOCUS_LEFT_CHROME` interval `[t0, t1]` (`t1` = matching `FOCUS_RETURNED`, or
session end if none):
- `screensaver` if an `IDLE_START{state:'locked'}` occurs at any `t` with `t0 - 3000 <= t <= t1`
  (the idle poller can report up to ~1 s after focus is lost; 3 s is the tolerance).
- else `idle` if an `IDLE_START{state:'idle'}` occurs in the same window (no input anywhere on
  the machine: the candidate was not using another application; covers platforms where the
  screensaver is not reported as `locked`).
- else `user`.

`tally` output: `counts.SCREENSAVER` = number of `IDLE_START{state:'locked'}`;
`attribution = { screensaver, idle, user }` = number of `FOCUS_LEFT_CHROME` in each class;
`durations.focusLeftMs` = user-attributed intervals only; `durations.screensaverMs` = sum of
locked intervals; `durations.idleMs` = sum of idle-state intervals (locked intervals are not
double-counted there).

Verified 2026-09-12: the API contract is documented; a live macOS test with a manually launched
`ScreenSaverEngine` did not produce `locked` because a manual launch does not post the system
notification Chromium observes, so the real trigger (idle timeout / hot corner) must be checked
during centre dry-run (docs/centre-setup.md step 6). The `idle` fallback exists for that case.

Content-script names on the wire (`CS` input): `COPY`, `CUT`, `PASTE`, `CONTEXTMENU`, `PRINT`,
`DRAG{len,tag}`, `FULLSCREEN_EXIT`, `DEVTOOLS`, `VISIBILITY{hidden}`, `BLUR`, `FOCUS`, `START_CLICK{label}`,
`END_CLICK{label}`, `END_MARKER{marker}`, `SCREEN_CHANGED{}`. The content script runs the marker
check and `SCREEN_CHANGED` on a trailing 1 s debounce of DOM mutations with a 5 s ceiling, so a
page element that updates every second (a countdown) cannot postpone it forever.

Click matching in the content script: capture-phase `click` listener on `document`; the control
is `e.target.closest('button, a, input[type=submit], input[type=button], [role=button]')`; its
label is `innerText || value || aria-label`, normalised as in §3 and compared for exact equality
against `startButton` / the `endButton` list (start checked first). Events emitted while
`session.state === 'CLOSING'` carry `data.phase:'tail'`; nothing else marks the phase.

Windows-state detection (adjusted from "~1 s poll"): `windows.onFocusChanged` fires the moment a
window is minimised (focus → none) and the CS `visibilitychange` fires too; both trigger a
`windows.get(examWindowId)` probe, so MINIMIZED/RESTORED land within ~100 ms. The 30 s `tick`
alarm (`windows.getAll`) reconciles anything missed (e.g. restored while the SW was asleep).

## 6. Screenshot policy

- API: `chrome.tabs.captureVisibleTab(windowId, { format:'jpeg', quality:50 })` — the visible tab
  of `event.windowId`, else of `windows.getLastFocused()`. Requires `<all_urls>`.
- Trigger: every event with `needsShot(event)===true` (table above) and the `periodic` alarm
  (`shotIntervalMin`, default 10 → ~18 periodic + ~35 event shots ≈ 55 per paper).
- **Coalescing:** Chrome limits `captureVisibleTab` to 2 calls/s. The SW keeps
  `meta.lastShot = {at, file}`; if `now − at < 2000` the event reuses `lastShot.file` instead of
  capturing. This also guarantees unique file names (one per second at most).
- File name: `screenshots/<YYYYMMDD-HHMMSS>_<EVENT>.jpg` (`ids.shotFile`), local time.
- Failure (chrome:// pages, minimised window, throttling): `event.shot=null`,
  `event.data.shotError=<message>`; the event is still recorded.
- The base64 body is stored in `shots[file]` in storage.local (needs `unlimitedStorage`; ~15 MB
  worst case) so `summary.html` can embed every screenshot at session end, and is enqueued as a
  file write immediately.
- **Post-submit tail (`SCREEN_CHANGED`):** handled by the SW **before** the reducer runs, inside
  the serialised queue. The input is dropped unless `session.state === 'CLOSING'`, the sender is
  the exam tab and that tab is `active` in its window (otherwise `captureVisibleTab` would show
  another tab). The SW captures, computes `hash = shortHash(b64)`, and asks
  `tailshots.decide(meta.tail, { hash, at })` (pure): keep only if `hash !== tail.lastHash`,
  `at − tail.lastAt >= 3000` and `tail.count < 60`. On keep, `meta.tail` becomes
  `{ count+1, lastHash: hash, lastAt: at }`, the reducer is dispatched with
  `CS SCREEN_CHANGED{hash}` and `takeShots` files the pre-captured image for that event (no second
  capture, the 2 s coalescing rule does not apply, `meta.lastShot` is updated). On drop nothing is
  recorded. `meta.tail` is reset to `{ count:0, lastHash:null, lastAt:0 }` when a dispatch moves
  the session from ARMED to CLOSING. The 30 s `tick` remains the floor when no content script
  runs on the submitted screen (other origin).

## 6a. Desktop capture (added 2026-09-15)

Records what the candidate opened when focus leaves Chrome: JPEG frames of the whole screen from
a stream the candidate grants once through Chrome's own screen-share dialog. Nothing is
installed, no invigilator click is needed, the exam tab is never blocked. Windows first; macOS
differs only in a one-time permission (§11). Config: `desktopCapture`, `desktopRepromptMin` (§3).

**Why a holder window.** `chrome.desktopCapture.chooseDesktopMedia` fails from the service worker
("A target tab is required"), and a target tab would bind the stream to the exam page origin and
lose it on the next navigation. From an extension page it needs neither a target tab nor a user
gesture, but the stream id may only be consumed by the *same* page that requested it (an
offscreen document gets "Error starting tab capture"). So the SW opens one small extension window
(`chrome.windows.create({ url: src/holder/holder.html, type:'popup', width:460, height:140,
focused:true })`) and that page both requests the id (`chooseDesktopMedia(['screen'])`) and
consumes it (`getUserMedia({ video:{ mandatory:{ chromeMediaSource:'desktop', chromeMediaSourceId,
maxFrameRate:2 } } })`), holds the stream and answers frame requests by drawing the video onto a
canvas (JPEG q0.5, scaled to ≤ 1280 px wide, ~60–90 KB). The SW never calls `chooseDesktopMedia`.
It minimises the holder when the stream starts and restores it for every re-ask; one holder
serves every ask (a second window is opened only when the first is gone). The holder's own
`WINDOW_CREATED`/`WINDOW_REMOVED`/`NAV`/`TAB_ACTIVATED` inputs are dropped in `dispatchNow`
(window id equals `meta.desktop.holderWindowId`, or `url` equals the holder URL) before the
reducer sees them. The stream survives SW sleeps (alive on every 30 s tick in the spike); it
does not survive a browser restart.

**Messages.** Holder → SW `{type:'desktop', name, …}`: `ready` (page loaded; the SW answers
`{ask, close}` — `ask` when this window is the current holder and a dialog is wanted, `close`
when the SW does not know the window, e.g. one Chrome restored by itself), `started{width,height,
pickMs}`, `cancelled{pickMs}`, `failed{error,pickMs}`, `ended` (video track `ended`: Stop sharing
pressed), `frame{b64}` (away loop). SW → holder `{type:'holder', name, …}`: `ask` (stop any
current stream, open the dialog again), `grab` → `{b64, alive}`, `away{on}`
(start/stop posting `frame` every 10 s). All holder → SW messages are handled in one queue step.
SW → holder messages are sent with `chrome.tabs.sendMessage(meta.desktop.holderTabId, …)`, never
broadcast; holder → SW messages other than `ready` are accepted only when `sender.tab.id ===
meta.desktop.holderTabId`, and `ready` from any other tab is answered `{close:true}`.

**State** (`meta.desktop`; pure transitions in `core/desktop.js`):
`{ state, at, since, holderWindowId, holderTabId, asks, width, height, error, nextAskAt }`
(`holderTabId`: tab id of the holder page; `null` when no holder exists), `state` ∈ `off`
(initial; config off; after session end) · `prompting` (dialog open) · `on` · `declined` (Cancel,
or holder window closed while prompting) · `stopped` (Stop sharing, holder window closed while
on, or the tick `grab` not alive) · `error` (`getUserMedia` rejected). `at` is the last transition,
`since` the start of the current `on` span, `asks` the dialogs shown in the current session
(reset at arm). Popup line (`describeDesktop(desktop, frames, now)`): `on since HH:MM:SS (N
frames)` · `asking…` · `off — declined Nx, next ask HH:MM:SS` (or `off — declined Nx` when no
timer) · `stopped at HH:MM:SS` · `error: <message>` · `off`.

**Trigger and re-prompt** (`shouldPrompt(desktop, { at, repromptMin })`; applied only when
`config.desktopCapture === 'on'` and `chrome.desktopCapture` exists):
- A `NAV` to the start prefix (any tab, IDLE or ARMED) and the IDLE → ARMED transition both call
  `promptDesktop`, which opens (or re-shows and re-asks) the holder when `state` is `off`,
  `stopped` or `error`, or `declined` with `repromptMin > 0` and `at − desktop.at ≥ repromptMin ×
  60000`. Never while `prompting` or `on`.
- If capture is already `on` when the session arms, the SW reduces `DESKTOP STARTED{width,
  height, pickMs, resumed:true}` right after the arming dispatch so the session log records that
  the screen was captured from the start.
- Decline → `declined`, `DESKTOP_CAPTURE_DECLINED{asks}`; with `repromptMin > 0` the one-shot alarm
  `desktopAsk` (§10) fires at `at + repromptMin × 60000` and prompts again only while the session
  is ARMED/CLOSING and `state` is `declined` or `error`. `repromptMin = 0` asks once per trigger.
- `ended` (Stop sharing) → `stopped`, `DESKTOP_CAPTURE_STOPPED{reason:'stop-sharing'}`, re-ask at
  once in the same holder. Holder window closed while `on` → `STOPPED{reason:'window-closed'}`,
  new holder at once; closed while `prompting` → treated as a decline. `failed` → `error`,
  `DESKTOP_CAPTURE_FAILED{error}`, then the decline timer applies.
- Liveness and floor: every `tick` while `on` the SW sends `grab`; `alive:false` or no answer → `stopped`
  with `reason:'error'` and an immediate re-ask. While focus is away the returned frame goes through
  the away dedupe like a holder frame: the holder's 10 s loop is throttled to one timer a minute once
  its window has been hidden for 5 min, so the tick is the floor under it.
- Session end (`END` effect) closes the holder and sets `state:'off'` (no event: the session is
  over). `desktopCapture` switched to `'off'` does the same at once; switched to `'on'` while
  ARMED/CLOSING prompts at once.
- Chrome's "is sharing your screen — Stop sharing / Hide" bar is browser UI: the extension can
  neither hide it nor press it. Stop sharing never ends a session; no end trigger changes.

**Frames** (`screenshots/desktop/<YYYYMMDD-HHMMSS>_<EVENT>.jpg`, `ids.desktopShotFile`; kept in
`shots[file]` and enqueued exactly like tab screenshots; `needsDesktopFrame(ev)` in
`core/events.js`), only while `state === 'on'` and the session is ARMED/CLOSING:
- `FOCUS_LEFT_CHROME`: `takeShots` grabs one frame at once → `data.desktopShot`; then the SW resets
  `meta.desktopAway` to `EMPTY_TAIL` and tells the holder `away{on:true}`.
- While away the holder posts `frame{b64}` every 10 s. The SW (queue step `desktopFrame`) drops
  it unless the session is ARMED/CLOSING and `state === 'on'`, computes `hash = shortHash(b64)`
  and applies `tailshots.decide(meta.desktopAway, { hash, at }, { cap: 40 })` — same hash dedupe,
  3 s minimum gap, cap 40 per away episode. Kept → `meta.desktopAway` advances and `DESKTOP
  FRAME{n: count}` is reduced with `pre.desktop = b64`; `takeShots` files it as that event's
  `shot` (no tab capture). Dropped → nothing recorded.
- `FOCUS_RETURNED`: one frame → `data.desktopShot`; holder told `away{on:false}`.
- `PERIODIC`: one frame → `data.desktopShot` (cheap; proves liveness in the log).
- A grab with no frame records `data.desktopShotError` and keeps the event. The 2 s tab-capture
  coalescing rule does not apply to desktop frames.

**Persistence and restart.** `meta.desktop` and `meta.desktopAway` live in storage.local, so an SW
restart changes nothing (the holder page keeps the stream). A browser restart loses the stream
and the holder: `recover()` resets `meta.desktop` to `off` (window ids are not stable across
restarts, so the old id is dropped, never closed) and, for an ARMED/CLOSING session, prompts once
immediately; later re-asks follow the decline timer. A holder page Chrome restored on its own
reports `ready` with an unknown window id and is told `{close:true}`.

**Windows vs macOS.** Windows: nothing to configure. macOS: Chrome needs the Screen Recording
permission once per machine (System Settings → Privacy & Security → Screen Recording → Chrome);
without it `getUserMedia` succeeds and every frame is black — recorded, not detected. No code
path branches on the OS.

**Accepted limitations.** The sharing bar and its Hide / Stop sharing buttons cannot be
controlled; a candidate can Cancel, Stop or close the holder repeatedly (each is logged with a
tab screenshot and re-asked per the policy above); frames show the screen Chrome exposes (the
primary screen the candidate picked); nothing here changes when a session starts or ends.

## 7. Persistence design

- **Sink:** `chrome.downloads.download({ url:'data:<mime>;base64,<b64>', filename:
  '<subfolder>/<sessionId>/<relative>', conflictAction:'overwrite', saveAs:false })`. Verified in
  the spike from a SW with no page and no click, on install and on startup. All paths use
  `session.subfolder` (frozen at arm, §3), not the live `config.subfolder`.
- **Encoding:** text files are UTF-8 → base64 via `TextEncoder` + chunked `btoa` (`sink.toDataUrl`);
  JPEGs are already base64 from `captureVisibleTab`.
- **Pending map:** storage key `pending = { [relativePathWithSession]: { mime, b64 } }`. A later
  `put` of the same path replaces the body (overwrite semantics — `log.txt` is rewritten whole on
  every flush, ~200 KB for a 3-hour paper).
- **Flush protocol:** `flush()` runs after every appended event and on the 30 s `tick` alarm
  (brief said 10 s; alarms floor is 30 s). Guarded by an in-memory `flushing` flag; a second call
  during a flush sets `flushAgain`. For each pending path: `download()`; on resolve → delete from
  `pending`; on reject → keep, record `meta.lastFlushError`. `meta.lastFlushAt` set at the end.
  Because SW may die mid-flush, `pending` is only mutated *after* each successful download call;
  anything else replays on the next flush.
- **Download UI suppression:** at SW boot call `chrome.downloads.setUiOptions({enabled:false})`
  (permission `downloads.ui`, Chrome 105+; wrapped in try/catch for Edge). Also
  `downloads.onChanged`: when `delta.state.current==='complete'` and the item's
  `byExtensionId===chrome.runtime.id` → `chrome.downloads.erase({id})` so the history/shelf stays
  empty. `saveAs:false` plus the centre policy "Ask where to save each file = off" ensure no
  dialog.
- **data: URL size:** individual files are ≤ 300 KB except `summary.html` (≈ 8–15 MB with ~55
  inline JPEGs). Chrome's 2 MB data: URL limit applies to *navigations*, not to
  `downloads.download`; the spike did not test a 15 MB body, so the fallback in §4 (linked
  screenshots) is mandatory, not optional.
- **Storage layout (`chrome.storage.local`):** `config` · `session` · `events[]` · `lines[]`
  (chained log lines incl. header) · `lastHash` · `shots{}` · `pending{}` ·
  `meta{lastSeenAt,lastFlushAt,lastFlushError,lastShot,configErrors,tail,desktop,desktopAway}`.

## 8. File formats

All files live in `<downloads>/<subfolder>/<sessionId>/`. `sessionId = YYYYMMDD-HHMMSS_<SEAT>`
(local time, seat sanitised).

### log.txt line grammar

```
line0  := '# ExamEye session ' id ' seat=' json(seatRaw) ' started=' iso ' tz=' offset ' #' GENESIS
lineN  := iso ' ' NAME (' ' key '=' value)* (' shot=' json(shotFile))? ' #' hash8(line(N-1))
value  := json(string) | number | 'true' | 'false' | 'null' | json(object)
GENESIS := '00000000'
hash8   := first 8 hex chars of SHA-256 over the full previous line (without '\n')
```
Keys: `tab`, `win` (when present) first, then `data` keys in insertion order. Example:
```
# ExamEye session 20260912-091502_A17 seat="A17" started=2026-09-12T03:45:02.117Z tz=+05:30 #00000000
2026-09-12T03:45:02.117Z SESSION_ARMED tab=41 win=3 url="https://exam.example.com/start?c=9" shot="screenshots/20260912-091502_SESSION_ARMED.jpg" #3f9a1c0e
2026-09-12T03:47:10.004Z TAB_SWITCH tab=42 win=3 toTabId=42 toUrl="https://google.com/" toTitle="Google" toWindowId=3 incognito=false shot="screenshots/20260912-091710_TAB_SWITCH.jpg" #b17e02d4
```
`hashchain.verify(lines)` recomputes the chain and returns `{ok, firstBad}`; summary.txt reports
the result. A tampered or truncated file breaks the chain from that line onward.

### events.jsonl

One JSON object per line, same order as log.txt (no header line):
```
{"seq":1,"ts":"2026-09-12T03:45:02.117Z","t":1789530302117,"name":"SESSION_ARMED","tabId":41,"windowId":3,"data":{"url":"…"},"shot":"screenshots/…jpg","hash":"3f9a1c0e"}
```
`hash` is the hash of the corresponding log.txt line (so the two files cross-check).

### summary.txt

```
ExamEye summary
Session:   20260912-091502_A17   Seat: A17
Started:   2026-09-12 09:15:02 (+05:30)   Ended: 2026-09-12 12:15:44   Outcome: SUBMITTED
Trigger:   end button "Submit" clicked at 12:10:44   (auto-submit expected at 12:15:02)
Duration:  03:00:42
Log chain: OK (312 lines)
Desktop:   on 09:15:04 - 12:15:44 (37 frames)

Phases
  Exam ............. 09:15:02 - 12:10:44  47 screenshots
  Post-submit tail . 12:10:44 - 12:15:44  7 screenshots

Counts
  TAB_SWITCH ............. 4
  FOCUS_LEFT_CHROME ...... 2
  ... (every event name with count > 0, alphabetical)

Time away
  Tab away ......... 00:03:12
  Focus left ....... 00:01:05   (user; screensaver: 1, idle: 0 not counted)
  Minimized ........ 00:00:00
  Screensaver/lock . 00:04:10
  Idle ............. 00:00:00

Parallel pages (focused time, visits)
  00:02:40  3  https://google.com/  "Google"
  ...

Screenshots: 54 (screenshots/)
Desktop frames: 37 (screenshots/desktop/)
```

`Trigger:` is rendered by `describeOutcome(session)` (`core/summary-text.js`, shared with the HTML
renderer): `end button "<label>" clicked at HH:MM:SS` · `end marker "<phrase>" seen at HH:MM:SS`
· `result URL <url> reached at HH:MM:SS` · `maximum time (<maxMin> min) reached at HH:MM:SS` ·
`exam tab closed and not reopened`. The parenthesised `auto-submit expected at HH:MM:SS` appears
when `session.maxAt` is set. `Ended:` is the tail end; the `Phases` block lists the exam phase
(`startedAt` → `examEndedAt`) and, when a tail ran, the post-submit tail (`examEndedAt` →
`Ended`) each with its distinct screenshot count (`tally.tail = { events, shots }` counts events
with `data.phase === 'tail'`). Sessions without a tail omit the tail line.

`Desktop:` is rendered by `describeDesktopSummary(tally.desktop, endedAt)` (`core/summary-text.js`,
shared with the HTML renderer) from `tally.desktop = { frames, asks, declined, failed, spans:
[{ from, to, stopped }] }` (`frames` = distinct desktop files over `data.desktopShot` and
`DESKTOP_FRAME.shot`; a span opens at `DESKTOP_CAPTURE_STARTED` and closes at the next
`DESKTOP_CAPTURE_STOPPED` (`stopped:true`) or at `endedAt` (`to:null`)): `off` when there is no
desktop event and no frame · `declined (N asks)` when nothing was ever shared · `failed: <error>`
· otherwise `on HH:MM:SS - HH:MM:SS` per span, joined as `on A - B, stopped at B, re-shared C - D`,
then ` (N frames)`, then `; declined Nx` when declines happened between spans. The
`Desktop frames:` line is omitted when `frames` is 0.

### summary.html

Single self-contained page, no external resources, no scripts: header block (same facts as
summary.txt, including the Trigger row and a Phases table), counters table, time-away table,
parallel-page table, a Desktop capture section (the `Desktop:` status line and a table of the
`DESKTOP_*` events: time, event, details), timeline table (one row per event: time, name, key
fields, thumbnail link, desktop-frame link from `data.desktopShot` or a `DESKTOP_FRAME`'s `shot`;
tail-phase rows are visible by their `phase:"tail"` data key), and a screenshots section listing
tab screenshots and desktop frames alike, each JPEG as `<img src="data:image/jpeg;base64,…">`
(inline variant) or `<img src="screenshots/<file>">` (linked variant). All text is HTML-escaped by
the renderer (`escapeHtml`).

## 9. Permissions & manifest

```json
{
  "manifest_version": 3,
  "name": "ExamEye",
  "version": "0.1.0",
  "description": "Records browser activity during an online exam. Records only; never blocks.",
  "minimum_chrome_version": "120",
  "permissions": ["tabs", "webNavigation", "alarms", "storage", "unlimitedStorage",
                  "downloads", "downloads.ui", "idle", "scripting", "desktopCapture"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/sw.js", "type": "module" },
  "options_page": "src/options/options.html",
  "action": { "default_popup": "src/popup/popup.html", "default_title": "ExamEye" },
  "incognito": "spanning"
}
```
Additions over the brief's expected list, with reasons: `scripting` (required by
`registerContentScripts`, which the brief mandates); `unlimitedStorage` (screenshots retained in
storage.local for summary.html exceed the 10 MB default quota); `desktopCapture` (the holder
page's `chooseDesktopMedia`, §6a; the holder is an extension page opened by the extension itself,
so no `web_accessible_resources` entry is needed). `windows` needs no permission entry. `incognito: spanning` lets the one SW see incognito windows once "Allow in Incognito" is
enabled.

Content script registration (`adapters/scripting.js`): on boot and on config change,
`unregisterContentScripts({ids:['exam']})` then `registerContentScripts([{ id:'exam',
js:['src/content.js'], matches: patterns, runAt:'document_start', allFrames:false,
persistAcrossSessions:true }])` where `patterns = [prefixToMatchPattern(startPrefix),
prefixToMatchPattern(effectiveExamPrefix)]` deduplicated. `prefixToMatchPattern` strips query and
fragment and appends `*` to the path (`https://exam.example.com/start?x=1` →
`https://exam.example.com/start*`); prefix matching of the full URL still happens in the SW.

## 10. Alarms

| Name | Schedule | Handler |
|---|---|---|
| `tick` | `periodInMinutes: 0.5` | poll windows/exam tab → `TICK`; `meta.lastSeenAt=now`; `flush()` |
| `periodic` | `periodInMinutes: shotIntervalMin` (recreated on config change) | `PERIODIC` when ARMED |
| `abandon` | `when: tabLostAt + abandonMin*60000` (one-shot) | `ABANDON_TIMER` |
| `max` | `when: startedAt + maxMin*60000` (one-shot, only when `maxMin>0`; cleared at tail start / disarm) | `MAX_TIMER` |
| `closing` | `when: closingUntil` (one-shot; re-created on `END_CLICK` in CLOSING; cleared at disarm) | `CLOSING_TIMER` |
| `desktopAsk` | `when: desktop.at + desktopRepromptMin*60000` (one-shot; set on decline/failure when `desktopRepromptMin>0`; cleared when the stream starts and at session end) | `promptDesktop` while ARMED/CLOSING and `meta.desktop.state` is `declined`/`error` (§6a) |

## 11. Chrome vs Edge differences

| Topic | Chrome | Edge (Chromium) |
|---|---|---|
| Install source | Web Store or unpacked | Edge Add-ons or unpacked; `ExtensionInstallForcelist` policy also accepts Chrome Web Store ids via update URL |
| Incognito | "Allow in Incognito" toggle; policy `IncognitoModeAvailability=1` disables incognito | "Allow in InPrivate" toggle; same policy name |
| Download dir policy | `DownloadDirectory`, `PromptForDownloadLocation=false` | same policy names |
| `downloads.setUiOptions` | Chrome 105+ | Supported in Edge ≥ 105 per Edge API support list; call is try/catch-wrapped — if unsupported the flyout shows; nothing else breaks |
| Sleeping tabs / efficiency mode | Memory Saver discards background tabs | Edge sleeping tabs may discard the exam tab when it is not active; discarded tab keeps its id, `tabs.onUpdated` reload re-injects the content script. Centre checklist: add exam site to "never sleep" list |
| `chrome.*` namespace | native | `chrome.*` available; no `browser.*` needed |
| `chrome.desktopCapture` | native screen picker; `--auto-select-desktop-capture-source` auto-accepts it (harness) | same API and permission name; Edge shows its own picker dialog — confirm during the centre dry run |
| Minimum version | 120 (alarms floor, `unlimitedStorage`) | 120 |

Nothing in the code branches on the browser.

Operating systems (desktop capture, §6a): Windows needs nothing. macOS needs the Screen Recording
permission for the browser once per machine; without it frames are black, not missing. Nothing
in the code branches on the OS either.

## 12. Testing strategy

### Unit (`npm test` → `node --test tests/unit/`, Node ≥ 22)

- Every `core/*` module has a `tests/unit/<module>.test.js` using `node:test` + `node:assert/strict`.
  `hashchain` uses `globalThis.crypto.subtle`, available in Node and the SW alike.
- `tests/unit/fake-chrome.js` provides an in-memory `globalThis.chrome`: `runtime` (id, onStartup,
  onInstalled, onMessage), `storage.local` (get/set/remove + onChanged), `alarms`, `tabs`
  (query/get/captureVisibleTab/onActivated/onRemoved/onUpdated), `windows`
  (get/getAll/getLastFocused/onFocusChanged/onCreated/onRemoved), `webNavigation.onCommitted`,
  `idle`, `downloads` (download → records call, resolves id; onCreated/onChanged; erase;
  setUiOptions), `scripting`. Each `onX` is `{addListener, emit}`. Adapter and `sw.js` tests import
  the fake, then the module, then `emit` events and assert on `chrome.storage.local` contents and
  the recorded download calls. For desktop capture the fake also provides `runtime.sendMessage`
  (recorded; a test-installed responder answers `grab`/`ping`), `runtime.getURL`,
  `windows.create/update/remove` (emitting `onCreated`/`onRemoved`) and an opt-in
  `chrome.desktopCapture` object (absent by default, so existing SW tests never prompt).

### Integration (`npm run test:integration` → `node --test tests/integration/`)

- `tests/integration/harness.js`: starts a `node:http` static server for
  `tests/integration/site/` (`/exam/start.html`, `/exam/q1.html`, `/exam/result.html`,
  `/other.html`) on an ephemeral port; launches
  `chromium.launchPersistentContext(tmpProfile, { channel:'chromium', headless:false, args:
  ['--disable-extensions-except=<repo>', '--load-extension=<repo>'] })`; waits for
  `context.serviceWorkers()[0]`; sends `Browser.setDownloadBehavior({behavior:'allow',
  downloadPath: tmpDownloads, eventsEnabled:true})` over a CDP session so extension downloads land
  under `tmpDownloads/<subfolder>/<sessionId>/` with their real names; sets config via
  `worker.evaluate(cfg => chrome.storage.local.set({config: cfg}), cfg)`.
- Scenarios: arm on start page → `session.state==='ARMED'` and `log.txt` exists; open second tab
  → `TAB_SWITCH`/`PARALLEL_PAGE` events and a screenshot file; navigate exam tab to result →
  IDLE, `summary.txt`, `summary.html`, `events.jsonl` present, log chain verifies.
- Desktop capture scenario: `launch(config, { args: ['--auto-select-desktop-capture-source=Entire
  screen'] })` makes the picker auto-accept; the test asserts `DESKTOP_CAPTURE_STARTED`, a
  `desktopShot` path on a forced `PERIODIC` (the alarm is re-created from the worker with a
  near-future `when`; unpacked extensions are exempt from the 30 s floor) and the JPEG download
  for that path — never pixel content (Playwright's Chromium has no Screen Recording permission
  on the dev Mac, so frames may be black). The native picker cannot be dismissed by Playwright,
  so the decline path is unit-tested only. Every other scenario sets `desktopCapture:'off'`.
- Requires `playwright` as a devDependency and the bundled Chromium
  (`npx playwright install chromium`).

### Manual

`docs/centre-setup.md`: install, "Allow in Incognito", options, policies, a 5-minute dry run and
what files to expect.

## 13. Out of scope (phase 1)

Naming other apps/browsers (only "focus left Chrome"); webcam;
blocking anything; server upload; folder picker / File System Access; `storage.managed`
consumption (shape is compatible, reading it is not wired); offscreen document; MV3 tab-discard
recovery beyond re-injection on reload.

## 14. Open risks

1. **`captureVisibleTab` limits** — 2 calls/s; coalescing covers bursts. Capturing a
   `chrome://`/Web Store page or a minimised window throws → recorded as `shotError`.
2. **summary.html data: URL size** — 8–15 MB untested through `downloads.download`; linked
   fallback is built in; blob: via offscreen document is the escape hatch if both fail.
3. **SW sleep during a 3-hour session** — all state is in storage and every listener is top-level;
   a missed `windows.onFocusChanged` while asleep is reconciled by the 30 s tick, so a
   MINIMIZED/RESTORED pair may be up to 30 s late. `EXTENSION_GAP` records unusually long gaps.
4. **Incognito visibility** — `INCOGNITO_WINDOW_OPENED` needs the one-time "Allow in Incognito"
   toggle; without it incognito windows are invisible to the extension and nothing is logged.
   On managed machines prefer `IncognitoModeAvailability=1`.
5. **Alarm floor** — 30 s ticks mean up to 30 s latency for backstop detections and flush replays;
   the primary paths (event-driven) are immediate.
6. **Storage growth** — `shots` ~15 MB + `events`/`lines` ~0.5 MB per session; cleared at session
   end; `unlimitedStorage` covers it.
7. **Unmanaged machines** — a candidate can disable the extension; only the resulting
   `EXTENSION_GAP` (on re-enable) or missing files reveal it.
8. **Playwright download-path override** — relies on `Browser.setDownloadBehavior` taking
   precedence over Playwright's own setting; if not, the harness falls back to
   `chrome.downloads.search()` from the SW and reads `item.filename`.
9. **Tab discard** (Memory Saver / Edge sleeping tabs) — the content script unloads with the tab;
   SW-side events (focus, activation, navigation) continue; the page-level events resume on reload.
10. **End marker must be a post-submission-only phrase.** The marker is matched as a substring of
    the whole page text, once per session; a phrase that also appears during the paper (in a
    warning, a footer, a hidden template) ends the exam phase early with `AUTO_SUBMITTED`. The
    centre dry run (docs/centre-setup.md §6) must confirm the phrase is absent on every in-paper
    screen and present on the submitted screen.
11. **Cancel after an end click.** `END_CLICK` starts the tail as soon as the configured button is
    clicked; if the platform then shows a confirm dialog and the candidate cancels, the session is
    already CLOSING. The paper continuing is visible only through the tail (screen changes keep
    being captured, another end click resets the timer) and through the marker not appearing; a
    button click alone cannot distinguish "submitted" from "cancelled". Configure the *confirm*
    button's label as the end button where the platform has one.
12. **Sharing bar, Hide, Stop sharing, holder window (§6a).** Chrome's "is sharing your screen"
    bar is browser UI an extension cannot hide or press; the candidate can Stop sharing, Cancel the
    dialog, or close the minimised holder window at any time. Each is logged
    (`DESKTOP_CAPTURE_STOPPED`/`DECLINED` with a tab screenshot) and re-asked per the policy; a
    candidate who declines every ask produces a log full of declines and no frames, and the
    invigilator sees it in the popup line. Stop sharing never ends a session. A second holder page
    opened by the candidate cannot answer for the real one.
13. **Black frames without macOS Screen Recording permission.** `getUserMedia` succeeds and every
    frame is black; the extension cannot detect it. The centre dry run (docs/centre-setup.md) must
    open `summary.html` and look at a frame. The dev Mac's Playwright Chromium has the same
    limitation, so integration tests assert on events and files only.
14. **Desktop frame volume.** Up to 40 frames per away episode plus one per `PERIODIC` and per
    `FOCUS_*` event, ~60–90 KB each, all retained in `shots{}` for the inline `summary.html`. A
    candidate who leaves Chrome many times can push `summary.html` past what a data: download
    accepts; the linked fallback (§7) covers it. No total cap in this phase.
15. **Holder window focus churn.** Opening/showing the holder moves window focus inside Chrome;
    `FOCUS` inputs for the holder are harmless (still Chrome) and its `NAV`/`TAB_ACTIVATED`/
    `WINDOW_*` inputs are filtered by id and URL, but any transient `WINDOW_ID_NONE` Chrome emits
    while switching windows is subject to the same spurious-FOCUS_LEFT risk the exam window
    already has.

- **`data:`-URL downloads are not logged.** The extension's own file writes are `data:` downloads, and
  under DevTools/CDP download overrides `byExtensionId` is undefined for them, which produced an
  unbounded write→DOWNLOAD_STARTED→write loop in the integration harness. `downloads.onCreated`
  therefore ignores every `data:` URL. A student export via `<a download href="data:…">` or a
  canvas save is consequently not recorded; `http(s):` and `blob:` downloads are.
