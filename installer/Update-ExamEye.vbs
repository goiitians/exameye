' ExamEye updater launcher: runs Update-ExamEye.cmd with no console window. The hourly task and the
' Startup entry both point here, so the candidate never sees a window flash during an exam.
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd.exe /c """ & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\ExamEye-updater\Update-ExamEye.cmd""", 0, False
