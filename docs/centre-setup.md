# ExamEye - centre setup checklist

Do this once per machine. After step 6 the extension needs no clicks on browser start or exam start.

## 1. Install
Two routes; pick one per centre.

**Unpacked copy (hand-installed, one machine at a time)**
- Copy the ExamEye folder (the one containing `manifest.json`) somewhere it will not be moved or deleted, e.g. `C:\ExamEye` or `/opt/exameye`. Chrome loads it from that path on every start; moving it disables the extension.
- Chrome: `chrome://extensions` -> Developer mode ON -> Load unpacked -> select the folder.
- Edge: `edge://extensions` -> Developer mode ON -> Load unpacked -> select the folder.
- Chrome shows a "Disable developer mode extensions" bubble on each start; dismissing it is harmless, and it never disables ExamEye. It does not appear when Developer mode is left ON.
- The extension id differs per machine on this route (it is derived from the folder path), so it cannot be used with the policies below.

**Store listing (required for managed fleets)**
- `ExtensionInstallForcelist` (same policy name on Chrome and Edge) only accepts extensions that are hosted: an unpacked folder cannot be force-installed.
- Publish ExamEye as an *unlisted* item on the Chrome Web Store (Chrome) and Microsoft Edge Add-ons (Edge). Unlisted = installable by anyone with the link or by policy, but not searchable. The store review is what takes time; start it before the exam window.
- Alternative without a store: self-host the packed `.crx` and an update-manifest XML on an internal HTTPS server and reference both in the policy (`<id>;<update_url>`). This keeps one fixed extension id, but you own the hosting and the signing key.
- With a listing or a self-hosted CRX, push the id via `ExtensionInstallForcelist`; the extension then installs on browser start with no clicks and cannot be disabled by the candidate.

## 2. Allow in Incognito / InPrivate (one time)
- Chrome: `chrome://extensions` -> ExamEye -> Details -> "Allow in Incognito" ON.
- Edge: `edge://extensions` -> ExamEye -> Details -> "Allow in InPrivate" ON.
- Without this, incognito windows are invisible to ExamEye and INCOGNITO_WINDOW_OPENED is never recorded. Managed fleet: prefer `IncognitoModeAvailability = 1` (disabled) instead.

## 3. Downloads
- Browser Settings -> Downloads: "Ask where to save each file before downloading" OFF.
- Note the download location; ExamEye writes to `<Chrome download directory>/<subfolder>/<YYYYMMDD-HHMMSS_SEAT>/`.
- Managed fleet: `DownloadDirectory` and `PromptForDownloadLocation = false` policies.

## 4. Configure (extension Options page)
| Field | Value |
|---|---|
| Exam start URL prefix | the URL every candidate lands on first, up to but excluding the per-candidate tail |
| Exam in-progress URL prefix (optional; blank = start page origin) | leave blank unless the paper runs on a different path/host than the start page |
| Result URL prefix | the URL shown when the paper is submitted; optional if an end button or marker is set |
| Start button label (optional; blank = arm on start URL) | the visible label of the button that starts the paper, if the platform stays on one URL |
| End button label(s), comma-separated (optional) | the platform's submit label(s); where the platform shows a confirm dialog, use the **confirm** button's label, not the initial Finish/Submit button (see spec §14 item 11) |
| Submitted-screen marker text (optional; must appear only after submission) | a phrase that appears on the submitted screen and nowhere else in the paper |
| Maximum paper length (minutes; 0 = no backstop) | recommended: the paper's scheduled length plus a small margin |
| Post-submit tail (minutes; 0 = end immediately) | 5 (default) |
| Seat / Centre ID | e.g. `C12-S07` |
| Output subfolder under Downloads | `ExamEye` (default) |
| Periodic screenshot interval (minutes) | 10 (default) |
| Abandon session after exam tab gone (minutes) | 10 (default) |
| Desktop capture | `on` (default; set `off` only where the centre forbids screen recording) |
| Re-ask after a declined share (minutes; 0 = ask once) | 5 (default) |
Click Save. The status line must read `Saved.`; any red text names a field to fix.

