!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER
Var InstalledVersion
Var VersionComparison
Var InstallerAutoStart
Var AutoStartCheckbox

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

Function AutoStartPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  Call EnsureMyTodoInstallDirectory
  !insertmacro MUI_HEADER_TEXT "安装选项" "确认安装位置和启动方式"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "MyTodo 将安装到："
  Pop $0
  ${NSD_CreateLabel} 0 20u 100% 30u "$INSTDIR"
  Pop $0
  ${NSD_CreateCheckbox} 0 60u 100% 18u "登录 Windows 后在后台启动 MyTodo"
  Pop $AutoStartCheckbox

  ${If} $InstallerAutoStart == "1"
    ${NSD_Check} $AutoStartCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function AutoStartPageLeave
  ${NSD_GetState} $AutoStartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallerAutoStart "1"
  ${Else}
    StrCpy $InstallerAutoStart "0"
  ${EndIf}
FunctionEnd

!macro customInit
  StrCpy $InstallerAutoStart "0"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  ${If} $0 != ""
    StrCpy $InstallerAutoStart "1"
  ${EndIf}

  ${IfNot} ${isUpdated}
    ReadRegStr $InstalledVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $InstalledVersion != ""
      ${VersionCompare} "$InstalledVersion" "${VERSION}" $VersionComparison

      ${If} $VersionComparison == "1"
        MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "无法安装 MyTodo ${VERSION}。当前已安装版本：$InstalledVersion，安装包版本：${VERSION}。为避免数据和程序文件不兼容，MyTodo 不允许降级安装。" /SD IDOK
        Quit
      ${ElseIf} $VersionComparison == "0"
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "当前已安装 MyTodo $InstalledVersion。是否重新安装相同版本 ${VERSION}？继续前请先从托盘完全退出正在运行的 MyTodo。" /SD IDYES IDYES mytodo_same_version_continue
        Quit
        mytodo_same_version_continue:
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "检测到已安装 MyTodo $InstalledVersion，即将升级到 MyTodo ${VERSION}。继续前请先从托盘完全退出正在运行的 MyTodo。" /SD IDYES IDYES mytodo_upgrade_continue
        Quit
        mytodo_upgrade_continue:
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks AutoStartPageCreate AutoStartPageLeave
  PageExEnd
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    ${If} $InstallerAutoStart == "1"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
    ${Else}
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    ${EndIf}

    ClearErrors
    FileOpen $0 "$INSTDIR\resources\mytodo-install-options.json" w
    ${IfNot} ${Errors}
      ${If} $InstallerAutoStart == "1"
        FileWrite $0 '{"autoStart":true}'
      ${Else}
        FileWrite $0 '{"autoStart":false}'
      ${EndIf}
      FileClose $0
    ${EndIf}
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  ${EndIf}
!macroend
