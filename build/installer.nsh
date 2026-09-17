!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER
Var InstalledVersion
Var VersionComparison
Var DirectoryInput
Var IsInAppUpdate
Var UpdateWindowPrepared
Var UpdateProgressPage
Var UpdateProgressBar
Var UpdateProgressIcon
Var UpdateProgressIconImage
Var UpdateProgressTitle
Var UpdateProgressVersion
Var UpdateProgressStatus
Var UpdateProgressPercent
Var UpdateTitleFont
Var UpdateBodyFont
Var UpdatePercentFont
Var UpdateCheckFont
Var UpdateButtonFont
Var UpdateFinishCheck
Var UpdateFinishTitle
Var UpdateFinishText
Var UpdateFinishButton
!define MUI_FINISHPAGE_INTERFACE
Var mui.FinishPage
Var mui.FinishPage.Image
Var mui.FinishPage.Image.Bitmap
Var mui.FinishPage.Title
Var mui.FinishPage.Title.Font
Var mui.FinishPage.Text
!define MUI_FINISHPAGE_RUN_VARIABLES
Var mui.FinishPage.Run
!define MUI_FINISHPAGE_SHOWREADME_VARIABLES
Var mui.FinishPage.ShowReadme

Function AbortIfMyTodoRunning
  ${If} $IsInAppUpdate == "1"
    StrCpy $R0 0
    mytodo_wait_for_update_exit:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_FILENAME}.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\\"${APP_FILENAME}.exe\\""`
    Pop $0
    ${If} $0 != 0
      Goto mytodo_app_not_running
    ${EndIf}
    IntOp $R0 $R0 + 1
    ${If} $R0 < 10
      Sleep 500
      Goto mytodo_wait_for_update_exit
    ${EndIf}
  ${Else}
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_FILENAME}.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\\"${APP_FILENAME}.exe\\""`
    Pop $0
  ${EndIf}
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION|MB_TOPMOST "检测到应用正在运行，请先关闭"
    Quit
  ${EndIf}
  mytodo_app_not_running:
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
  ${If} $IsInAppUpdate == "1"
    Abort
  ${EndIf}

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

Function PrepareUpdateWindow
  ${If} $UpdateWindowPrepared == "1"
    Return
  ${EndIf}

  System::Call 'USER32::GetWindowRect(p$HWNDPARENT,@r0)'
  System::Call '*$0(i.r1,i.r2,i.r3,i.r4)'
  IntOp $5 $3 - $1
  IntOp $6 $4 - $2
  IntOp $7 $5 * 86
  IntOp $7 $7 / 100
  IntOp $8 $6 * 72
  IntOp $8 $8 / 100
  IntOp $5 $5 - $7
  IntOp $5 $5 / 2
  IntOp $6 $6 - $8
  IntOp $6 $6 / 2
  IntOp $1 $1 + $5
  IntOp $2 $2 + $6
  System::Call 'USER32::SetWindowPos(p$HWNDPARENT,p0,i$1,i$2,i$7,i$8,i0x0004)'
  StrCpy $UpdateWindowPrepared "1"
FunctionEnd

Function HideUpdateInstallerChrome
  GetDlgItem $0 $HWNDPARENT 1034
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 0
FunctionEnd

Function UpdateProgressTick
  ${If} $IsInAppUpdate != "1"
    Return
  ${EndIf}
  ${If} $UpdateProgressBar == ""
    Return
  ${EndIf}

  SendMessage $UpdateProgressBar ${PBM_GETPOS} 0 0 $0
  ${NSD_SetText} $UpdateProgressPercent "$0%"
  ${If} $0 < 12
    ${NSD_SetText} $UpdateProgressStatus "准备更新"
  ${ElseIf} $0 < 92
    ${NSD_SetText} $UpdateProgressStatus "替换程序文件"
  ${Else}
    ${NSD_SetText} $UpdateProgressStatus "完成安装"
  ${EndIf}
FunctionEnd

