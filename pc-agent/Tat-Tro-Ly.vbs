Option Explicit
Dim shell, fso, root
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "wscript.exe """ & fso.BuildPath(root, "Chay-Ngam.vbs") & """ --stop", 0, False