# ExamEye Button/Marker Triggers + Post-submit Tail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paper that starts with a Start button, stays on one URL across screens, and ends with a Finish/Submit click or a platform auto-submit is recorded correctly: arm on the button, end on button / marker / result URL / max-time backstop, then keep screenshots of screen changes for a post-submit tail before writing the files.

**Architecture:** Unchanged (spec §2): `src/core/*` pure, `src/adapters/*` thin, `src/sw.js` serialised queue (every storage writer runs inside `enqueue`; `dispatchNow` inside the queue, `dispatch` outside). New state `CLOSING` between `ARMED` and `IDLE`. The content script (`src/content.js`) is a **classic script with no imports**: it reads the raw `config` key from `chrome.storage.local`, inlines the label normaliser in one function, and follows `chrome.storage.onChanged`.

**Spec:** `/Users/pawank/DiskAlpha/Development/exameye/docs/superpowers/specs/2026-09-12-exameye-design.md` — already updated (§2, §3, §4, §5, §6, §8, §10, §14). Read those sections first; every task cites what it implements. The owner-approved decisions are in `/Users/pawank/DiskAlpha/Development/exameye/.superpowers/sdd/2026-09-13-test-finish/button-triggers-brief.md` and are final.

## Global constraints

- TDD: write the named failing test, run it and see it fail, then write the minimal code, then run the full command. `npm test`, `npm run test:integration`, `npm run check` are all run in the **foreground** and their real output read before a step is ticked.
- Each task leaves `npm test` and `npm run check` green (integration is run in Tasks 14 and 15 only). Each task ends with a ready-to-run commit command; do **not** run it unless the owner says so.
- Existing test fixtures: every `cfg`/`config` constant in `tests/unit/session-a.test.js`, `session-b.test.js`, `sw-*.test.js`, `options.test.js`, `popup.test.js` and `tests/integration/session.test.js` gets the new fields appended with `startButton: '', endButton: '', endMarker: '', maxMin: 0, tailMin: 0`. `tailMin: 0` preserves the meaning of every existing "result → IDLE" assertion. New tests set `tailMin` > 0 explicitly.
- No emojis. No comments unless the WHY is non-obvious. Surgical diffs; do not reformat neighbouring code.
- Matching rules (spec §3/§5, mirrored in `content.js`): label = `innerText || value || aria-label`; normalise = trim, collapse whitespace runs to one space, lower-case; button match is **exact** equality against the normalised list; marker match is substring of the normalised page text; click control = `e.target.closest('button, a, input[type=submit], input[type=button], [role=button]')`, capture phase.

## File map

| Path | Change |
|---|---|
| `src/core/config.js` | `DEFAULTS` + `STR`/`NUM` gain `startButton`, `endButton`, `endMarker`, `maxMin`, `tailMin`; `validate` new rules |
| `src/core/labels.js` (new) | `normalizeLabel`, `parseLabels`, `matchLabel` |
| `src/core/tailshots.js` (new) | `EMPTY_TAIL`, `decide` |
| `src/core/events.js` | `SHOT_EVENTS` additions; `needsShot` SESSION_DISARMED rule |
| `src/core/session.js` | arming by button, `beginTail`, CLOSING handlers, `MAX_TIMER`/`CLOSING_TIMER`, phase flag |
| `src/core/counters.js` | `tally.tail = { events, shots }` |
| `src/core/summary-text.js`, `summary-html.js` | `describeOutcome`, Trigger line, Phases block/table |
| `src/sw.js` | state gates, new effects/alarms, SPA nav listeners, `sender.url`, `screenChanged`, `takeShots` pre-capture, `meta.tail` reset |
| `src/content.js` | config read, click matcher, MutationObserver (SCREEN_CHANGED, END_MARKER) |
| `src/options/options.html` | five new inputs; result prefix labelled optional |
| `tests/unit/fake-chrome.js` | `webNavigation.onHistoryStateUpdated`, `onReferenceFragmentUpdated` |
| `tests/integration/site/exam/paper.html` (new), `tests/integration/session.test.js` | single-URL fixture, two new scenarios |
| `docs/centre-setup.md` | §4 table rows, §6 dry-run steps |

---

## Task 1: config fields and validation (spec §3)

**Files:** `src/core/config.js` (`DEFAULTS`, `STR`, `NUM`, `validate`), `tests/unit/config.test.js`.

