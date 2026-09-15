!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER
Var InstalledVersion
Var VersionComparison
Var DirectoryInput

Function AbortIfMyTodoRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_FILENAME}.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\\"${APP_FILENAME}.exe\\""`
  Pop $0
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION|MB_TOPMOST "检测到应用正在运行，请先关闭"
    Quit
  ${EndIf}
FunctionEnd

!macro customCheckAppRunning
  Call AbortIfMyTodoRunning
!macroend

Function EnsureMyTodoInstallDirectory
  StrCpy $R0 "$INSTDIR" 1 -1
  ${If} $R0 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
  ${EndIf}

  ${GetFileName} "$INSTDIR" $R0
  ${If} $R0 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

Function BrowseInstallDirectory
  ${NSD_GetText} $DirectoryInput $0
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
  ${EndIf}
  nsDialogs::SelectFolderDialog "选择 MyTodo 安装位置" "$0"
  Pop $1
  ${If} $1 != "error"
    StrCpy $INSTDIR "$1"
    Call EnsureMyTodoInstallDirectory
    ${NSD_SetText} $DirectoryInput "$INSTDIR"
  ${EndIf}
FunctionEnd

Function InstallDirectoryPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  Call EnsureMyTodoInstallDirectory
  !insertmacro MUI_HEADER_TEXT "选择安装位置" "选择 MyTodo 要安装的文件夹。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "选择父文件夹后，会自动添加 MyTodo 子目录。"
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 12u "目标文件夹"
  Pop $0
  ${NSD_CreateText} 0 49u 77% 12u "$INSTDIR"
  Pop $DirectoryInput
  ${NSD_CreateButton} 79% 49u 21% 12u "浏览..."
  Pop $0
  ${NSD_OnClick} $0 BrowseInstallDirectory

  nsDialogs::Show
FunctionEnd

Function InstallDirectoryPageLeave
  ${NSD_GetText} $DirectoryInput $INSTDIR
  Call EnsureMyTodoInstallDirectory
FunctionEnd

Function DisableAutoStart
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\mytodo-install-options.json" w
  ${IfNot} ${Errors}
    FileWrite $0 '{"autoStart":false}'
    FileClose $0
  ${EndIf}
FunctionEnd

Function EnableAutoStart
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" '"$INSTDIR\${APP_FILENAME}.exe" --hidden'
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\mytodo-install-options.json" w
  ${IfNot} ${Errors}
    FileWrite $0 '{"autoStart":true}'
    FileClose $0
  ${EndIf}
FunctionEnd

Function StartApp
  ExecShell "open" "$INSTDIR\${APP_FILENAME}.exe"
FunctionEnd

!macro customInit
  ${If} ${UAC_IsInnerInstance}
    Return
  ${EndIf}

  Call AbortIfMyTodoRunning

  ${IfNot} ${isUpdated}
    ReadRegStr $InstalledVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $InstalledVersion != ""
      ${VersionCompare} "$InstalledVersion" "${VERSION}" $VersionComparison

      ${If} $VersionComparison == "1"
        MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "无法安装 MyTodo ${VERSION}。当前已安装版本：$InstalledVersion，安装包版本：${VERSION}。为避免数据和程序文件不兼容，MyTodo 不允许降级安装。" /SD IDOK
        Quit
      ${ElseIf} $VersionComparison == "0"
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "当前已安装 MyTodo $InstalledVersion。是否重新安装相同版本 ${VERSION}？" /SD IDYES IDYES mytodo_same_version_continue
        Quit
        mytodo_same_version_continue:
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "检测到已安装 MyTodo $InstalledVersion，即将升级到 MyTodo ${VERSION}。" /SD IDYES IDYES mytodo_upgrade_continue
        Quit
        mytodo_upgrade_continue:
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks InstallDirectoryPageCreate InstallDirectoryPageLeave
  PageExEnd
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "开机自动启动 MyTodo"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "EnableAutoStart"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    Call DisableAutoStart
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  ${EndIf}
!macroend
