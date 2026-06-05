Dim oFSO, oShell, oHTTP, sRoot, bRunning
Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")
sRoot = oFSO.GetParentFolderName(WScript.ScriptFullName)

bRunning = False
On Error Resume Next
Set oHTTP = CreateObject("WinHttp.WinHttpRequest.5.1")
oHTTP.SetTimeouts 800,800,800,800
oHTTP.Open "GET","http://localhost:3000/api/status",False
oHTTP.Send
If Err.Number = 0 And oHTTP.Status = 200 Then bRunning = True
On Error GoTo 0

If Not bRunning Then
    oShell.Run "cmd /c cd /d """ & sRoot & "\school-bells-server"" && node server.js", 0, False
    WScript.Sleep 2800
End If

oShell.Run "http://localhost:3000"
