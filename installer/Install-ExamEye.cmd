@echo off
setlocal
set "SRC=%~dp0ExamEye"
set "DEST=%USERPROFILE%\ExamEye"
set "UPD=%USERPROFILE%\ExamEye-updater"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LOG=%TEMP%\ExamEye-install.log"
echo.
echo ExamEye installer
echo =================
if not exist "%SRC%\manifest.json" (
  echo The ExamEye folder was not found next to this file. Looked for:
  echo   %SRC%\manifest.json
  echo Extract the whole zip first, then run Install-ExamEye.cmd from the extracted folder.
  pause
  exit /b 1
)
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
copy /Y "%~dp0Update-ExamEye.cmd" "%UPD%\Update-ExamEye.cmd" >nul && copy /Y "%~dp0Update-ExamEye.vbs" "%UPD%\Update-ExamEye.vbs" >nul && schtasks /Create /F /SC HOURLY /MO 1 /TN "ExamEye Update" /TR "wscript.exe //B //Nologo \"%UPD%\Update-ExamEye.vbs\"" >nul && copy /Y "%~dp0Update-ExamEye.vbs" "%STARTUP%\ExamEye-Update.vbs" >nul
if errorlevel 1 (
  echo Could not set up automatic updates. ExamEye still works; updates will need a re-install.
) else (
  echo Automatic updates set up: hourly task "ExamEye Update" and a Startup entry, both run only while Chrome is closed.
)
start chrome "chrome://extensions" 2>nul || start msedge "edge://extensions"
echo.
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
