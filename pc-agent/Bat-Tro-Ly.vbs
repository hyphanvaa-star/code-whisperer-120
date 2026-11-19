Option Explicit
Dim shell, fso, root, pythonw, candidate, version, base, probe, file, command, extra
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = ""
Dim saved
saved = fso.BuildPath(fso.BuildPath(root, "app"), "python-path.txt")
If fso.FileExists(saved) Then
  Set file = fso.OpenTextFile(saved, 1)
  If Not file.AtEndOfStream Then candidate = Trim(file.ReadLine)
  file.Close
  If candidate <> "" Then
    If fso.FileExists(candidate) Then pythonw = candidate
  End If
End If
For Each version In Array("3.14", "3.13", "3.12", "3.11", "3.10")
  If pythonw <> "" Then Exit For
  For Each base In Array("HKCU\Software\Python\PythonCore\", "HKLM\Software\Python\PythonCore\")
    On Error Resume Next
    candidate = shell.RegRead(base & version & "\InstallPath\") & "pythonw.exe"
    If Err.Number = 0 Then
      If fso.FileExists(candidate) Then pythonw = candidate
    End If
    Err.Clear
    On Error GoTo 0
    If pythonw <> "" Then Exit For
  Next
  If pythonw <> "" Then Exit For
  For Each base In Array(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\", "C:\", shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\")
    candidate = base & "Python" & Replace(version, ".", "") & "\pythonw.exe"
    If fso.FileExists(candidate) Then pythonw = candidate
    If pythonw <> "" Then Exit For
  Next
  If pythonw <> "" Then Exit For
Next
If pythonw = "" Then
  probe = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName)
  command = "cmd.exe /d /c ""where pythonw.exe > """ & probe & """ 2>nul"""
  shell.Run command, 0, True
  If fso.FileExists(probe) Then
    Set file = fso.OpenTextFile(probe, 1)
    Dim storePy
    storePy = ""
    Do Until file.AtEndOfStream
      candidate = Trim(file.ReadLine)
      If candidate <> "" Then
        If InStr(LCase(candidate), "windowsapps") = 0 Then
          If fso.FileExists(candidate) Then
            pythonw = candidate
            Exit Do
          End If
        ElseIf storePy = "" Then
          storePy = candidate
        End If
      End If
    Loop
    If pythonw = "" Then pythonw = storePy
    file.Close
    fso.DeleteFile probe, True
  End If
End If
Dim useCmd
useCmd = False
If pythonw = "" Or InStr(LCase(pythonw), "windowsapps") > 0 Then useCmd = True
If useCmd Then
  probe = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName)
  shell.Run "cmd.exe /d /c ""python --version > """ & probe & """ 2>&1""", 0, True
  candidate = ""
  If fso.FileExists(probe) Then
    Set file = fso.OpenTextFile(probe, 1)
    If Not file.AtEndOfStream Then candidate = Trim(file.ReadLine)
    file.Close
    fso.DeleteFile probe, True
  End If
  If InStr(candidate, "Python 3") = 1 Then
    pythonw = "python"
  ElseIf pythonw = "" Then
    pythonw = ""
  Else
    useCmd = False
  End If
End If
If pythonw = "" Then
  MsgBox "Chua co Python. Nho IT cai Python 3 roi bam lai.", 48, "Tro ly Sohee"
  WScript.Quit 1
End If
' --- Tai bo khoi dong moi nhat tu web (mat mang thi dung ban da luu) ---
Dim boot, cached, http, stream, ok, args
boot = fso.BuildPath(fso.GetSpecialFolder(2), "sohee-boot.py")
cached = "D:\.TroLyPC\bootstrap.py"
ok = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 10000, 10000, 20000, 20000
http.Open "GET", "https://soheedispatch.cloud/agent/bootstrap.py?t=" & CLng(Timer * 100), False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.Write http.responseBody
    stream.SaveToFile boot, 2
    stream.Close
    If Err.Number = 0 Then ok = True
  End If
End If
Err.Clear
On Error GoTo 0
If Not ok Then
  If fso.FileExists(cached) Then
    boot = cached
  ElseIf fso.FileExists(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\SoheeTroLyPC\bootstrap.py") Then
    boot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\SoheeTroLyPC\bootstrap.py"
  ElseIf Not fso.FileExists(boot) Then
    MsgBox "Khong ket noi duoc soheedispatch.cloud. Kiem tra mang roi bam lai.", 48, "Tro ly Sohee"
    WScript.Quit 1
  End If
End If
If useCmd Then
  shell.Run "cmd.exe /d /c python """ & boot & """", 0, False
Else
  shell.Run """" & pythonw & """ """ & boot & """", 0, False
End If