- [ ] Failing tests (`tests/unit/config.test.js`), using `good` extended with `startButton:'', endButton:'', endMarker:'', maxMin:0, tailMin:5`:
  - `'new fields default: buttons/marker blank, maxMin 0, tailMin 5'` — `normalize({})` has those values; `normalize({ maxMin: '', tailMin: '0' })` gives `maxMin 0`, `tailMin 0`.
  - `'resultPrefix is optional when an end button or marker is set'` — `validate({ ...good, resultPrefix: '', endButton: 'Submit' })` is `[]`; same with `endMarker` only.
  - `'at least one end trigger is required'` — `resultPrefix:'', endButton:'', endMarker:''` → fields `['endButton']`.
  - `'startPrefix and resultPrefix must differ'` — both `'https://exam.example.com/x'` → fields `['resultPrefix']`.
  - `'endButton list must yield a label; labels max 80 chars'` — `endButton: ' , ,'` → `['endButton']`; a 81-char label → `['endButton']`.
  - `'maxMin 0-600 integer, tailMin 0-60 integer'` — `maxMin: 601` → `['maxMin']`; `tailMin: -1` → `['tailMin']`; `tailMin: 1.5` → `['tailMin']`.
  - Extend `'validate names each bad field'` expectation only if its input changes (it need not).
- [ ] Implement: add the five keys to `DEFAULTS` (`maxMin: 0, tailMin: 5`), `STR` and `NUM`. In `validate`: resultPrefix rule becomes `cfg.resultPrefix && !isHttpUrl(...)`; then `if (cfg.resultPrefix && cfg.resultPrefix === cfg.startPrefix)` → resultPrefix `'must differ from the start prefix'`; `if (!cfg.endButton && !cfg.endMarker && !cfg.resultPrefix)` → endButton `'set an end button, an end marker, or a result URL prefix'`; `parseLabels(cfg.endButton)` (Task 2 — write the import now and the test for Task 2 first if you prefer; the two tasks may be committed together) empty while `cfg.endButton` non-empty, or any label longer than 80 → endButton; `normalizeLabel(cfg.startButton).length > 80` → startButton; `normalizeLabel(cfg.endMarker).length > 200` → endMarker; integer ranges for `maxMin` (0–600) and `tailMin` (0–60).
- [ ] Verify: `npm test` (expect only the new config tests to have failed before the change), `npm run check`.
- [ ] Commit: `git add src/core/config.js src/core/labels.js tests/unit/config.test.js tests/unit/labels.test.js && git commit -m "feat(config): button/marker/max/tail fields; result prefix optional"`

## Task 2: label helpers (spec §3)

**Files:** `src/core/labels.js` (new: `normalizeLabel(s)`, `parseLabels(csv)`, `matchLabel(text, labels)`), `tests/unit/labels.test.js` (new).

- [ ] Failing tests:
  - `'normalizeLabel trims, collapses whitespace, lower-cases'` — `'  Submit \n  Answers '` → `'submit answers'`; `''`/`undefined`/`null` → `''`.
  - `'parseLabels splits on comma, normalises, drops empties'` — `'Finish, SUBMIT paper ,,'` → `['finish', 'submit paper']`; `''` → `[]`.
  - `'matchLabel is exact, not substring'` — `matchLabel('Submit', ['submit'])` true; `matchLabel('Submit now', ['submit'])` false; `matchLabel('', [])` false.
- [ ] Implement (pure, ~10 lines). Export a `LABEL_VECTORS` array of `[raw, normalised]` pairs used by this test and by `tests/unit/content.test.js` (Task 12) to prove the inlined copy is identical.
- [ ] Verify: `npm test`. Commit with Task 1.

## Task 3: tail screenshot decision (spec §6)

**Files:** `src/core/tailshots.js` (new: `EMPTY_TAIL = { count:0, lastHash:null, lastAt:0 }`, `decide(tail, { hash, at }, { minGapMs = 3000, cap = 60 } = {})` → `{ keep, tail }`), `tests/unit/tailshots.test.js` (new).

- [ ] Failing tests: `'first capture is kept'`; `'same hash is dropped'`; `'different hash within 3 s is dropped'`; `'61st capture is dropped'` (loop 60 keeps with distinct hashes 3 s apart, then one more → `keep:false`); `'a dropped capture does not change the tail state'` (`tail` returned equals input by `deepEqual`). `decide(undefined, ...)` must treat `undefined` as `EMPTY_TAIL`.
- [ ] Implement; `decide` never mutates its argument.
- [ ] Verify: `npm test`. Commit: `git add src/core/tailshots.js tests/unit/tailshots.test.js && git commit -m "feat(core): tail screenshot keep/drop decision"`

## Task 4: event catalogue (spec §5)

**Files:** `src/core/events.js`, `tests/unit/events.test.js`.

- [ ] Failing tests: `needsShot` true for `START_BUTTON_CLICKED`, `END_BUTTON_CLICKED`, `END_MARKER_SEEN`, `RESULT_PAGE`, `MAX_TIME_REACHED`, `SCREEN_CHANGED`; `SESSION_DISARMED` with outcome `SUBMITTED`/`AUTO_SUBMITTED`/`TIMED_OUT` true, `ABANDONED` still false, `RESULT` still true.
- [ ] Implement: add the six names to `SHOT_EVENTS`; SESSION_DISARMED rule becomes `ev.data.outcome !== 'ABANDONED'`.
- [ ] Verify: `npm test`. Commit: `git add src/core/events.js tests/unit/events.test.js && git commit -m "feat(events): shot rules for trigger and tail events"`

