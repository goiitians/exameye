@echo off
setlocal
set "SRC=%~dp0ExamEye"
set "DEST=%USERPROFILE%\ExamEye"
set "UPD=%USERPROFILE%\ExamEye-updater"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LOG=%TEMP%\ExamEye-install.log"
set "REINSTALL="
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
if exist "%DEST%\manifest.json" call :uninstall || exit /b 1
echo Copying ExamEye to %DEST% ^(Chrome loads it from there, so the pen drive or the extracted folder can go afterwards^).
robocopy "%SRC%" "%DEST%" /E /R:2 /W:2 /NP > "%LOG%"
if errorlevel 8 (
  echo Copy failed ^(robocopy code %ERRORLEVEL%^). Details: %LOG%
  echo If Chrome is open, close it and run this installer again.
  pause
  exit /b 1
)
echo.
set /p SEAT=Seat or centre ID for this desk [C01]: 
if "%SEAT%"=="" set "SEAT=C01"
set "EXAMEYE_SEAT=%SEAT%"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { $p=Join-Path $env:USERPROFILE 'ExamEye\defaults.json'; $j=Get-Content -Raw $p | ConvertFrom-Json; $j.seat=$env:EXAMEYE_SEAT; $j | ConvertTo-Json | Set-Content -Encoding UTF8 $p } catch { exit 1 }"
if errorlevel 1 (
  echo The seat ID could not be written to %DEST%\defaults.json. Fix it on the setup page after loading the extension.
)
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
echo Chrome is starting. ExamEye was already loaded from %DEST%, so there is nothing to click:
echo Chrome loads the new version from the same folder. Check that the ExamEye popup shows
echo "Installed version" with the new number. Saved settings are kept; if the seat ID is wrong,
echo change it on the setup page ^(ExamEye - Details - Extension options^).
echo.
pause
exit /b 0

rem An earlier install is replaced whole (task, folders, Startup entry), so no file from an older
rem version survives. Chrome must be closed: deleting the folder it has loaded fails half-way.
:uninstall
set "REINSTALL=1"
echo ExamEye is already installed at %DEST%; replacing it.
tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | find /I "chrome.exe" >nul && goto :chromeopen
tasklist /FI "IMAGENAME eq msedge.exe" /NH 2>nul | find /I "msedge.exe" >nul && goto :chromeopen
schtasks /Delete /TN "ExamEye Update" /F >nul 2>&1
for %%d in ("%DEST%" "%DEST%.new" "%DEST%.old" "%UPD%") do if exist "%%~d" rmdir /s /q "%%~d"
if exist "%STARTUP%\ExamEye-Update.vbs" del /q "%STARTUP%\ExamEye-Update.vbs"
if exist "%DEST%\manifest.json" (
  echo The old ExamEye folder could not be removed: %DEST%
  echo Close every Chrome window ^(check the tray^), then run this installer again.
  pause
  exit /b 1
)
exit /b 0

:chromeopen
echo Chrome is open. Close it ^(check the tray^), then run this installer again.
pause
exit /b 1