Function InstallProgressPageShow
  ${If} $IsInAppUpdate == "1"
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:MyTodo 更新"
    Call PrepareUpdateWindow
    Call HideUpdateInstallerChrome

    FindWindow $UpdateProgressPage "#32770" "" $HWNDPARENT
    SetCtlColors $UpdateProgressPage "172033" "F8FAFB"
    System::Call 'USER32::GetClientRect(p$HWNDPARENT,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 28
    IntOp $2 $2 - 24
    System::Call 'USER32::SetWindowPos(p$UpdateProgressPage,p0,i14,i12,i$1,i$2,i0x0004)'

    GetDlgItem $0 $UpdateProgressPage 1006
    ShowWindow $0 0
    GetDlgItem $0 $UpdateProgressPage 1016
    ShowWindow $0 0
    GetDlgItem $0 $UpdateProgressPage 1027
    ShowWindow $0 0

    GetDlgItem $UpdateProgressBar $UpdateProgressPage 1004
    System::Call 'UXTHEME::SetWindowTheme(p$UpdateProgressBar,w" ",w" ")'
    SendMessage $UpdateProgressBar ${PBM_SETBARCOLOR} 0 0x00E5464F
    SendMessage $UpdateProgressBar ${PBM_SETBKCOLOR} 0 0x00ECE7E3

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000003,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
    StrCpy $UpdateProgressIcon $0
    ${NSD_SetIconFromInstaller} $UpdateProgressIcon $UpdateProgressIconImage
    System::Call 'USER32::SetWindowPos(p$UpdateProgressIcon,p0,i22,i22,i32,i32,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"正在安装更新",i0x50000000,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
    StrCpy $UpdateProgressTitle $0
    CreateFont $UpdateTitleFont "$(^Font)" "13" "700"
    SendMessage $UpdateProgressTitle ${WM_SETFONT} $UpdateTitleFont 0
    SetCtlColors $UpdateProgressTitle "172033" "F8FAFB"
    System::Call 'USER32::SetWindowPos(p$UpdateProgressTitle,p0,i68,i18,i300,i26,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"MyTodo ${VERSION}",i0x50000000,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
    StrCpy $UpdateProgressVersion $0
    CreateFont $UpdateBodyFont "$(^Font)" "9" "400"
    SendMessage $UpdateProgressVersion ${WM_SETFONT} $UpdateBodyFont 0
    SetCtlColors $UpdateProgressVersion "748093" "F8FAFB"
    System::Call 'USER32::SetWindowPos(p$UpdateProgressVersion,p0,i68,i45,i300,i18,i0x0004)'

    System::Call 'USER32::GetClientRect(p$UpdateProgressPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 44
    System::Call 'USER32::SetWindowPos(p$UpdateProgressBar,p0,i22,i82,i$1,i11,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"准备更新",i0x50000000,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
    StrCpy $UpdateProgressStatus $0
    SendMessage $UpdateProgressStatus ${WM_SETFONT} $UpdateBodyFont 0
    SetCtlColors $UpdateProgressStatus "748093" "F8FAFB"
    System::Call 'USER32::SetWindowPos(p$UpdateProgressStatus,p0,i22,i103,i240,i18,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"0%",i0x50000002,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
    StrCpy $UpdateProgressPercent $0
    CreateFont $UpdatePercentFont "$(^Font)" "9" "700"
    SendMessage $UpdateProgressPercent ${WM_SETFONT} $UpdatePercentFont 0
    SetCtlColors $UpdateProgressPercent "4F46E5" "F8FAFB"
    System::Call 'USER32::GetClientRect(p$UpdateProgressPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 102
    System::Call 'USER32::SetWindowPos(p$UpdateProgressPercent,p0,i$1,i103,i80,i18,i0x0004)'

    ${NSD_CreateTimer} UpdateProgressTick 100
    Call UpdateProgressTick
  ${EndIf}
FunctionEnd

Function InstallProgressPageLeave
  ${If} $IsInAppUpdate == "1"
    ${NSD_KillTimer} UpdateProgressTick
    ${NSD_FreeIcon} $UpdateProgressIconImage
    StrCpy $UpdateProgressBar ""
  ${EndIf}
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
  ${If} $IsInAppUpdate == "1"
    StrCpy $1 "--updated"
  ${Else}
    StrCpy $1 ""
  ${EndIf}
  ExecShell "open" "$INSTDIR\${APP_FILENAME}.exe" "$1"
FunctionEnd

