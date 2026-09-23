# Manual stop with a passkey; re-ask delay in seconds (2026-09-23)

**Outcome:** the manual stop (Tasks 1-4) was built, reviewed and then removed the same day on the
owner's decision, because a recording whose exam tab is gone ends on its own after the "give up"
time (now 5 minutes in `installer/defaults.json`). Only Task 5 (seconds) is in the tree.

Owner request (2026-09-23): (1) stop an ARMED/CLOSING recording from the setup page with a staff passkey
(given by the owner in chat; only its SHA-256 lives in the repo), for the case where the exam tab is closed and the recording keeps running;
(2) set the "ask again after a refusal" delay in seconds, since one minute is the current minimum.

Decisions taken (owner not available): the passkey is a fixed constant kept as a SHA-256 digest and
checked in the service worker, never in the page; a wrong passkey is recorded in the log as an event
(someone tried to stop the recording); a correct one ends the session with outcome `STOPPED` and
trigger `manual`, written like every other end (summary, log chain, screenshots); the delay key is
renamed to `desktopRepromptSec` with the old minutes value migrated by the normaliser, so saved
settings and test fixtures keep working; Chrome fires alarms no sooner than 30 s apart, so the page
says so.

## Task 1 — passkey module `src/core/passkey.js`
```
// SHA-256 of the staff passkey; the page sends the typed text, the worker compares digests.
export const PASSKEY_SHA256 = 'ba4b97c254822c079c90d97dff3bf2ff160d57ffe1f752223c9ad27a0ec68bf1';
export async function passkeyOk(text, digest = PASSKEY_SHA256) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('') === digest;
}
```
Test `tests/unit/passkey.test.js` with its own key/digest pair (node `createHash`): right true, wrong false, empty false, undefined false. The real passkey never appears in the repo.

## Task 2 — session reducer `src/core/session.js`
Add handler:
```
MANUAL_STOP(s, input, cfg, emit, out) {
  const ids = { ...input, tabId: s.examTabId, windowId: s.examWindowId };
  emit('MANUAL_STOP', {}, ids);
  if (s.tabLostAt !== null) out.effects.push({ type: 'ABANDON_ALARM_CLEAR' });
  disarm(s, out, emit, ids, 'STOPPED', 'manual');
},
MANUAL_STOP_REFUSED(s, input, cfg, emit) { emit('MANUAL_STOP_REFUSED', {}); },
```
Both only reach the handler table when the state is not IDLE (the reducer returns early for IDLE).
`src/core/summary-text.js describeOutcome`: `else if (trigger === 'manual') line = \`stopped by staff from the setup page at ${at}\`;`
`src/core/summary-html.js`: give `OUTCOME.STOPPED` the same badge class as `ABANDONED` (read the OUTCOME map first).
`src/core/flags.js`: add `['MANUAL_STOP_REFUSED', 'Stop attempts refused', 'critical']`.
`src/core/events.js`: `needsShot` already shoots `SESSION_DISARMED` unless ABANDONED; add `'MANUAL_STOP'` and `'MANUAL_STOP_REFUSED'` to `SHOT_EVENTS`.
Tests in `tests/unit/session-b.test.js` (or a new `session-manual-stop.test.js`): ARMED + MANUAL_STOP → events MANUAL_STOP then SESSION_DISARMED {outcome STOPPED, trigger manual}, END effect, session IDLE; ARMED with tabLostAt set → ABANDON_ALARM_CLEAR present; CLOSING + MANUAL_STOP → CLOSING_ALARM_CLEAR present, outcome STOPPED; IDLE + MANUAL_STOP → no events; MANUAL_STOP_REFUSED while ARMED → one event, state unchanged; summary text line for trigger manual.

