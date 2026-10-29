Option Explicit
Dim shell, fso, root, pythonw, candidate, version, base, probe, file, command, extra
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = ""
For Each version In Array("3.14", "3.13", "3.12", "3.11", "3.10")
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
    Do Until file.AtEndOfStream
      candidate = Trim(file.ReadLine)
      If fso.FileExists(candidate) And InStr(LCase(candidate), "windowsapps") = 0 Then
        pythonw = candidate
        Exit Do
      End If
    Loop
    file.Close
    fso.DeleteFile probe, True
  End If
End If
If pythonw = "" Then
  MsgBox "Chua co Python. Chay cai-tro-ly.bat mot lan, sau do bam Chay-Ngam.vbs.", 48, "Tro ly Sohee"
  WScript.Quit 1
End If
extra = ""
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--stop" Then extra = " --stop"
End If
shell.CurrentDirectory = root
shell.Run """" & pythonw & """ """ & fso.BuildPath(root, "background.py") & """" & extra, 0, False