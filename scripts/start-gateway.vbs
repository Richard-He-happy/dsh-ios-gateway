' Start the DSH mobile gateway hidden.
' Node resolution order:
'   1. %DSH_NODE%            (explicit path to node.exe)
'   2. DeepSeek Harness bundled Node (Program Files / LocalAppData)
'   3. node.exe from PATH
Option Explicit
Dim fso, sh, base, nodeExe, candidates, p
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = ""

If Len(sh.ExpandEnvironmentStrings("%DSH_NODE%")) > 0 Then
  If fso.FileExists(sh.ExpandEnvironmentStrings("%DSH_NODE%")) Then
    nodeExe = sh.ExpandEnvironmentStrings("%DSH_NODE%")
  End If
End If

If nodeExe = "" Then
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe", _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe", _
    sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" _
  )
  For Each p In candidates
    If fso.FileExists(p) Then
      nodeExe = p
      Exit For
    End If
  Next
End If

If nodeExe = "" Then nodeExe = "node.exe"

sh.Run """" & nodeExe & """ """ & base & "\gateway\mobile-gateway.cjs""", 0, False