## Task 5: reducer — arming and the max alarm (spec §4 IDLE rows)

**Files:** `src/core/session.js` (`reduce` IDLE branch → extract `arm(s, input, cfg, emit, out, extra)`), `tests/unit/session-a.test.js`.

- [ ] First append the new default fields to the `cfg` constants in `session-a.test.js` and `session-b.test.js` (Global constraints); run `npm test` — must stay green.
- [ ] Failing tests (`session-a.test.js`; `cs = (name, data, tabId, url) => ({ kind:'CS', name, data, tabId, windowId: 3, url, at: T0 })`):
  - `'IDLE + START_CLICK on a start URL arms with trigger button'` — cfg `startButton:'Start'`; `reduce(initial(), cs('START_CLICK', { label:'start' }, 41, 'https://e.x/start?c=1'), cfg)` → `ARMED`, `events[0].data` deepEquals `{ url:'https://e.x/start?c=1', trigger:'button', label:'start' }`, `examTabId 41`.
  - `'START_CLICK from a non-start URL does not arm'` — url `'https://e.x/q/1'` → IDLE, no events.
  - `'start-prefix NAV does not arm while startButton is set'` — IDLE, no events.
  - `'NAV arming still works with startButton blank and carries trigger nav'` — existing `arm()` test: add `assert.equal(r.events[0].data.trigger, 'nav')`.
  - `'arming sets maxAt and MAX_ALARM_SET when maxMin > 0'` — cfg `maxMin: 180` → `session.maxAt === T0 + 180*60000`, effects contain `{ type:'MAX_ALARM_SET', when: T0 + 180*60000 }`; with `maxMin: 0` → `maxAt null`, no MAX effect.
- [ ] Implement: IDLE branch arms on (a) `NAV` + `!cfg.startButton` + class start, or (b) `CS` name `START_CLICK` + `cfg.startButton` + `classify(input.url) === 'start'`. The ARMED record gains `maxAt, endClickAt:null, markerSeen:false, outcome:null, trigger:null, triggerLabel:null, examEndedAt:null, closingUntil:null`. `SESSION_ARMED` data: `{ url, trigger, label? }` (label only for button).
- [ ] Verify: `npm test`. Commit: `git add src/core/session.js tests/unit/session-a.test.js tests/unit/session-b.test.js && git commit -m "feat(session): arm on start button; max-time alarm"`

## Task 6: reducer — end triggers and tail start (spec §4 "Tail start")

**Files:** `src/core/session.js` (new `beginTail(s, out, emit, input, cfg, outcome, trigger, label)`, `disarm` gains `trigger`; `examTabNav`, `HANDLERS.NAV`, `HANDLERS.CS`, new `HANDLERS.MAX_TIMER`), `tests/unit/session-b.test.js`.

- [ ] Failing tests (cfg with `tailMin: 5`, `endButton:'Finish'`, `endMarker:'submitted'`, `maxMin: 60`; `armed = arm().session`):
  - `'END_CLICK on the exam tab logs END_BUTTON_CLICKED and enters CLOSING as SUBMITTED'` — names `['END_BUTTON_CLICKED']`; `session.state 'CLOSING'`, `outcome 'SUBMITTED'`, `trigger 'button'`, `triggerLabel 'finish'`, `examEndedAt T0+1000`, `closingUntil T0+1000+300000`, `endClickAt T0+1000`; effects deepEqual `[{type:'MAX_ALARM_CLEAR'}, {type:'CLOSING_ALARM_SET', when: closingUntil}]`; the event has **no** `phase` key.
  - `'END_CLICK from another tab is ignored'`.
  - `'END_MARKER enters CLOSING as AUTO_SUBMITTED and fires once'` — names `['END_MARKER_SEEN']`, outcome `AUTO_SUBMITTED`, trigger `marker`, `markerSeen true`; a second END_MARKER in CLOSING emits nothing.
  - `'result NAV on the exam tab emits RESULT_PAGE and enters CLOSING as RESULT'` — names `['RESULT_PAGE']`, `triggerLabel` = url; same for a result NAV from another tab (ids from that tab).
  - `'MAX_TIMER with the tab present emits MAX_TIME_REACHED and enters CLOSING as TIMED_OUT'` — event `tabId === examTabId`, `windowId === examWindowId`, `data.maxAt`.
  - `'MAX_TIMER with the tab lost ends immediately'` — after TAB_REMOVED: names `['MAX_TIME_REACHED','SESSION_DISARMED']`, DISARMED data `{ outcome:'TIMED_OUT', trigger:'max' }`, state IDLE, effects include `ABANDON_ALARM_CLEAR` and `END`.
  - `'tailMin 0 ends immediately on any trigger'` — cfg `tailMin: 0`, END_CLICK → names `['END_BUTTON_CLICKED','SESSION_DISARMED']`, DISARMED data `{ outcome:'SUBMITTED', trigger:'button', label:'finish' }`, effects `MAX_ALARM_CLEAR` then `END`.
  - `'ABANDON_TIMER disarm carries trigger abandon and clears the max alarm'`.
