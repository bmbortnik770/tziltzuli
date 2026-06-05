Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")
sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)
sPS1  = sRoot & "\מתקין-צילצולי.ps1"

If Not oFSO.FileExists(sPS1) Then
    MsgBox "שגיאה: לא נמצא קובץ המתקין." & vbCrLf & sPS1, 16, "שגיאת התקנה"
    WScript.Quit 1
End If

ret = oShell.Run("powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & sPS1 & """", 0, True)

If ret <> 0 Then
    MsgBox "המתקין נסגר עם שגיאה (קוד " & ret & ")." & vbCrLf & vbCrLf & _
           "ודא שמותר להריץ תוכניות PowerShell במחשב זה." & vbCrLf & _
           "נסה ללחוץ לחיצה ימנית על הקובץ ולבחור 'הפעל כמנהל'.", 16, "שגיאת התקנה"
End If
