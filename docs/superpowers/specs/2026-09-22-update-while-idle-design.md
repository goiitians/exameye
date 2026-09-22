# ExamEye self-update while Chrome runs: swap when the extension is IDLE

Status: approved in brainstorm 2026-09-22, spec for implementation planning.
Extends `2026-09-21-auto-update-design.md`, which required Chrome to be closed.

## 1. Goal and decisions

Today the updater replaces `<home>/ExamEye` only while Chrome is closed. On an exam PC Chrome is
open all day, so a release lands at the next logon at the earliest. After this change:

- The updater swaps the folder while Chrome runs, **if the extension's session is IDLE**. While
  the session is ARMED or CLOSING the updater waits (retries hourly), exactly as it waits today.
- The running extension notices the new files on disk and reloads itself the next time it is
  IDLE, so the new version is live within a minute of the swap on an idle machine, and right
  after the exam ends otherwise.
- The extension reports its state through a marker file written with `chrome.downloads`, the
  extension's only silent disk sink (the 2026-09-12 folder-picker spike rules out anything that
  needs a click after each Chrome start). The marker therefore lives under Chrome's Downloads
  folder, not next to the extension; the owner accepted this over a native-messaging host.
- Chrome closed keeps working as before. A machine whose marker is missing, stale or unreadable
  behaves exactly as today.

Out of scope: rollback, reloading while ARMED/CLOSING, machines whose Chrome download folder is
not `<home>/Downloads` (they keep the Chrome-closed rule), the macOS launchd cadence.

## 2. State marker (extension -> disk)

File: `<Downloads>/ExamEye-updater/state.txt`, i.e. `chrome.downloads` filename
`ExamEye-updater/state.txt`, `conflictAction: overwrite`, `saveAs: false`, `text/plain` data URL.
Content: the session state word and a newline: `IDLE\n`, `ARMED\n` or `CLOSING\n`.

Written by the service worker through the existing `writeFile` (`src/adapters/downloads.js`):

- after `dispatch()` stores a batch whose session state differs from the previous one
  (IDLE->ARMED, ARMED->CLOSING, CLOSING->IDLE, ARMED->IDLE),
- on `chrome.runtime.onStartup` (Chrome start: corrects an `ARMED` left by a crash),
- on `chrome.runtime.onInstalled` (first run of a freshly reloaded version).

Not written on every service-worker start: the worker restarts every few tens of seconds and a
download per restart is noise. A write failure is logged to `meta.lastError` like other sink
failures and never blocks the session; the updater then falls back to the Chrome-closed rule.

The download entry is erased from Chrome's download list the same way the log files are.

## 3. Updater gate (`installer/Update-ExamEye.cmd`, `installer/update-exameye.sh`)

Replace both `chrome running -> skip` checks with one rule, evaluated at the same two points
(before the download, and immediately before the two renames):

    may swap  =  Chrome and Edge not running
              OR first line of <home>/Downloads/ExamEye-updater/state.txt is exactly IDLE

Anything else skips: marker says ARMED or CLOSING, marker missing, unreadable, or empty. Log
line: `skipped <latest>: chrome running (<ARMED|CLOSING|no state>)`. Everything after the gate
(mirror, `defaults.json` carry-over, two renames, cleanup, self-copy) is unchanged: a failure
anywhere still leaves the live folder untouched and is retried on the next hourly run.

Marker path: Windows `%USERPROFILE%\Downloads\ExamEye-updater\state.txt`, macOS
`$HOME/Downloads/ExamEye-updater/state.txt`. The scripts do not read Chrome's preferences to
find a relocated download folder; a relocated folder simply means the marker is never found.

## 4. Self-reload (extension)

At the end of every `tick()` (30 s alarm, after pending-end replay and flush) and after a
transition to IDLE, the worker compares the on-disk version with the running one:

    disk    = (await (await fetch(chrome.runtime.getURL('manifest.json'))).json()).version
    running = chrome.runtime.getManifest().version

For an unpacked extension the fetch reads the file currently on disk, so it changes the moment
the updater swaps the folder. When `disk !== running` and all of the following hold, the worker
calls `chrome.runtime.reload()`:

- `session.state` is IDLE (or no session),
- `meta.pendingEnd` is null,
- `pending` (files not yet flushed) is empty.

Otherwise it does nothing; the next tick or the IDLE transition re-checks. A fetch failure
(file mid-rename) is ignored until the next tick. After the reload `onInstalled` fires, which
boots the worker and writes the marker; the popup then shows the new version.

## 5. Failure modes

| Situation | Behaviour |
|---|---|
| Chrome crashed while ARMED; marker says ARMED | Updater waits; Chrome start rewrites marker (onStartup) and swap follows within the hour |
| Session arms during the download | Second gate check before the renames skips; retry next hour |
| Session arms between the swap and the reload check (<=30 s) | Old worker keeps running with new files on disk until IDLE; the reload then happens. Accepted window. An unpacked extension serves popup, options, holder page and the registered content script from disk on demand, so a session in this window runs the new content script/popup/holder against the old worker — the worker's message protocol with those pages must stay compatible between consecutive releases (release rule, not enforced by code) |
| Dispatch enqueued between the reload check's storage read and the worker terminating | Lost with the worker; if it was the arming NAV, arming happens on the next start-URL or exam-URL navigation. Millisecond window, accepted |
| Rename fails while Chrome holds a file open (Windows, unverified) | `failed: swap`, live folder untouched, retry next hour. Must be verified on the Windows PC at the next release; if it fails there, the swap technique is a follow-up |
| Marker write fails (download refused) | `meta.lastError` set; updater uses the Chrome-closed rule |
| Old extension (no marker ever written) | Updater uses the Chrome-closed rule |

## 6. Testing

Unit (`tests/unit`, fake chrome):

- marker written with `ExamEye-updater/state.txt` and the right word on each transition, on
  `onStartup` and on `onInstalled`; not written on a plain worker restart; not written when the
  state did not change.
- reload called when disk version differs and IDLE with nothing pending; not called when
  versions match, when ARMED, when CLOSING, when `pendingEnd` is set, or when `pending` has
  entries; not called when the manifest fetch throws.
- `fake-chrome.js` gains `runtime.reload()` (counts calls) and a `fetch` route for
  `manifest.json` that the test controls.

Scripts: `tests/unit/build-installer.test.js` keeps covering CRLF and packaging. The gate itself
is verified by hand on the Windows PC with Chrome open and the popup idle: `update.log` shows
`updated <old> -> <new>` and the popup shows the new version without Chrome being closed; then
once with a session ARMED: `skipped <new>: chrome running (ARMED)`.

Docs: `installer/READ-ME-FIRST.txt` "Automatic updates" paragraph describes the IDLE rule and
names the marker file; `docs/centre-setup.md` if it repeats the Chrome-closed rule.
