@echo off
setlocal
set "SRC=%~dp0ExamEye"
set "DEST=%USERPROFILE%\ExamEye"
echo.
echo ExamEye installer
echo =================
echo Copying ExamEye to %DEST% (Chrome loads it from there, so the pen drive can be removed afterwards).
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Copy failed. Is the pen drive still connected?
  pause
  exit /b 1
)
echo.
set /p SEAT=Seat or centre ID for this desk [C01]: 
if "%SEAT%"=="" set "SEAT=C01"
powershell -NoProfile -Command "$p='%DEST%\defaults.json'; $j=Get-Content -Raw $p | ConvertFrom-Json; $j.seat='%SEAT%'; $j | ConvertTo-Json | Set-Content -Encoding UTF8 $p"
<nul set /p "=%DEST%" | clip
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