- [ ] Update existing assertions in `session-a.test.js` lines 48–49, 57–58, 80 (they use `tailMin: 0` now): names become `['RESULT_PAGE','SESSION_DISARMED']` / `['EXAM_NAV','RESULT_PAGE','SESSION_DISARMED']` and DISARMED data gains `trigger:'result'`. Check with `grep -n "SESSION_DISARMED" tests/unit/session-*.test.js`.
- [ ] Implement `beginTail` exactly as spec §4 "Tail start" (trigger event emitted by the caller **before** calling `beginTail`); `disarm(..., outcome, trigger, data)` emits `SESSION_DISARMED{outcome, trigger, ...data}` and pushes `MAX_ALARM_CLEAR`, `CLOSING_ALARM_CLEAR` (only when leaving CLOSING), then `END`.
- [ ] Verify: `npm test`. Commit: `git add src/core/session.js tests/unit/session-a.test.js tests/unit/session-b.test.js && git commit -m "feat(session): end triggers start the post-submit tail"`

## Task 7: reducer — CLOSING behaviour (spec §4 CLOSING table)

**Files:** `src/core/session.js` (`emit` phase flag; `examTabNav`, `HANDLERS.NAV/CS/TAB_REMOVED/STARTUP/ABANDON_TIMER/MAX_TIMER`, new `HANDLERS.CLOSING_TIMER`), `tests/unit/session-b.test.js`.

- [ ] Failing tests (start from a `closing` fixture = END_CLICK applied to `armed`):
  - `'events in CLOSING carry phase tail and normal monitoring continues'` — TAB_ACTIVATED to another tab → `TAB_SWITCH` with `data.phase === 'tail'` and `data.toUrl`; COPY via CS → `COPY` with phase tail.
  - `'END_CLICK in CLOSING resets closingUntil and re-sets the alarm; outcome unchanged'`.
  - `'START_CLICK in CLOSING is logged only'` — names `['START_BUTTON_CLICKED']`, still CLOSING.
  - `'SCREEN_CHANGED is ignored in ARMED and logged with hash in CLOSING'` — `cs('SCREEN_CHANGED', { hash:'abcd1234' })` → in ARMED no events; in CLOSING `SCREEN_CHANGED` with `data` deepEqual `{ phase:'tail', hash:'abcd1234' }`.
  - `'result NAV in CLOSING is just EXAM_NAV; other-tab result is PARALLEL_PAGE'`.
  - `'exam tab removed in CLOSING ends immediately'` — names `['EXAM_TAB_CLOSED','SESSION_DISARMED']`, DISARMED data `{ phase:'tail', outcome:'SUBMITTED', trigger:'button', label:'finish' }`, effects `[{type:'CLOSING_ALARM_CLEAR'}, {type:'MAX_ALARM_CLEAR'}, {type:'END', ...}]` (order: assert with `map(e => e.type)`), no `ABANDON_ALARM_SET`; same via TICK `examTabPresent:false`.
  - `'CLOSING_TIMER disarms with the stored outcome from the exam window'` — event ids equal `examTabId`/`examWindowId`.
  - `'STARTUP in CLOSING re-adopts the tab and re-sets the closing alarm'` — `closingUntil > at`: no events, `examTabId` = new id, effects `[{type:'CLOSING_ALARM_SET', when: closingUntil}]`; `'STARTUP in CLOSING after closingUntil ends now'`; `'STARTUP in CLOSING with no tab ends now'`.
  - `'stale MAX_TIMER / ABANDON_TIMER in CLOSING and CLOSING_TIMER in ARMED are no-ops'`.
- [ ] Implement: in `emit`, `const d = s.state === 'CLOSING' ? { phase:'tail', ...data } : data`. Handlers branch on `s.state === 'CLOSING'` where the spec table differs; `TAB_REMOVED` in CLOSING emits `EXAM_TAB_CLOSED` then `disarm`.
- [ ] Verify: `npm test`. Commit: `git add src/core/session.js tests/unit/session-b.test.js && git commit -m "feat(session): CLOSING state with tail phase marking"`

## Task 8: tally and summaries (spec §8)

