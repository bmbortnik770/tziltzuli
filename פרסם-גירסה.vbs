Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")
sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)
sPS1  = sRoot & "\פרסם-גירסה.ps1"

If Not oFSO.FileExists(sPS1) Then
    MsgBox "לא נמצא קובץ: " & sPS1, 16, "שגיאה"
    WScript.Quit 1
End If

' Run with visible console so errors are seen (developer tool)
oShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & sPS1 & """", 1, False