!macro customInstallMode
  ${If} $IsInAppUpdate == "1"
    ${If} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  StrCpy $IsInAppUpdate "0"
  StrCpy $UpdateWindowPrepared "0"
  ${If} ${isUpdated}
    StrCpy $IsInAppUpdate "1"
  ${EndIf}

  ${If} ${UAC_IsInnerInstance}
    Return
  ${EndIf}

  ${If} $IsInAppUpdate == "1"
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $INSTDIR "$0"
    ${EndIf}
    Return
  ${EndIf}

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
!macroend

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks InstallDirectoryPageCreate InstallDirectoryPageLeave
  PageExEnd
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstallProgressPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE InstallProgressPageLeave
!macroend

Function FinishUpdateClick
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${BM_CLICK} 0 0
FunctionEnd

Function FinishPageShow
  ${If} $IsInAppUpdate == "1"
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:MyTodo 更新"
    Call PrepareUpdateWindow
    Call HideUpdateInstallerChrome

    System::Call 'USER32::GetClientRect(p$HWNDPARENT,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 28
    IntOp $2 $2 - 24
    System::Call 'USER32::SetWindowPos(p$mui.FinishPage,p0,i14,i12,i$1,i$2,i0x0004)'
    SetCtlColors $mui.FinishPage "172033" "F8FAFB"

    ShowWindow $mui.FinishPage.Image 0
    ShowWindow $mui.FinishPage.Title 0
    ShowWindow $mui.FinishPage.Text 0
    ShowWindow $mui.FinishPage.ShowReadme 0
    SendMessage $mui.FinishPage.Run ${BM_SETCHECK} ${BST_CHECKED} 0
    ShowWindow $mui.FinishPage.Run 0

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"✓",i0x50000001,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
    StrCpy $UpdateFinishCheck $0
    CreateFont $UpdateCheckFont "Segoe UI Symbol" "24" "700"
    SendMessage $UpdateFinishCheck ${WM_SETFONT} $UpdateCheckFont 0
    SetCtlColors $UpdateFinishCheck "1D9A72" "F8FAFB"
    System::Call 'USER32::GetClientRect(p$mui.FinishPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 48
    IntOp $1 $1 / 2
    System::Call 'USER32::SetWindowPos(p$UpdateFinishCheck,p0,i$1,i16,i48,i46,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"更新完成",i0x50000001,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
    StrCpy $UpdateFinishTitle $0
    CreateFont $UpdateTitleFont "$(^Font)" "13" "700"
    SendMessage $UpdateFinishTitle ${WM_SETFONT} $UpdateTitleFont 0
    SetCtlColors $UpdateFinishTitle "172033" "F8FAFB"
    System::Call 'USER32::GetClientRect(p$mui.FinishPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 44
    System::Call 'USER32::SetWindowPos(p$UpdateFinishTitle,p0,i22,i66,i$1,i26,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"点击完成启动 MyTodo",i0x50000001,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
    StrCpy $UpdateFinishText $0
    SendMessage $UpdateFinishText ${WM_SETFONT} $UpdateBodyFont 0
    SetCtlColors $UpdateFinishText "748093" "F8FAFB"
    System::Call 'USER32::GetClientRect(p$mui.FinishPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 44
    System::Call 'USER32::SetWindowPos(p$UpdateFinishText,p0,i22,i94,i$1,i20,i0x0004)'

    System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"完成",i0x50000301,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
    StrCpy $UpdateFinishButton $0
    CreateFont $UpdateButtonFont "$(^Font)" "9" "700"
    SendMessage $UpdateFinishButton ${WM_SETFONT} $UpdateButtonFont 0
    SetCtlColors $UpdateFinishButton "FFFFFF" "4F46E5"
    System::Call 'USER32::GetClientRect(p$mui.FinishPage,@r0)'
    System::Call '*$0(i,i,i.r1,i.r2)'
    IntOp $1 $1 - 116
    IntOp $2 $2 - 46
    System::Call 'USER32::SetWindowPos(p$UpdateFinishButton,p0,i$1,i$2,i94,i30,i0x0004)'
    ${NSD_OnClick} $UpdateFinishButton FinishUpdateClick
  ${EndIf}
FunctionEnd

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "开机自动启动 MyTodo"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "EnableAutoStart"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
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
