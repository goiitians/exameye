@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "SRC=%~dp0ExamEye"
set "DEST=%USERPROFILE%\ExamEye"
set "NEW=%DEST%.new"
set "OLD=%DEST%.old"
set "UPD=%USERPROFILE%\ExamEye-updater"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LOG=%TEMP%\ExamEye-install.log"
set "STATE=%USERPROFILE%\Downloads\ExamEye-updater\state.txt"
set "REINSTALL="
rem a run that died between the two renames of the swap left the live folder under the .old name
if not exist "%DEST%" if exist "%OLD%" ren "%OLD%" "ExamEye"
echo.
echo ExamEye installer
echo =================
if not defined USERPROFILE (
  echo USERPROFILE is not set; cannot tell where to install.
  pause
  exit /b 1
)
if not exist "%SRC%\manifest.json" (
  echo The ExamEye folder was not found next to this file. Looked for:
  echo   %SRC%\manifest.json
  echo Extract the whole zip first, then run Install-ExamEye.cmd from the extracted folder.
  pause
  exit /b 1
)
if exist "%DEST%\manifest.json" set "REINSTALL=1"
if exist "%DEST%" if not defined REINSTALL (
  echo A folder named %DEST% already exists but is not ExamEye. Move it away by hand, then run this installer again.
  pause
  exit /b 1
)
if defined REINSTALL (
  echo ExamEye is already installed at %DEST%; replacing it.
  call :examcheck || exit /b 1
)
echo Copying ExamEye to %DEST% ^(Chrome loads it from there, so the pen drive or the extracted folder can go afterwards^).
if exist "%NEW%" rmdir /s /q "%NEW%"
robocopy "%SRC%" "%NEW%" /MIR /R:2 /W:2 /NP > "%LOG%"
if errorlevel 8 (
  echo Copy failed ^(robocopy code %ERRORLEVEL%^). Details: %LOG%
  if exist "%NEW%" rmdir /s /q "%NEW%"
  pause
  exit /b 1
)
call :verify "%NEW%" "Details: %LOG%" || (rmdir /s /q "%NEW%" 2>nul & pause & exit /b 1)
echo.
rem No PowerShell: the centre PCs block or throttle it by policy.
:askseat
set "SEAT="
set /p SEAT=Seat or centre ID for this desk [C01]: 
if not defined SEAT set "SEAT=C01"
setlocal EnableDelayedExpansion
>"%TEMP%\ExamEye-seat.tmp" echo(!SEAT!
findstr /R /X /I /C:"[A-Z0-9_-]*" "%TEMP%\ExamEye-seat.tmp" >nul
if errorlevel 1 (
  del /q "%TEMP%\ExamEye-seat.tmp"
  endlocal
  echo Use letters, digits, - and _ only.
  goto :askseat
)
del /q "%TEMP%\ExamEye-seat.tmp"
rem both line numbers come from findstr /N, so blank lines in a centre-edited file cannot shift them
set "SEATLN=0"
for /f "tokens=1 delims=:" %%n in ('findstr /N /C:"\"seat\"" "%NEW%\defaults.json"') do if "!SEATLN!"=="0" set "SEATLN=%%n"
set "COMMA="
findstr /C:"\"seat\"" "%NEW%\defaults.json" | findstr /E /C:"," >nul && set "COMMA=,"
(for /f "usebackq tokens=1* delims=:" %%a in (`findstr /N "^" "%NEW%\defaults.json"`) do (
  set "line=%%b"
  if %%a==!SEATLN! (echo(  "seat": "!SEAT!"!COMMA!) else echo(!line!
)) > "%NEW%\defaults.seat"
findstr /C:"\"seat\": \"!SEAT!\"" "%NEW%\defaults.seat" >nul && move /y "%NEW%\defaults.seat" "%NEW%\defaults.json" >nul || (
  del /q "%NEW%\defaults.seat" 2>nul
  echo The seat ID could not be written to defaults.json. Fix it on the setup page after loading the extension.
)
endlocal & set "SEAT=%SEAT%"
rem two renames, as in Update-ExamEye.cmd - a failure anywhere leaves the live folder as it was
if defined REINSTALL (
  if exist "%OLD%" rmdir /s /q "%OLD%"
  ren "%DEST%" "ExamEye.old" 2>nul || goto :inuse
  ren "%NEW%" "ExamEye" 2>nul || goto :rollback
  rmdir /s /q "%OLD%" 2>nul
) else (
  ren "%NEW%" "ExamEye" 2>nul || goto :inuse
)
call :verify "%DEST%" "after the swap" || (pause & exit /b 1)
<nul set /p "=%DEST%" | clip
if not exist "%UPD%" mkdir "%UPD%"
copy /Y "%~dp0Update-ExamEye.cmd" "%UPD%\Update-ExamEye.cmd" >nul && copy /Y "%~dp0Update-ExamEye.vbs" "%UPD%\Update-ExamEye.vbs" >nul && schtasks /Create /F /SC HOURLY /MO 1 /ST 00:00 /TN "ExamEye Update" /TR "wscript.exe //B //Nologo \"%UPD%\Update-ExamEye.vbs\"" >nul && copy /Y "%~dp0Update-ExamEye.vbs" "%STARTUP%\ExamEye-Update.vbs" >nul
if errorlevel 1 (
  echo Could not set up automatic updates. ExamEye still works; updates will need a re-install.
) else (
  echo Automatic updates set up: task "ExamEye Update" on the hour and a Startup entry; they replace ExamEye while Chrome is closed or ExamEye is idle.
)
start chrome "chrome://extensions" 2>nul || start msedge "edge://extensions"
echo.
if defined REINSTALL goto :reinstalled
echo Chrome is opening its Extensions page. Three clicks left:
echo   1. Switch on "Developer mode" (top right).
echo   2. Click "Load unpacked".
echo   3. Paste the folder path (it is already on the clipboard) and click "Select Folder":
echo      %DEST%
echo.
echo The ExamEye setup page then opens by itself with everything filled in.
echo Check the seat ID (%SEAT%) and click "Save settings".
echo.
echo Afterwards, on the same Extensions page: ExamEye - Details - "Allow in Incognito": on.
echo And in Chrome Settings - Downloads: "Ask where to save each file before downloading": off.
echo.
pause
exit /b 0

:reinstalled
echo Chrome loads the new version from the same folder at its next start. If Chrome was open,
echo ExamEye reloads itself within a minute while idle, or right after the exam ends. Check that
echo the ExamEye popup shows "Installed version" with the new number. Saved settings are kept;
echo if the seat ID is wrong, change it on the setup page ^(ExamEye - Details - Extension options^).
echo.
pause
exit /b 0

:verify
for %%f in (manifest.json src\sw.js src\popup\popup.html src\options\options.html) do if not exist "%~1\%%f" (
  echo The folder is incomplete: %~1\%%f is missing. %~2
  exit /b 1
)
exit /b 0

:rollback
ren "%OLD%" "ExamEye" 2>nul || goto :halfswapped
goto :inuse

:halfswapped
echo The swap stopped half-way: the previous ExamEye is at %OLD% and the new copy at %NEW%.
echo Close Chrome and Edge, then run this installer again; it puts the previous folder back first.
pause
exit /b 1

:inuse
if exist "%DEST%\manifest.json" if exist "%NEW%" rmdir /s /q "%NEW%" 2>nul
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
