# ExamEye - centre setup checklist

Do this once per machine. After step 6 the extension needs no clicks on browser start or exam start.

## 1. Install
- Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select the ExamEye folder (or install from the Web Store listing when published).
- Edge: `edge://extensions` -> Developer mode -> Load unpacked (or Edge Add-ons listing).
- Managed fleet: push the extension id via the `ExtensionInstallForcelist` policy (same policy name on Chrome and Edge).

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
| Result URL prefix | the URL shown when the paper is submitted |
| Seat / Centre ID | e.g. `C12-S07` |
| Output subfolder under Downloads | `ExamEye` (default) |
| Periodic screenshot interval (minutes) | 10 (default) |
| Abandon session after exam tab gone (minutes) | 10 (default) |
Click Save. The status line must read `Saved.`; any red text names a field to fix.

## 5. Tab sleeping
- Chrome: Settings -> Performance -> Memory Saver: add the exam site to "Always keep these sites active".
- Edge: Settings -> System and performance -> "Never put these sites to sleep": add the exam site.

## 6. Dry run (10 minutes)
1. Open the exam start URL in a new tab. Click the ExamEye toolbar icon: popup "State" must show `ARMED` and "Session" a session id.
2. Open a second tab to any site, then return. Popup "Counters" must show `TAB_SWITCH: 1`.
3. Minimise and restore the window. Counters must show `WINDOW_MINIMIZED: 1`.
4. Trigger the real screensaver or lock screen (hot corner, or wait out the machine's idle timeout) and then resume. Popup "Counters" must show `SCREENSAVER: 1`, and `log.txt` in the session folder must contain a line with `IDLE_START` and `state="locked"`. If the platform never reports a locked state, `state="idle"` is expected instead - this is the documented `idle` fallback classification and is not a fault. `log.txt` is written on the next flush, not instantly - check the popup's "Last flush" time before checking the file.
5. Navigate the exam tab to the result URL. State returns to `IDLE`.
6. Check `<Chrome download directory>/ExamEye/<YYYYMMDD-HHMMSS_SEAT>/` contains `log.txt`, `events.jsonl`, `summary.txt`, `summary.html`, `screenshots/` with at least 3 JPEGs. Open `summary.html` and confirm the screenshots display.
7. The download shelf/flyout must not have shown any ExamEye files. If it did on Edge, that build lacks `downloads.setUiOptions`; recording is unaffected.

## 7. Unmanaged machines - what is and is not enforced
- Nothing prevents a candidate from disabling the extension. A re-enable shows up as EXTENSION_GAP; a session with missing files is itself evidence.
- ExamEye only records "focus left Chrome"; it does not name other applications and takes no desktop screenshots.