**Files:** `src/core/counters.js` (`tally` returns `tail: { events, shots }`), `src/core/summary-text.js` (export `describeOutcome(session)`; Trigger line; Phases block; screenshots line), `src/core/summary-html.js` (Trigger row, Phases table), tests `counters.test.js`, `summary-text.test.js`, `summary-html.test.js`.

- [ ] Failing tests:
  - counters: `'tail counts events and distinct shots with phase tail'` — two tail events sharing one shot file → `tail.events 2`, `tail.shots 1`; no tail events → `{ events:0, shots:0 }`.
  - summary-text: `'describeOutcome names the trigger'` — for each trigger (`button`/`marker`/`result`/`max`/`abandon`) the exact strings in spec §8; `max` uses `Math.round((maxAt - startedAt)/60000)`.
  - summary-text: `'Trigger and Phases lines'` — ctx session with `trigger:'button'`, `triggerLabel:'submit'`, `examEndedAt`, `maxAt`: line index 3 matches `/^Trigger:   end button "submit" clicked at \d\d:\d\d:\d\d   \(auto-submit expected at \d\d:\d\d:\d\d\)$/`; `Phases` block has `Exam ` and `Post-submit tail ` lines with `N screenshots`; a session with `trigger:null` (legacy ABANDONED-style record) renders `Trigger:   exam tab closed and not reopened` and only the Exam phase line.
  - Update `summary-text.test.js` line 19–20 (the `Ended:` regex is unchanged; `Duration:` moves to index 4) and the `'Screenshots: 1 (screenshots/)'` assertion stays.
  - summary-html: `'includes Trigger row and Phases table'` — `html.includes('<td>Trigger</td>')`, `'Post-submit tail'`.
- [ ] Implement. `describeOutcome` reads only `session` (`trigger`, `triggerLabel`, `examEndedAt`, `maxAt`, `startedAt`); time via `fmtLocal(...).slice(11)`. Tail line omitted when `session.examEndedAt` is null or `tally.tail.events === 0` and `closingUntil` is null.
- [ ] Verify: `npm test`. Commit: `git add src/core/counters.js src/core/summary-text.js src/core/summary-html.js tests/unit/counters.test.js tests/unit/summary-text.test.js tests/unit/summary-html.test.js && git commit -m "feat(summary): trigger line and exam/tail phases"`

## Task 9: service worker — gates, alarms, listeners (spec §4, §10)

**Files:** `src/sw.js` (`dispatchNow`, `runEffects`, `tick`, `recover`, `probeWindow`, `NAV_BORN`, `onNav`, listener block), `tests/unit/fake-chrome.js` (`webNavigation: { onCommitted, onHistoryStateUpdated, onReferenceFragmentUpdated }`), `tests/unit/sw-listeners.test.js`, `tests/unit/sw-dispatch.test.js`, `tests/unit/sw-startup.test.js`.

- [ ] Append the new default fields to every `config` constant in `tests/unit/sw-*.test.js` and `popup.test.js`; run `npm test` (green expected; `sw-end.test.js` line 22 becomes `['SESSION_ARMED','RESULT_PAGE','SESSION_DISARMED']` and its `Log chain: OK \(3 lines\)` becomes 4 lines — fix those assertions now).
- [ ] Failing tests:
  - sw-listeners: `'onHistoryStateUpdated and onReferenceFragmentUpdated dispatch NAV like onCommitted'` — armed session; `chrome.webNavigation.onHistoryStateUpdated.emit({ tabId:1, frameId:0, url:'https://e.x/q/2' })` → last event `EXAM_NAV` with that url; fragment variant likewise; `frameId 7` ignored.
  - sw-listeners: `'onMessage passes sender.url into the CS input'` — config `startButton:'Start'`; `chrome.runtime.onMessage.emit({ type:'cs', name:'START_CLICK', data:{ label:'start' } }, { tab:{ id:1, windowId:3 }, url:'https://e.x/start' })` → session ARMED with `trigger 'button'`.
  - sw-listeners: `'max and closing alarms dispatch MAX_TIMER and CLOSING_TIMER'` — config `maxMin:1, tailMin:1, endButton:'Finish'`; arm; `chrome.alarms.onAlarm.emit({ name:'max' })` → CLOSING with outcome `TIMED_OUT`; `chrome.alarms.alarms.closing.when === closingUntil`; `emit({ name:'closing' })` → IDLE and a `summary.txt` download whose text matches `/Outcome: TIMED_OUT/`.
  - sw-dispatch: `'effects create and clear the max and closing alarms'` — after arming `chrome.alarms.alarms.max.when === startedAt + 60000`; after END_CLICK `alarms.max` undefined and `alarms.closing` set.
  - sw-dispatch: `'GAP is emitted in CLOSING too'` — set `meta.lastSeenAt` 100 s back while CLOSING; a TICK → `EXTENSION_GAP` with `phase:'tail'`.
  - sw-dispatch: `'log base uses the session id while CLOSING'` — after END_CLICK the pending `log.txt` path still contains the session id.
  - sw-startup: `'recover re-adopts a CLOSING session and re-sets the closing alarm'`; `'recover ends a CLOSING session whose closingUntil passed'` → IDLE and files written.
