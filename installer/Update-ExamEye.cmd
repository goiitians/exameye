@echo off
rem ExamEye updater for Windows. Plain batch on purpose: a Group Policy execution policy blocks every
rem PowerShell script file on managed PCs. Runs hourly (task "ExamEye Update") and at logon (Startup
rem entry), both through Update-ExamEye.vbs so no window appears. Swaps the extension folder only while
rem Chrome is closed or ExamEye's own marker says its session is IDLE, so a running exam never sees mixed files. Log: %USERPROFILE%\ExamEye-updater\update.log
setlocal EnableExtensions DisableDelayedExpansion
set "BASE=%EXAMEYE_UPDATE_URL%"
if "%BASE%"=="" set "BASE=https://github.com/goiitians/exameye/releases/latest/download"
set "EXT=%USERPROFILE%\ExamEye"
set "NEW=%EXT%.new"
set "OLD=%EXT%.old"
set "DIR=%USERPROFILE%\ExamEye-updater"
set "STATE=%USERPROFILE%\Downloads\ExamEye-updater\state.txt"
set "LOG=%DIR%\update.log"
set "TMPD=%TEMP%\exameye-update-%RANDOM%%RANDOM%"
if not exist "%DIR%" mkdir "%DIR%"
rem the Startup entry and the hourly task can fire together at logon: handle 9 on the lock file is
rem held for the whole run, and a second instance cannot open it, so it does nothing at all
2>nul (9>"%DIR%\.lock" call :main)
goto :eof

:main
rem a run that died between the two renames of the swap left the live folder under the .old name
if not exist "%EXT%" if exist "%OLD%" ren "%OLD%" "ExamEye"
if not exist "%EXT%\manifest.json" (call :log "failed: not installed" & goto :eof)
call :version "%EXT%\manifest.json" INSTALLED
if not defined INSTALLED (call :log "failed: bad manifest" & goto :eof)
mkdir "%TMPD%" 2>nul || (call :log "failed: mktemp" & goto :eof)
curl -fsSL --max-time 60 -o "%TMPD%\version.txt" "%BASE%/version.txt" 2>nul || (call :log "failed: cannot read version.txt" & goto :cleanup)
set "LATEST="
for /f "usebackq delims=" %%l in ("%TMPD%\version.txt") do if not defined LATEST set "LATEST=%%l"
if not defined LATEST (call :log "failed: empty version.txt" & goto :cleanup)
if "%LATEST%"=="%INSTALLED%" (call :log "up to date %INSTALLED%" & goto :cleanup)
call :gate
if defined SKIP (call :log "skipped %LATEST%: chrome running (%SKIP%)" & goto :cleanup)
curl -fsSL --max-time 300 -o "%TMPD%\exameye-installer.zip" "%BASE%/exameye-installer.zip" 2>nul || (call :log "failed: download" & goto :cleanup)
tar -xf "%TMPD%\exameye-installer.zip" -C "%TMPD%" 2>nul || (call :log "failed: unzip" & goto :cleanup)
set "SRC=%TMPD%\exameye-installer"
if not exist "%SRC%\ExamEye\manifest.json" (call :log "failed: bad archive" & goto :cleanup)
call :version "%SRC%\ExamEye\manifest.json" GOT
if not "%GOT%"=="%LATEST%" (call :log "failed: bad archive (%GOT%)" & goto :cleanup)
rem stage next to the live folder and swap by two renames: a failure anywhere leaves the live folder untouched
if exist "%NEW%" rmdir /s /q "%NEW%"
if exist "%OLD%" rmdir /s /q "%OLD%"
robocopy "%SRC%\ExamEye" "%NEW%" /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (call :log "failed: mirror" & goto :cleanup)
rem defaults.json carries the seat id typed at install and is read once, on first install
if exist "%EXT%\defaults.json" copy /Y "%EXT%\defaults.json" "%NEW%\defaults.json" >nul || (call :log "failed: defaults" & goto :cleanup)
call :gate
if defined SKIP (call :log "skipped %LATEST%: chrome running (%SKIP%)" & goto :cleanup)
ren "%EXT%" "ExamEye.old" 2>nul || (call :log "failed: swap" & goto :cleanup)
ren "%NEW%" "ExamEye" 2>nul || (ren "%OLD%" "ExamEye" & call :log "failed: swap" & goto :cleanup)
set "NOTE="
rmdir /s /q "%OLD%" 2>nul || set "NOTE= (cleanup failed)"
copy /Y "%SRC%\Update-ExamEye.vbs" "%DIR%\Update-ExamEye.vbs" >nul && copy /Y "%SRC%\Update-ExamEye.cmd" "%DIR%\Update-ExamEye.cmd.new" >nul || set "NOTE=%NOTE% (self-copy failed)"
call :log "updated %INSTALLED% -> %LATEST%%NOTE%"
call :cleanup
rem cmd reads a running batch file by offset and holds it open, so the new copy of this file is moved
rem into place by a detached process a few seconds after this run has exited (timeout needs a console)
if exist "%DIR%\Update-ExamEye.cmd.new" start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & move /y "%DIR%\Update-ExamEye.cmd.new" "%DIR%\Update-ExamEye.cmd" >nul"
goto :eof

:cleanup
if exist "%NEW%" rmdir /s /q "%NEW%" 2>nul
if exist "%TMPD%" rmdir /s /q "%TMPD%" 2>nul
goto :eof

:log
rem delayed expansion keeps "->" and parentheses in the message out of the parser's hands;
rem no PowerShell for the timestamp (blocked or slow by policy on managed PCs) - %DATE% %TIME%
rem is good enough for a log line nothing parses
setlocal EnableDelayedExpansion
set "MSG=%~1"
>>"%LOG%" echo(%DATE% %TIME% !MSG!
endlocal
goto :eof

:version
rem "version": "0.1.7", -> 0.1.7  ("manifest_version" has no quote before the word, so it does not match)
setlocal
set "V_="
for /f "tokens=2 delims=:" %%v in ('findstr /C:"\"version\"" "%~1"') do if not defined V_ set "V_=%%v"
if defined V_ set "V_=%V_:"=%"
if defined V_ set "V_=%V_:,=%"
if defined V_ set "V_=%V_: =%"
endlocal & set "%~2=%V_%"
goto :eof

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