## 5. Tab sleeping
- Chrome: Settings -> Performance -> Memory Saver: add the exam site to "Always keep these sites active".
- Edge: Settings -> System and performance -> "Never put these sites to sleep": add the exam site.

## 5a. Screen recording permission (macOS only)
Windows needs nothing. macOS: System Settings -> Privacy & Security -> Screen Recording -> enable Chrome (or Edge), then quit and reopen the browser; without it every desktop frame is black and nothing warns.

## 6. Dry run (10 minutes)
1. Open the exam start URL in a new tab. Click the ExamEye toolbar icon: popup "State" must show `ARMED` and "Session" a session id.
   If a Start button label is configured, the popup must still show `IDLE` after the start page loads and `ARMED` only after the Start button is clicked.
1a. If Desktop capture is `on`, the start page also opens a small "ExamEye screen capture" window and Chrome's "Share your entire screen" dialog; click the screen preview, then **Share** (Chrome enables Share only after the preview is clicked). The popup must show `Desktop capture: on since HH:MM:SS`. The small window minimises itself; do not close it.
2. Open a second tab to any site, then return. Popup "Counters" must show `TAB_SWITCH: 1`.
2a. If Desktop capture is `on`, click the desktop or another application for 15 s, then return to Chrome.
3. Minimise and restore the window. Counters must show `WINDOW_MINIMIZED: 1`.
4. Trigger the real screensaver or lock screen (hot corner, or wait out the machine's idle timeout) and then resume. Popup "Counters" must show `SCREENSAVER: 1`, and `log.txt` in the session folder must contain a line with `IDLE_START` and `state="locked"` - this holds on the idle-timeout path too: Chrome may report `state="idle"` first (detection interval) and only report `state="locked"` once the screensaver actually engages, and the log now shows both transitions (an `IDLE_END` closing the idle interval followed by a fresh `IDLE_START state="locked"`). If the platform never reports a locked state at all, `state="idle"` is expected instead - this is the documented `idle` fallback classification and is not a fault. `log.txt` is written on the next flush, not instantly - check the popup's "Last flush" time before checking the file.
On a throw-away candidate account walk every in-paper screen and confirm the configured marker phrase appears on none of them, then submit and confirm it appears on the submitted screen; the popup must show `CLOSING` and return to `IDLE` after the tail (default 5 minutes) or when the tab is closed.
5. Navigate the exam tab to the result URL. State returns to `IDLE`.
6. Check `<Chrome download directory>/ExamEye/<YYYYMMDD-HHMMSS_SEAT>/` contains `log.txt`, `events.jsonl`, `summary.txt`, `summary.html`, `screenshots/` with at least 3 JPEGs. If Desktop capture is `on`, it also contains `screenshots/desktop/` with at least 2 JPEGs, and `summary.html` must show them next to `FOCUS_LEFT_CHROME`/`DESKTOP_FRAME` (on macOS, confirm they are not black). Open `summary.html` and confirm the screenshots display. `summary.txt` must show `Outcome: SUBMITTED` (or `AUTO_SUBMITTED` / `RESULT` as applicable), a `Trigger:` line, a `Post-submit tail` line with a screenshot count, and (if Desktop capture is `on`) a `Desktop:` line.
7. The download shelf/flyout must not have shown any ExamEye files. If it did on Edge, that build lacks `downloads.setUiOptions`; recording is unaffected.
8. Edge vertical tabs / side panel can trigger DEVTOOLS_OPENED on every page - close them for the exam.
9. A result page opening in a new tab (not the exam tab) also ends the session: `SESSION_DISARMED{outcome:RESULT}` is recorded from that tab and the popup returns to `IDLE`.

## 7. Unmanaged machines - what is and is not enforced
- Nothing prevents a candidate from disabling the extension. A re-enable shows up as EXTENSION_GAP; a session with missing files is itself evidence.
- ExamEye records "focus left Chrome"; when Desktop capture is `off` it takes no desktop screenshots. It never names other applications, even when Desktop capture is `on`.

## 8. Candidate notice
Display or read out before the paper: "Your screen is recorded during this paper. Chrome will ask you to share your screen when the exam page opens: click the screen preview, then Share. Do not close the small ExamEye window or press Stop sharing." Cancel and Stop sharing are logged and re-asked.