- [ ] Implement: replace `session.state === 'ARMED'` gates with `!== 'IDLE'` at `dispatchNow` (GAP rule, line ~63; `base` id choice, line ~86), `tick` (`examTabPresent`), `recover`, `probeWindow`; `runEffects` handles `MAX_ALARM_SET/CLEAR` (`'max'`) and `CLOSING_ALARM_SET/CLEAR` (`'closing'`); alarm listener adds `'max'` → `MAX_TIMER`, `'closing'` → `CLOSING_TIMER`; extract the onCommitted body into `onNav(d)` and register it on all three `webNavigation` events; onMessage adds `url: sender.url`; add `RESULT_PAGE` to `NAV_BORN`.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/sw.js tests/unit/fake-chrome.js tests/unit/sw-listeners.test.js tests/unit/sw-dispatch.test.js tests/unit/sw-startup.test.js tests/unit/sw-end.test.js tests/unit/popup.test.js && git commit -m "feat(sw): CLOSING gates, max/closing alarms, SPA navigation listeners"`

## Task 10: service worker — tail screenshots (spec §6)

**Files:** `src/sw.js` (new `screenChanged(input)`; `takeShots(events, pre)`; `meta.tail` reset in `dispatchNow`; onMessage routing), `tests/unit/sw-shots.test.js`.

- [ ] Failing tests (config `endButton:'Finish', tailMin:5`; tab 1 `active:true`; helper `sc = (at) => chrome.runtime.onMessage.emit({ type:'cs', name:'SCREEN_CHANGED', data:{} }, { tab:{ id:1, windowId:3 }, url:'https://e.x/q/1' })` followed by `await sw.settled()`; make `chrome.tabs.captureVisibleTab` in the fake return a value the test controls, e.g. by assigning `chrome.tabs.captureVisibleTab = async () => 'data:image/jpeg;base64,' + current`):
  - `'SCREEN_CHANGED while ARMED records nothing and captures nothing'`.
  - `'first SCREEN_CHANGED in CLOSING is captured once, hashed, filed and logged'` — one capture call; event `SCREEN_CHANGED` with `data.hash` = `await shortHash(b64)`, `shot` matches `/_SCREEN_CHANGED\.jpg$/`, `shots[file]` present, `meta.tail.count === 1`.
  - `'same image again is dropped; different image within 3 s is dropped; different image after 3 s is kept'` (drive `Date.now` via the input `at` — the listener uses `now()`; stub `Date.now` in the test around each emit).
  - `'SCREEN_CHANGED from a non-active exam tab is dropped'` — set `chrome.tabs.list[0].active = false`.
  - `'entering CLOSING resets meta.tail'` — pre-set `meta.tail.count 60`, END_CLICK → `meta.tail` deepEquals `EMPTY_TAIL`.
- [ ] Implement per spec §6: `screenChanged` is an `enqueue`d step that reads `session`/`meta`, checks state/tab/active, captures via `captureJpeg(session.examWindowId)`, hashes with `shortHash`, calls `decide`, patches `meta.tail` and then calls `dispatchNow({ ...input, data: { hash }, pre: { b64 } })`. `takeShots(events, pre)`: for `ev.name === 'SCREEN_CHANGED'` use `pre.b64`, skip the coalescing branch, still update `last`. In `dispatchNow`, when `r.session.state === 'CLOSING' && session.state === 'ARMED'`, `store.patchMeta({ tail: EMPTY_TAIL })`. onMessage routes `name === 'SCREEN_CHANGED'` to `screenChanged`, everything else to `dispatch`.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/sw.js tests/unit/sw-shots.test.js && git commit -m "feat(sw): deduplicated post-submit tail screenshots"`

## Task 11: service worker — end-of-tail files (spec §4 "Session end")

**Files:** `src/sw.js` (no new code expected; this task proves the END path from CLOSING), `tests/unit/sw-end.test.js`.

- [ ] Failing test: `'closing alarm ends the session and the summary separates exam and tail phases'` — arm, END_CLICK, two kept SCREEN_CHANGED captures, `onAlarm.emit({ name:'closing' })`; assert `session.state IDLE`, `meta.pendingEnd null`, `summary.txt` text matches `/Outcome: SUBMITTED/`, `/Trigger:   end button "finish" clicked/`, `/Post-submit tail .* 2 screenshots/`; `events.jsonl` last event is `SESSION_DISARMED` with `data.phase 'tail'`.
- [ ] Implement only what the test reveals missing (expected: nothing).
- [ ] Verify: `npm test`. Commit: `git add tests/unit/sw-end.test.js && git commit -m "test(sw): end of tail writes phase-separated summary"`