## Task 3 — worker `src/sw.js`
In `chrome.runtime.onMessage`: before the `cs` branch,
```
if (msg?.type === 'stop') {
  passkeyOk(msg.passkey).then(async (ok) => {
    const { session } = await store.get('session');
    if (!session || session.state === 'IDLE') return respond({ ok: false, error: 'nothing is being recorded' });
    dispatch({ kind: ok ? 'MANUAL_STOP' : 'MANUAL_STOP_REFUSED', at: now() });
    respond(ok ? { ok: true } : { ok: false, error: 'wrong passkey' });
  });
  return true;
}
```
Import `passkeyOk`. Test `tests/unit/sw-manual-stop.test.js` using `installFakeChrome` and the
`onMessage` fake: ARMED session in storage, message with the right passkey → response ok, session
IDLE after `sw.settled()`; wrong passkey → response error and a MANUAL_STOP_REFUSED event in storage,
state still ARMED; IDLE → error "nothing is being recorded", no event. Read `tests/unit/sw-end.test.js`
for how an ARMED session is set up and how END effects are awaited.

## Task 4 — options page
`src/options/options.html` inside the `#recording` banner, after the text:
```
<form id="stop" class="stopform">
  <label for="passkey">Stop this recording now <small>(staff passkey)</small></label>
  <input id="passkey" name="passkey" type="password" autocomplete="off">
  <button type="submit">Stop recording</button>
  <p id="stopstatus" role="status" aria-live="polite"></p>
</form>
```
Style `.stopform` minimally in the existing sheet (input and button inline on wide screens). The banner
text gains one sentence: "If the exam tab was closed, the recording ends on its own after the
'give up' time below; to end it now, enter the staff passkey."
`src/options/options.js`: on `#stop` submit, `chrome.runtime.sendMessage({ type: 'stop', passkey })`,
show the response in `#stopstatus` ("Recording stopped." / the error), clear the field. Note the
form is nested inside `#form`? It must NOT be: put `#recording` outside `<form id="form">` (it already is).
`tests/unit/options.test.js`: html has the stop form with a password input and a module-only script;
submitting calls `chrome.runtime.sendMessage` with `{type:'stop', passkey}` (extend `fake-chrome.js`
`runtime.sendMessage` to record calls and return a canned response if it does not already).

## Task 5 — seconds
`src/core/config.js`: DEFAULTS `desktopRepromptSec: 300` replacing `desktopRepromptMin: 5`; NUM list
updated; in `normalize`, after the loops: `if (raw.desktopRepromptSec === undefined && raw.desktopRepromptMin !== undefined) { const m = Number(raw.desktopRepromptMin); if (Number.isFinite(m)) cfg.desktopRepromptSec = Math.round(m * 60); }`;
validate: `integer 0-3600`.
`src/core/desktop.js`: `repromptMin` → `repromptSec`, `* 60000` → `* 1000` (all eight places).
`src/sw.js`: `repromptMin: cfg.desktopRepromptMin` → `repromptSec: cfg.desktopRepromptSec` (both places).
`src/options/options.html`: field `desktopRepromptSec`, label "Ask again after a refusal (seconds)",
`min="0" max="3600"`, help: "If the candidate cancels the share dialog, ask again after this many seconds. 0 asks only once. Chrome fires timers no sooner than 30 seconds apart."
`installer/defaults.json`: `"desktopRepromptSec": 60` replacing the minutes key.
Tests: `tests/unit/config.test.js` (rename assertions; add migration case `desktopRepromptMin: 2` → `desktopRepromptSec: 120`; explicit `desktopRepromptSec` wins), `tests/unit/desktop.test.js` (rename option, values in seconds), `tests/unit/options.test.js` (input regex), `tests/unit/sw-hardening.test.js` (3 references). Every other fixture keeps `desktopRepromptMin: 1` and is migrated by `normalize`.
Docs: `docs/centre-setup.md` table row; `installer/READ-ME-FIRST.txt` "ask again after a refusal 1 minute" → "60 seconds"; `docs/superpowers/specs/2026-09-12-exameye-design.md` mentions (8) → seconds.

## Verify
`npm run check`, then `npm test`, in the foreground. Report to
`.superpowers/sdd/2026-09-23-features/impl-report.md`.
