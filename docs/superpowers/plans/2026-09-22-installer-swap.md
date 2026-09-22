# Installer: stage-and-swap, no PowerShell (2026-09-22)

## Root causes (from the code on disk and the v0.1.4 release zip)

The v0.1.4 zip is complete (every src file, valid manifest); the failures come from
`installer/Install-ExamEye.cmd` as shipped since PR #6:

1. **Reinstall refuses whenever `chrome.exe` or `msedge.exe` exists in the task list.**
   Edge on Windows keeps `msedge.exe` processes alive with no window (startup boost /
   "continue running background apps", both on by default); Chrome does the same when its
   background mode is on. The `:uninstall` gate therefore reports "Chrome is open" on a PC whose
   browser windows are all closed, and the operator can never get past it.
2. **The reinstall deletes `<home>\ExamEye` before copying** (`rmdir /s /q`), so any file that
   cannot be removed (delete-pending under an antivirus scan, a stray handle) leaves a folder
   that passes the `manifest.json` check yet has holes; Chrome then reports
   "Could not load background script 'src/sw.js'. Could not load manifest." — that message is
   Chrome's wording for a background script path that does not exist on disk.
3. **The seat ID is written with PowerShell** (`powershell -NoProfile -Command ... ConvertTo-Json`).
   On the centre PCs a Group Policy already blocks `.ps1` (PR #4); the same hardening makes
   `powershell.exe` slow to start (the long pause after the seat prompt) or fail, and on failure
   the only trace is one console line, so the seat stays `C01`. `Update-ExamEye.cmd :log` spawns
   PowerShell every hour for a timestamp — same class.

Not reproducible here (no Windows, no Wine): the batch scripts are reviewed by reading; the
macOS installer gets a real regression test.

## Design

Both installers do what the updaters already do: **stage into `<home>/ExamEye.new`, write the
seat there, swap by rename, verify, never delete first**. No browser-process gate decides
whether to proceed; only an exam in progress does (marker `ARMED`/`CLOSING` while a browser runs).
If the rename fails because the folder is in use, nothing has changed and the message says to
close Chrome and Edge and run again. No PowerShell anywhere on Windows.

## Task 1 — `installer/Install-ExamEye.cmd` (rewrite the body; keep the header, tone, messages)

Variables: add `NEW=%DEST%.new`, `OLD=%DEST%.old`, `STATE=%USERPROFILE%\Downloads\ExamEye-updater\state.txt`.
Use `setlocal EnableExtensions DisableDelayedExpansion` at the top.

Flow:
1. USERPROFILE / `%SRC%\manifest.json` checks as today.
2. `if exist "%DEST%\manifest.json" set "REINSTALL=1"`.
   `if exist "%DEST%" if not defined REINSTALL` → print that a folder named `%DEST%` exists but is
   not ExamEye and must be moved away by hand; pause; exit 1. (Never delete it.)
3. `if defined REINSTALL call :examcheck || exit /b 1` — see below.
4. Stage: `if exist "%NEW%" rmdir /s /q "%NEW%"`, then
   `robocopy "%SRC%" "%NEW%" /E /R:2 /W:2 /NP > "%LOG%"`; `if errorlevel 8` → today's message,
   remove `%NEW%`, pause, exit 1. Then `call :verify "%NEW%" || (rmdir /s /q "%NEW%" 2>nul & pause & exit /b 1)`.
5. Seat, pure batch (this fragment is the reference; keep it verbatim apart from wording).
   Batch rule that shaped it: `!var!` is NOT expanded on either side of a pipe (each side runs in
   a child cmd.exe without delayed expansion), so nothing with `!` goes through `|`; text is
   checked through a file instead, and the redirect comes first (`echo(C01>` would parse `1>` as a
   handle). The seat line is replaced by line number, so every other line of a centre-edited
   defaults.json is kept as shipped, and the trailing comma is preserved.
```
rem No PowerShell: the centre PCs block or throttle it by policy.
:askseat
set "SEAT="
set /p SEAT=Seat or centre ID for this desk [C01]: 
if not defined SEAT set "SEAT=C01"
setlocal EnableDelayedExpansion
>"%NEW%\seat.tmp" echo(!SEAT!
findstr /R /X /I /C:"[A-Z0-9_-]*" "%NEW%\seat.tmp" >nul
if errorlevel 1 (
  del /q "%NEW%\seat.tmp"
  endlocal
  echo Use letters, digits, - and _ only.
  goto :askseat
)
del /q "%NEW%\seat.tmp"
set "SEATLN=0"
for /f "tokens=1 delims=:" %%n in ('findstr /N /C:"\"seat\"" "%NEW%\defaults.json"') do if "!SEATLN!"=="0" set "SEATLN=%%n"
set "COMMA="
findstr /C:"\"seat\"" "%NEW%\defaults.json" | findstr /E /C:"," >nul && set "COMMA=,"
set /a N=0
(for /f "usebackq delims=" %%l in ("%NEW%\defaults.json") do (
  set /a N+=1
  set "line=%%l"
  if !N!==!SEATLN! (echo(  "seat": "!SEAT!"!COMMA!) else echo(!line!
)) > "%NEW%\defaults.seat"
findstr /C:"\"seat\": \"!SEAT!\"" "%NEW%\defaults.seat" >nul && move /y "%NEW%\defaults.seat" "%NEW%\defaults.json" >nul || (
  del /q "%NEW%\defaults.seat" 2>nul
  echo The seat ID could not be written to defaults.json. Fix it on the setup page after loading the extension.
)
endlocal & set "SEAT=%SEAT%"
```
6. Swap:
```
if defined REINSTALL (
  if exist "%OLD%" rmdir /s /q "%OLD%"
  ren "%DEST%" "ExamEye.old" 2>nul || goto :inuse
  ren "%NEW%" "ExamEye" 2>nul || (ren "%OLD%" "ExamEye" & goto :inuse)
  rmdir /s /q "%OLD%" 2>nul
) else (
  ren "%NEW%" "ExamEye" 2>nul || goto :inuse
)
call :verify "%DEST%" || (pause & exit /b 1)
```
   `rem`: two renames, as in Update-ExamEye.cmd — a failure anywhere leaves the live folder as it was.
7. Clipboard, updater setup (`schtasks /Create /F`, `copy /Y` into `%UPD%` and Startup) exactly as
   today; no `schtasks /Delete`, no removal of `%UPD%` (update.log is kept).
8. `start chrome ... || start msedge ...` and the two message blocks as today. Reinstall message:
   Chrome loads the new version from the same folder at its next start; if Chrome was open,
   ExamEye reloads itself within a minute while idle, or right after the exam ends.

Subroutines:
```
:verify
for %%f in (manifest.json src\sw.js src\popup\popup.html src\options\options.html) do if not exist "%~1\%%f" (
  echo The copy is incomplete: %~1\%%f is missing. Details: %LOG%
  exit /b 1
)
exit /b 0

:inuse
if exist "%NEW%" rmdir /s /q "%NEW%" 2>nul
echo ExamEye at %DEST% is in use and could not be replaced; nothing was changed.
echo Close Chrome and Edge ^(check the tray; Edge keeps running in the background^), then run this installer again.
pause
exit /b 1

rem A reinstall while an exam is running would swap files under the recording; the marker is
rem the same one Update-ExamEye.cmd trusts. No browser process at all means no exam.
:examcheck
tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | find /I "chrome.exe" >nul && goto :statecheck
tasklist /FI "IMAGENAME eq msedge.exe" /NH 2>nul | find /I "msedge.exe" >nul && goto :statecheck
exit /b 0
:statecheck
set "STATEV="
if exist "%STATE%" for /f "usebackq delims=" %%l in ("%STATE%") do if not defined STATEV set "STATEV=%%l"
if "%STATEV%"=="ARMED" goto :examrunning
if "%STATEV%"=="CLOSING" goto :examrunning
exit /b 0
:examrunning
echo An exam is running on this PC ^(ExamEye reports %STATEV%^). Wait for it to end, then run this installer again.
pause
exit /b 1
```
Remove `:uninstall`, `:chromeopen`, `:reinstalled`'s claim that the old install was removed.

## Task 2 — `installer/Update-ExamEye.cmd` `:log`
Replace the PowerShell timestamp with `%DATE% %TIME%` only (drop the `for /f ... powershell` line
and the `if not defined STAMP` fallback; keep delayed expansion for the message). Update the
header comment if it mentions the timestamp. Nothing parses the timestamp.

## Task 3 — `installer/Install-ExamEye.command` (mirror of Task 1 in bash)
- Remove the pgrep refusal and the `rm -rf "$DEST" ...` block.
- Reinstall (`-f "$DEST/manifest.json"`): if `pgrep -xq 'Google Chrome' || pgrep -xq 'Microsoft Edge'`,
  read `head -n 1 "$HOME/Downloads/ExamEye-updater/state.txt"`; `ARMED`/`CLOSING` → message, exit 1.
- `$DEST` exists without manifest.json → message (move it away), exit 1.
- Stage: `rm -rf "$NEW"; mkdir -p "$NEW"; cp -R "$SRC/." "$NEW/"`; verify `manifest.json`,
  `src/sw.js`, `src/popup/popup.html`, `src/options/options.html` exist in `$NEW`.
- Seat prompt as today, validated with `[[ "$SEAT" =~ ^[A-Za-z0-9_-]+$ ]]` (re-ask otherwise);
  `sed -i ''` on `$NEW/defaults.json`.
- Swap exactly as `update-exameye.sh`: `rm -rf "$OLD"`; `mv "$DEST" "$OLD"` (reinstall);
  `mv "$NEW" "$DEST" || { mv "$OLD" "$DEST"; fail }`; `rm -rf "$OLD"`. On failure: same
  "in use, nothing changed, quit Chrome and Edge" wording as Windows.
- Keep `register_updater` (it already boots out and re-registers); do not delete
  `$HOME/ExamEye-updater`.

## Task 4 — regression test `tests/unit/install-command.test.js` (node:test, skipped unless `process.platform === 'darwin'`)
Build a fake installer folder in a tmp dir: `Install-ExamEye.command`, `update-exameye.sh`,
`ExamEye/` with the repo `manifest.json`, `installer/defaults.json`, `src/sw.js`,
`src/popup/popup.html`, `src/options/options.html` (copy the real files). Shim dir first on PATH
with executable no-op scripts `open`, `pbcopy`, `launchctl`, and `pgrep` (exit 0 = a browser is
running). Run `bash Install-ExamEye.command` with `HOME=<tmp home>`, stdin `A07\n`, `PATH=shim:$PATH`.
Assert: `$HOME/ExamEye/defaults.json` has `"seat": "A07"`, `src/sw.js` present, no `ExamEye.new`.
Then bump the version in the fake `ExamEye/manifest.json`, write `IDLE` to
`$HOME/Downloads/ExamEye-updater/state.txt`, run again with `B02\n`: exit 0, new version and
`"seat": "B02"` in `$HOME/ExamEye`, no `.new`/`.old`. Then write `ARMED`, run with `C03\n`: exit
non-zero, `$HOME/ExamEye/manifest.json` and seat unchanged. (The old script fails the second
run: it exits "Chrome is open".) Run in the foreground with `execFileSync`/`spawnSync`.

## Task 5 — docs
- `installer/READ-ME-FIRST.txt` "Reinstall or upgrade by hand": Chrome need not be closed; the
  installer stages the new folder next to the old one and swaps it; it refuses only while an exam
  is running; update.log is kept; if the swap says the folder is in use, close Chrome and Edge
  (Edge runs in the background) and run again. Also the Windows install step no longer mentions
  a pause.
- `docs/centre-setup.md` §1 first bullet list: same one-line change where it says what the
  installer does.
- `docs/superpowers/specs/2026-09-21-auto-update-design.md` §4: one sentence that the installer
  swaps like the updater.

## Verify
`npm run check && npm test` in the foreground; the new test must fail against the old
`Install-ExamEye.command` (check by `git stash` of that one file or by reading) and pass after.
Batch files: `node -e` CRLF check is in build-installer.test.js already; read the .cmd once more
for unbalanced parentheses inside `echo` (every `(` or `)` in an echo line is `^`-escaped).