## Task 12: content script (spec §2, §5)

**Files:** `src/content.js` (classic script, **no imports**; new `norm(s)`, `parseList(csv)`, `applyConfig(cfg)`, click listener, `MutationObserver`), `tests/unit/content.test.js`.

- [ ] Extend the test's fake `chrome` at the top with `storage: { local: { get: async () => ({ config: {} }) }, onChanged: { addListener: (f) => { L['storage'] = f; } } }`, a `globalThis.MutationObserver` class that records `observe(target, opts)` and exposes `trigger()`, `document.documentElement = {}`, `document.body = { innerText: '' }`, and `Element`-less `closest` on fake targets. Push config through `L['storage']({ config: { newValue: { startButton:'Start', endButton:'Finish, Confirm submission', endMarker:'Your answers have been submitted' } } }, 'local')`.
- [ ] Failing tests:
  - `'normaliser matches core/labels on the shared vectors'` — import `LABEL_VECTORS` from `../../src/core/labels.js`; for each `[raw, expected]` click a fake button whose `innerText` is `raw` with config `endButton = expected`; assert an `END_CLICK` with `label === expected` was sent (this proves the inlined copy's output equals the core's on every vector).
  - `'click on a matching start button sends START_CLICK; end button sends END_CLICK; others send nothing'` — target `{ closest: () => ({ innerText: ' Confirm   submission ' }) }` → `END_CLICK{label:'confirm submission'}`; `innerText:'Next'` → nothing; `closest: () => null` → nothing; `{ innerText:'', value:'Finish' }` → END_CLICK; `{ innerText:'', value:'', getAttribute: () => 'Start' }` → START_CLICK.
  - `'observer is attached to documentElement with childList, characterData, subtree'`.
  - `'mutations are debounced to one SCREEN_CHANGED per second'` — `t.mock.timers.enable({ apis:['setTimeout'] })`; `trigger()` three times, `tick(999)` → nothing; `tick(1)` → exactly one `SCREEN_CHANGED`.
  - `'END_MARKER is sent once when the marker text appears'` — `document.body.innerText = 'Thank you.\nYour   answers have been SUBMITTED.'`, `trigger()`, `tick(1000)` → messages contain `END_MARKER{marker:'your answers have been submitted'}` exactly once even after further mutations; with `endMarker` blank nothing is sent.
  - `'config arrives from storage.local.get at load'` — a fresh import (`import('../../src/content.js?fresh')` is not possible for a classic IIFE; instead assert `chrome.storage.local.get` was called with `'config'` at load by recording calls in the fake).
