Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")
sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)
oShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & sRoot & "\הסר-צילצולי.ps1"" """ & sRoot & """", 0, False