- [ ] Implement: `norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()` (the single inlined copy); `chrome.storage.local.get('config').then(({ config }) => applyConfig(config))` and `chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.config) applyConfig(c.config.newValue); })`; `document.addEventListener('click', ..., true)` using the selector from Global constraints; `new MutationObserver(scheduleChange).observe(document.documentElement, { childList:true, characterData:true, subtree:true })`; `scheduleChange` clears/sets a 1000 ms timeout whose callback sends `SCREEN_CHANGED` and, if `marker && !markerSent && norm(document.body?.innerText).includes(marker)`, sends `END_MARKER{marker}` and sets `markerSent`. Keep the existing `send` wrapper.
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/content.js tests/unit/content.test.js && git commit -m "feat(content): start/end button clicks, end marker, screen-change signal"`

## Task 13: options page (spec §3)

**Files:** `src/options/options.html`, `tests/unit/options.test.js`.

- [ ] Failing tests: the existing `name="<field>"` loop already covers the new `DEFAULTS` keys once Task 1 landed — confirm it fails now (`npm test` shows `startButton` missing) before editing the HTML; add `'result prefix may be blank and the page saves'` — set `resultPrefix ''`, `endButton 'Finish'`, submit → status `Saved.`; `'validation error names endButton when no end trigger is set'`.
- [ ] Implement: inputs (in this order after Result URL prefix, whose label becomes `Result URL prefix (optional if an end button or marker is set)`): `Start button label (optional; blank = arm on start URL)` `startButton`; `End button label(s), comma-separated (optional)` `endButton`; `Submitted-screen marker text (optional; must appear only after submission)` `endMarker`; `Maximum paper length (minutes; 0 = no backstop)` `maxMin` number 0–600; `Post-submit tail (minutes; 0 = end immediately)` `tailMin` number 0–60. `options.js` needs no change (`fields = Object.keys(DEFAULTS)`).
- [ ] Verify: `npm test`, `npm run check`. Commit: `git add src/options/options.html tests/unit/options.test.js && git commit -m "feat(options): button, marker, max and tail fields"`

## Task 14: integration fixture and scenarios (brief "Constraints")

**Files:** `tests/integration/site/exam/paper.html` (new), `tests/integration/session.test.js`.

- [ ] Fixture `paper.html` (single URL, inline script, no navigation): `<button id="start">Start</button>` → screen 1/2/3 rendered in place with a `Next` button each → `Finish` button → confirm modal with `Cancel` and `<button id="confirm">Confirm submission</button>` → replaces body content with `<h1>Submitted</h1><p>Your answers have been submitted.</p>`, then 1.5 s later appends `<p>Result: 7/10</p>`. With `?auto=1` in the URL the script skips to the submitted screen by itself 3 s after load, no clicks. Keep the marker text out of every pre-submission screen.
- [ ] Append the new default fields to the existing scenario's `config` (`tailMin: 0` keeps it unchanged).
- [ ] Failing test A `'start button arms; confirm click starts the tail; tab close ends with SUBMITTED'` — config `startPrefix: ${origin}/exam/paper.html`, `resultPrefix: ''`, `startButton: 'Start'`, `endButton: 'Confirm submission'`, `endMarker: 'Your answers have been submitted'`, `maxMin: 0`, `tailMin: 1`. Steps: goto paper → `waitFor` state stays IDLE for 1 s (no NAV arming) → click `#start` → ARMED with `SESSION_ARMED.data.trigger === 'button'` → click Next ×3, Finish, Confirm → CLOSING with `outcome 'SUBMITTED'` → `waitFor` an `END_MARKER_SEEN` event and at least one `SCREEN_CHANGED` event with `data.phase 'tail'` and a `shot` → `b.page.close()` → IDLE → `summary.txt` (via the download collector pattern already in the file) matches `/Outcome: SUBMITTED/`, `/Trigger:   end button "confirm submission" clicked/`, `/Post-submit tail/`.
- [ ] Failing test B `'auto-submit: marker alone ends the exam phase as AUTO_SUBMITTED'` — same config; goto `paper.html?auto=1`; click `#start`; wait ~3 s → `END_MARKER_SEEN`, CLOSING with `outcome 'AUTO_SUBMITTED'`, no `END_BUTTON_CLICKED`; close tab → IDLE, summary matches `/Outcome: AUTO_SUBMITTED/` and `/end marker "your answers have been submitted" seen/`.
- [ ] Verify: `npm run test:integration` (foreground; expect the three scenarios to pass), then `npm test`. Commit: `git add tests/integration/site/exam/paper.html tests/integration/session.test.js && git commit -m "test(integration): single-URL paper with start button, confirm, auto-submit"`

## Task 15: centre checklist (brief "Docs")

**Files:** `docs/centre-setup.md` (§4 table, §6 dry run).

- [ ] §4: change the Result URL prefix row to say it is optional when an end button or marker is set; add rows for `Start button label`, `End button label(s)` (advise the **confirm** button's label where the platform has a confirm dialog, per spec §14 item 11), `Submitted-screen marker text` (must appear only after submission), `Maximum paper length` (recommended: the paper's scheduled length plus a small margin), `Post-submit tail` (default 5).
- [ ] §6: insert after step 1: "If a Start button label is configured, the popup must still show `IDLE` after the start page loads and `ARMED` only after the Start button is clicked." Insert before the result-URL step: "On a throw-away candidate account walk every in-paper screen and confirm the configured marker phrase appears on none of them, then submit and confirm it appears on the submitted screen; the popup must show `CLOSING` and return to `IDLE` after the tail (default 5 minutes) or when the tab is closed." Extend step 6: `summary.txt` must show `Outcome: SUBMITTED` (or `AUTO_SUBMITTED` / `RESULT` as applicable), a `Trigger:` line, and a `Post-submit tail` line with a screenshot count.
- [ ] Verify: `npm test` (unchanged), re-read the two sections once. Commit: `git add docs/centre-setup.md && git commit -m "docs(centre): configure and dry-run the button/marker triggers"`

---

## Handoff

When all 15 tasks are green, request a review with:

> Review branch `main` (or the feature branch) of `/Users/pawank/DiskAlpha/Development/exameye` against `docs/superpowers/specs/2026-09-12-exameye-design.md` §3–§6, §8, §10, §14 and `.superpowers/sdd/2026-09-13-test-finish/button-triggers-brief.md`. Check: every reducer transition in the §4 CLOSING table has a test; `src/core/*` imports nothing from `chrome.*`; every storage writer in `src/sw.js` runs inside `enqueue`; `src/content.js` has no `import`; the inlined normaliser in `content.js` is covered by the `LABEL_VECTORS` parity test; `npm test`, `npm run test:integration`, `npm run check` pass (run them, read the output).
