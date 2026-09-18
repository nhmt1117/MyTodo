!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "MUI2.nsh"

!ifdef MUI_ABORTWARNING
  !undef MUI_ABORTWARNING
!endif
!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_ABORT MyTodoOnUserAbort
!endif

!ifndef BUILD_UNINSTALLER
Var InstalledVersion
Var VersionComparison
Var DirectoryInput
Var IsInAppUpdate
Var IsUpgradeInstall
Var InstallerEntryState
Var InstallerWindowPrepared
Var InstallerPageActive
Var InstallerAllowExit
Var InstallationLockFile
Var InstallationLockActive
Var ApplicationLaunchGuardHandle
Var WelcomePage
Var WelcomeIcon
Var WelcomeIconImage
Var WelcomeBrand
Var WelcomeTitle
Var WelcomeText
Var WelcomeVersion
Var WelcomeMeta
Var WelcomePrimaryButton
Var WelcomeSecondaryButton
Var WelcomeRunningExitButton
Var WelcomeCancelBackdrop
Var WelcomeCancelPanel
Var WelcomeCancelTitle
Var WelcomeCancelText
Var WelcomeCancelConfirmButton
Var WelcomeCancelContinueButton
Var WelcomeTitleFont
Var WelcomeBodyFont
Var WelcomeButtonFont
Var DirectoryPage
Var DirectoryIcon
Var DirectoryIconImage
Var DirectoryTitle
Var DirectoryPathLabel
Var DirectoryBrowseButton
Var DirectoryRequiredSpace
Var DirectoryAvailableSpace
Var DirectoryBackButton
Var DirectoryInstallButton
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

Function ApplyInstallerWindowEffects
  ; Match the frameless Electron window: native rounded corners, a subtle border,
  ; and DWM-managed shadow while keeping the installer non-resizable.
  System::Call 'USER32::GetClassLongPtrW(p$HWNDPARENT,i-26)p.r8'
  IntOp $8 $8 | 0x00020000
  System::Call 'USER32::SetClassLongPtrW(p$HWNDPARENT,i-26,p$8)'

  System::Call '*(i2)p.r8'
  System::Call 'DWMAPI::DwmSetWindowAttribute(p$HWNDPARENT,i2,p$8,i4)'
  System::Free $8

  System::Call '*(i2)p.r8'
  System::Call 'DWMAPI::DwmSetWindowAttribute(p$HWNDPARENT,i33,p$8,i4)'
  System::Free $8

  System::Call '*(i0x00D3C9C0)p.r8'
  System::Call 'DWMAPI::DwmSetWindowAttribute(p$HWNDPARENT,i34,p$8,i4)'
  System::Free $8

  System::Call '*(i1,i1,i1,i1)p.r8'
  System::Call 'DWMAPI::DwmExtendFrameIntoClientArea(p$HWNDPARENT,p$8)'
  System::Free $8

  System::Call 'USER32::SetWindowPos(p$HWNDPARENT,p0,i0,i0,i0,i0,i0x0027)'
FunctionEnd

Function PrepareInstallerWindow
  ${If} $InstallerWindowPrepared == "1"
    Return
  ${EndIf}

  System::Call 'USER32::GetWindowRect(p$HWNDPARENT,@r0)'
  System::Call '*$0(i.r1,i.r2,i.r3,i.r4)'
  IntOp $5 $3 - $1
  IntOp $6 $4 - $2
  IntOp $5 $5 - 580
  IntOp $5 $5 / 2
  IntOp $6 $6 - 360
  IntOp $6 $6 / 2
  IntOp $1 $1 + $5
  IntOp $2 $2 + $6
  System::Call 'USER32::GetSystemMenu(p$HWNDPARENT,i0)p.r9'
  System::Call 'USER32::DeleteMenu(p$9,i0xF060,i0x0000)'
  System::Call 'USER32::SetWindowLongW(p$HWNDPARENT,i-16,i0x90400000)'
  System::Call 'USER32::SetWindowPos(p$HWNDPARENT,p0,i$1,i$2,i580,i360,i0x0024)'
  Call ApplyInstallerWindowEffects
  SetCtlColors $HWNDPARENT "172033" "F8FAFB"
  StrCpy $InstallerWindowPrepared "1"
FunctionEnd

Function FillPageToInstallerWindow
  Exch $0
  System::Call 'USER32::GetClientRect(p$HWNDPARENT,@r1)'
  System::Call '*$1(i,i,i.r2,i.r3)'
  System::Call 'USER32::SetWindowPos(p$0,p0,i0,i0,i$2,i$3,i0x0004)'
  Pop $0
FunctionEnd

Function HideInstallerChrome
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

Function CreateInstallationLock
  ${If} $InstallationLockActive == "1"
    Return
  ${EndIf}

  System::Call 'KERNEL32::GetCurrentProcessId() i.r0'
  StrCpy $InstallationLockFile "$TEMP\MyTodo-installing-$0.lock"
  ClearErrors
  FileOpen $1 "$InstallationLockFile" w
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "无法开始安装，请检查临时目录权限后重试。"
    Quit
  ${EndIf}
  FileWrite $1 "$0"
  FileClose $1
  StrCpy $InstallationLockActive "1"
FunctionEnd

Function ClearInstallationLock
  ${If} $InstallationLockFile != ""
    Delete "$InstallationLockFile"
  ${EndIf}
  StrCpy $InstallationLockActive "0"
  StrCpy $InstallationLockFile ""
FunctionEnd

Function AcquireApplicationLaunchGuard
  ${If} $ApplicationLaunchGuardHandle != ""
    Return
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\${APP_FILENAME}.exe"
    Return
  ${EndIf}

  System::Call 'KERNEL32::CreateFileW(w "$INSTDIR\${APP_FILENAME}.exe",i0x80000000,i0,p0,i3,i0x80,p0)p.r0'
  ${If} $0 == "-1"
    Call ClearInstallationLock
    MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "无法锁定正在升级的 MyTodo，请确认应用已完全退出后重试。"
    Quit
  ${EndIf}
  StrCpy $ApplicationLaunchGuardHandle "$0"
FunctionEnd

Function ReleaseApplicationLaunchGuard
  ${If} $ApplicationLaunchGuardHandle != ""
    System::Call 'KERNEL32::CloseHandle(p$ApplicationLaunchGuardHandle)'
    StrCpy $ApplicationLaunchGuardHandle ""
  ${EndIf}
FunctionEnd

Function .onGUIEnd
  Call ReleaseApplicationLaunchGuard
  Call ClearInstallationLock
FunctionEnd

Function MyTodoOnUserAbort
  ${If} $InstallerAllowExit == "1"
    Return
  ${EndIf}
  ${If} $InstallerPageActive == "welcome"
    Call ShowWelcomeCancelConfirmation
  ${EndIf}
  Abort
FunctionEnd

Function DetectMyTodoRunning
  StrCpy $0 "0"
  System::Call 'KERNEL32::CreateToolhelp32Snapshot(i0x00000002,i0)p.r1'
  ${If} $1 == "-1"
    Return
  ${EndIf}

  System::Alloc 556
  Pop $2
  System::Call '*$2(i556)'
  System::Call 'KERNEL32::Process32FirstW(p$1,p$2)i.r3'
  ${While} $3 != 0
    System::Call '*$2(i,i,i,i,i,i,i,i,i,&w260.r4)'
    ${If} $4 == "${APP_FILENAME}.exe"
      StrCpy $0 "1"
      ${Break}
    ${EndIf}
    System::Call 'KERNEL32::Process32NextW(p$1,p$2)i.r3'
  ${EndWhile}
  System::Free $2
  System::Call 'KERNEL32::CloseHandle(p$1)'
FunctionEnd

Function AbortIfMyTodoRunning
  ${If} $IsInAppUpdate == "1"
    StrCpy $R0 0
    mytodo_wait_for_update_exit:
    Call DetectMyTodoRunning
    ${If} $0 != "1"
      Goto mytodo_app_not_running
    ${EndIf}
    IntOp $R0 $R0 + 1
    ${If} $R0 < 10
      Sleep 500
      Goto mytodo_wait_for_update_exit
    ${EndIf}
  ${Else}
    Call DetectMyTodoRunning
    ${If} $0 == "1"
      StrCpy $0 0
    ${Else}
      StrCpy $0 1
    ${EndIf}
  ${EndIf}
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION|MB_TOPMOST "检测到应用正在运行，请先关闭"
    Quit
  ${EndIf}
  mytodo_app_not_running:
FunctionEnd

!macro customCheckAppRunning
  Call AbortIfMyTodoRunning
  Call CreateInstallationLock
  Call ReleaseApplicationLaunchGuard
!macroend

Function RenderWelcomePage
  ${NSD_KillTimer} EnableWelcomeRunningExit
  EnableWindow $WelcomeRunningExitButton 1
  ShowWindow $WelcomeCancelBackdrop 0
  ShowWindow $WelcomeCancelPanel 0
  ShowWindow $WelcomeCancelTitle 0
  ShowWindow $WelcomeCancelText 0
  ShowWindow $WelcomeCancelConfirmButton 0
  ShowWindow $WelcomeCancelContinueButton 0
  ShowWindow $WelcomeIcon 1
  ShowWindow $WelcomeTitle 1
  ShowWindow $WelcomeText 1
  ShowWindow $WelcomePrimaryButton 1
  ShowWindow $WelcomeRunningExitButton 0

  ${If} $InstallerEntryState == "fresh"
    ShowWindow $WelcomeBrand 0
    ShowWindow $WelcomeMeta 0
    ShowWindow $WelcomeVersion 1
    ShowWindow $WelcomeSecondaryButton 1
    System::Call 'USER32::SetWindowLongW(p$WelcomeTitle,i-16,i0x50000201)'
    System::Call 'USER32::SetWindowLongW(p$WelcomeText,i-16,i0x50000201)'
    System::Call 'USER32::SetWindowPos(p$WelcomeIcon,p0,i264,i54,i52,i52,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeTitle,p0,i60,i125,i460,i34,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeText,p0,i60,i163,i460,i22,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeVersion,p0,i245,i196,i90,i24,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeSecondaryButton,p0,i202,i287,i84,i32,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomePrimaryButton,p0,i294,i287,i84,i32,i0x0004)'
    SendMessage $WelcomeTitle ${WM_SETTEXT} 0 "STR:欢迎使用 MyTodo"
    SendMessage $WelcomeText ${WM_SETTEXT} 0 "STR:记下要做的，留住想要的。"
    SendMessage $WelcomeVersion ${WM_SETTEXT} 0 "STR:版本 ${VERSION}"
    SendMessage $WelcomeSecondaryButton ${WM_SETTEXT} 0 "STR:取消安装"
    SendMessage $WelcomePrimaryButton ${WM_SETTEXT} 0 "STR:开始安装"
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 1
  ${Else}
    System::Call 'USER32::SetWindowLongW(p$WelcomeTitle,i-16,i0x50000200)'
    System::Call 'USER32::SetWindowLongW(p$WelcomeText,i-16,i0x50000200)'
    ShowWindow $WelcomeBrand 1
    ShowWindow $WelcomeMeta 1
    ShowWindow $WelcomeVersion 0
    System::Call 'USER32::SetWindowPos(p$WelcomeIcon,p0,i34,i28,i28,i28,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeBrand,p0,i70,i29,i210,i26,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeTitle,p0,i42,i104,i496,i32,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeMeta,p0,i42,i146,i496,i28,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$WelcomeText,p0,i42,i183,i496,i44,i0x0004)'

    ${If} $InstallerEntryState == "upgrade"
      ShowWindow $WelcomeSecondaryButton 1
      System::Call 'USER32::SetWindowPos(p$WelcomeSecondaryButton,p0,i390,i287,i70,i32,i0x0004)'
      System::Call 'USER32::SetWindowPos(p$WelcomePrimaryButton,p0,i468,i287,i70,i32,i0x0004)'
      SendMessage $WelcomeTitle ${WM_SETTEXT} 0 "STR:升级 MyTodo？"
      SendMessage $WelcomeMeta ${WM_SETTEXT} 0 "STR:当前版本  $InstalledVersion        升级至  ${VERSION}"
      SendMessage $WelcomeText ${WM_SETTEXT} 0 "STR:升级过程中会保留现有任务、设置和数据存储位置。"
      SendMessage $WelcomeSecondaryButton ${WM_SETTEXT} 0 "STR:取消"
      SendMessage $WelcomePrimaryButton ${WM_SETTEXT} 0 "STR:升级"
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 1
    ${ElseIf} $InstallerEntryState == "same"
      ShowWindow $WelcomeSecondaryButton 0
      System::Call 'USER32::SetWindowPos(p$WelcomePrimaryButton,p0,i468,i287,i70,i32,i0x0004)'
      SendMessage $WelcomeTitle ${WM_SETTEXT} 0 "STR:已安装相同版本"
      SendMessage $WelcomeMeta ${WM_SETTEXT} 0 "STR:当前版本  $InstalledVersion"
      SendMessage $WelcomeText ${WM_SETTEXT} 0 "STR:当前版本与安装包版本相同，无需重新安装。"
      SendMessage $WelcomePrimaryButton ${WM_SETTEXT} 0 "STR:关闭"
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 0
    ${ElseIf} $InstallerEntryState == "downgrade"
      ShowWindow $WelcomeSecondaryButton 0
      System::Call 'USER32::SetWindowPos(p$WelcomePrimaryButton,p0,i468,i287,i70,i32,i0x0004)'
      SendMessage $WelcomeTitle ${WM_SETTEXT} 0 "STR:无法安装较旧版本"
      SendMessage $WelcomeMeta ${WM_SETTEXT} 0 "STR:已安装  $InstalledVersion        安装包  ${VERSION}"
      SendMessage $WelcomeText ${WM_SETTEXT} 0 "STR:为避免程序与数据不兼容，MyTodo 不支持降级安装。"
      SendMessage $WelcomePrimaryButton ${WM_SETTEXT} 0 "STR:关闭"
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 0
    ${Else}
      ShowWindow $WelcomeSecondaryButton 0
      ShowWindow $WelcomePrimaryButton 0
      ShowWindow $WelcomeRunningExitButton 1
      SendMessage $WelcomeTitle ${WM_SETTEXT} 0 "STR:MyTodo 正在运行"
      SendMessage $WelcomeMeta ${WM_SETTEXT} 0 "STR:安装尚未开始"
      SendMessage $WelcomeText ${WM_SETTEXT} 0 "STR:检测到应用正在运行，请先关闭 MyTodo 后重新安装。"
      EnableWindow $WelcomeRunningExitButton 0
      ${NSD_CreateTimer} EnableWelcomeRunningExit 500
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 0
    ${EndIf}
  ${EndIf}
FunctionEnd

Function EnableWelcomeRunningExit
  ${NSD_KillTimer} EnableWelcomeRunningExit
  EnableWindow $WelcomeRunningExitButton 1
FunctionEnd

Function ShowWelcomeCancelConfirmation
  ${If} $InstallerEntryState != "fresh"
    StrCpy $InstallerAllowExit "1"
    SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
    Return
  ${EndIf}
  ShowWindow $WelcomeIcon 0
  ShowWindow $WelcomeBrand 0
  ShowWindow $WelcomeTitle 0
  ShowWindow $WelcomeText 0
  ShowWindow $WelcomeVersion 0
  ShowWindow $WelcomeMeta 0
  ShowWindow $WelcomePrimaryButton 0
  ShowWindow $WelcomeSecondaryButton 0
  ShowWindow $WelcomeRunningExitButton 0
  ShowWindow $WelcomeCancelBackdrop 1
  ShowWindow $WelcomeCancelPanel 1
  ShowWindow $WelcomeCancelTitle 1
  ShowWindow $WelcomeCancelText 1
  ShowWindow $WelcomeCancelConfirmButton 1
  ShowWindow $WelcomeCancelContinueButton 1
FunctionEnd

Function WelcomePrimaryClick
  Pop $0
  ${If} $InstallerEntryState == "fresh"
  ${OrIf} $InstallerEntryState == "upgrade"
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${BM_CLICK} 0 0
  ${Else}
    StrCpy $InstallerAllowExit "1"
    SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
  ${EndIf}
FunctionEnd

Function WelcomeSecondaryClick
  Pop $0
  ${If} $InstallerEntryState == "fresh"
    Call ShowWelcomeCancelConfirmation
  ${Else}
    StrCpy $InstallerAllowExit "1"
    SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
  ${EndIf}
FunctionEnd

Function WelcomeCancelConfirmClick
  Pop $0
  StrCpy $InstallerAllowExit "1"
  SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
FunctionEnd

Function WelcomeCancelContinueClick
  Pop $0
  Call RenderWelcomePage
FunctionEnd

Function WelcomeRunningExitClick
  Pop $0
  StrCpy $InstallerAllowExit "1"
  SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
FunctionEnd

Function WelcomePageCreate
  ${If} $IsInAppUpdate == "1"
    Abort
  ${EndIf}
  ${If} ${Silent}
    Abort
  ${EndIf}

  StrCpy $InstallerPageActive "welcome"
  Call PrepareInstallerWindow
  Call HideInstallerChrome
  nsDialogs::Create 1018
  Pop $WelcomePage
  ${If} $WelcomePage == error
    Abort
  ${EndIf}
  Push $WelcomePage
  Call FillPageToInstallerWindow
  SetCtlColors $WelcomePage "172033" "F8FAFB"

  CreateFont $WelcomeTitleFont "Microsoft YaHei UI" "16" "700"
  CreateFont $WelcomeBodyFont "Microsoft YaHei UI" "9" "400"
  CreateFont $WelcomeButtonFont "Microsoft YaHei UI" "9" "600"

  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000003,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeIcon $0
  ${NSD_SetIconFromInstaller} $WelcomeIcon $WelcomeIconImage
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"MyTodo 安装",i0x50000200,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeBrand $0
  SendMessage $WelcomeBrand ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeBrand "354255" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000201,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeTitle $0
  SendMessage $WelcomeTitle ${WM_SETFONT} $WelcomeTitleFont 0
  SetCtlColors $WelcomeTitle "172033" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000201,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeText $0
  SendMessage $WelcomeText ${WM_SETFONT} $WelcomeBodyFont 0
  SetCtlColors $WelcomeText "748093" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000301,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeVersion $0
  SendMessage $WelcomeVersion ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeVersion "4540B3" "EEEEFF"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000200,i0,i0,i0,i0,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeMeta $0
  SendMessage $WelcomeMeta ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeMeta "4F46E5" "F8FAFB"
  ${NSD_CreateLabel} 0 0 0 0 ""
  Pop $WelcomeSecondaryButton
  System::Call 'USER32::SetWindowLongW(p$WelcomeSecondaryButton,i-16,i0x50000301)'
  SendMessage $WelcomeSecondaryButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeSecondaryButton "354255" "F4F6F8"
  ${NSD_OnClick} $WelcomeSecondaryButton WelcomeSecondaryClick
  ${NSD_CreateLabel} 0 0 0 0 ""
  Pop $WelcomePrimaryButton
  System::Call 'USER32::SetWindowLongW(p$WelcomePrimaryButton,i-16,i0x50000301)'
  SendMessage $WelcomePrimaryButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomePrimaryButton "FFFFFF" "4F46E5"
  ${NSD_OnClick} $WelcomePrimaryButton WelcomePrimaryClick
  ${NSD_CreateLabel} 0 0 0 0 "退出安装程序"
  Pop $WelcomeRunningExitButton
  System::Call 'USER32::SetWindowLongW(p$WelcomeRunningExitButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$WelcomeRunningExitButton,p0,i414,i287,i124,i32,i0x0004)'
  SendMessage $WelcomeRunningExitButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeRunningExitButton "FFFFFF" "4F46E5"
  ${NSD_OnClick} $WelcomeRunningExitButton WelcomeRunningExitClick

  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000000,i0,i0,i580,i360,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeCancelBackdrop $0
  SetCtlColors $WelcomeCancelBackdrop "172033" "DDE2E6"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000000,i110,i76,i360,i205,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeCancelPanel $0
  SetCtlColors $WelcomeCancelPanel "172033" "F8FAFB"
  System::Call 'GDI32::CreateRoundRectRgn(i0,i0,i360,i205,i14,i14)p.r1'
  System::Call 'USER32::SetWindowRgn(p$WelcomeCancelPanel,p$1,i1)'
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"确认取消安装？",i0x50000200,i145,i112,i290,i28,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeCancelTitle $0
  SendMessage $WelcomeCancelTitle ${WM_SETFONT} $WelcomeTitleFont 0
  SetCtlColors $WelcomeCancelTitle "172033" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"取消后将退出安装程序，MyTodo 不会安装到这台电脑。",i0x50000200,i145,i151,i290,i42,p$WelcomePage,p0,p0,p0)p.r0'
  StrCpy $WelcomeCancelText $0
  SendMessage $WelcomeCancelText ${WM_SETFONT} $WelcomeBodyFont 0
  SetCtlColors $WelcomeCancelText "748093" "F8FAFB"
  ${NSD_CreateLabel} 0 0 0 0 "确认取消"
  Pop $WelcomeCancelConfirmButton
  System::Call 'USER32::SetWindowLongW(p$WelcomeCancelConfirmButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$WelcomeCancelConfirmButton,p0,i247,i222,i84,i32,i0x0004)'
  SendMessage $WelcomeCancelConfirmButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeCancelConfirmButton "354255" "F4F6F8"
  ${NSD_OnClick} $WelcomeCancelConfirmButton WelcomeCancelConfirmClick
  ${NSD_CreateLabel} 0 0 0 0 "继续安装"
  Pop $WelcomeCancelContinueButton
  System::Call 'USER32::SetWindowLongW(p$WelcomeCancelContinueButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$WelcomeCancelContinueButton,p0,i339,i222,i84,i32,i0x0004)'
  SendMessage $WelcomeCancelContinueButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $WelcomeCancelContinueButton "FFFFFF" "4F46E5"
  ${NSD_OnClick} $WelcomeCancelContinueButton WelcomeCancelContinueClick

  Call RenderWelcomePage
  nsDialogs::Show
FunctionEnd

Function WelcomePageLeave
  ${If} $InstallerEntryState != "fresh"
  ${AndIf} $InstallerEntryState != "upgrade"
    Abort
  ${EndIf}

  Call DetectMyTodoRunning
  ${If} $0 == "1"
    StrCpy $InstallerEntryState "running"
    Call RenderWelcomePage
    Abort
  ${EndIf}

  Call CreateInstallationLock
  Call AcquireApplicationLaunchGuard
  StrCpy $InstallerPageActive ""
  ${NSD_KillTimer} EnableWelcomeRunningExit
  ${NSD_FreeIcon} $WelcomeIconImage
  StrCpy $WelcomeIconImage ""
FunctionEnd

!macro customWelcomePage
  PageEx custom
    PageCallbacks WelcomePageCreate WelcomePageLeave
  PageExEnd
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
    Call UpdateInstallSpaceLabels
  ${EndIf}
FunctionEnd

Function UpdateInstallSpaceLabels
  StrCpy $0 ${ESTIMATED_SIZE}
  IntOp $0 $0 + 1023
  IntOp $0 $0 / 1024
  ${DriveSpace} "$INSTDIR" "/D=F /S=M" $1
  ${If} $1 == ""
    StrCpy $1 "无法读取"
  ${Else}
    IntOp $1 $1 / 1024
    StrCpy $1 "$1 GB"
  ${EndIf}
  SendMessage $DirectoryRequiredSpace ${WM_SETTEXT} 0 "STR:所需空间    $0 MB"
  SendMessage $DirectoryAvailableSpace ${WM_SETTEXT} 0 "STR:可用空间    $1"
FunctionEnd

Function DirectoryBackClick
  Pop $0
  GetDlgItem $0 $HWNDPARENT 3
  SendMessage $0 ${BM_CLICK} 0 0
FunctionEnd

Function DirectoryInstallClick
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${BM_CLICK} 0 0
FunctionEnd

Function InstallDirectoryPageCreate
  ${If} $IsInAppUpdate == "1"
    Abort
  ${EndIf}
  ${If} $IsUpgradeInstall == "1"
    Abort
  ${EndIf}

  ${If} ${Silent}
    Abort
  ${EndIf}

  StrCpy $InstallerPageActive "directory"
  Call PrepareInstallerWindow
  Call HideInstallerChrome
  Call EnsureMyTodoInstallDirectory
  nsDialogs::Create 1018
  Pop $DirectoryPage
  ${If} $DirectoryPage == error
    Abort
  ${EndIf}
  Push $DirectoryPage
  Call FillPageToInstallerWindow
  SetCtlColors $DirectoryPage "172033" "F8FAFB"

  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000003,i0,i0,i0,i0,p$DirectoryPage,p0,p0,p0)p.r0'
  StrCpy $DirectoryIcon $0
  ${NSD_SetIconFromInstaller} $DirectoryIcon $DirectoryIconImage
  System::Call 'USER32::SetWindowPos(p$DirectoryIcon,p0,i42,i38,i36,i36,i0x0004)'
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"选择安装位置",i0x50000200,i90,i40,i340,i32,p$DirectoryPage,p0,p0,p0)p.r0'
  StrCpy $DirectoryTitle $0
  SendMessage $DirectoryTitle ${WM_SETFONT} $WelcomeTitleFont 0
  SetCtlColors $DirectoryTitle "172033" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"安装到",i0x50000200,i60,i126,i450,i20,p$DirectoryPage,p0,p0,p0)p.r0'
  StrCpy $DirectoryPathLabel $0
  SendMessage $DirectoryPathLabel ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $DirectoryPathLabel "4F5C6C" "F8FAFB"
  ${NSD_CreateText} 0 0 0 0 "$INSTDIR"
  Pop $DirectoryInput
  SendMessage $DirectoryInput ${WM_SETFONT} $WelcomeBodyFont 0
  System::Call 'USER32::SetWindowPos(p$DirectoryInput,p0,i60,i151,i408,i35,i0x0004)'
  ${NSD_CreateLabel} 0 0 0 0 "浏览"
  Pop $DirectoryBrowseButton
  System::Call 'USER32::SetWindowLongW(p$DirectoryBrowseButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$DirectoryBrowseButton,p0,i476,i151,i66,i35,i0x0004)'
  SendMessage $DirectoryBrowseButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $DirectoryBrowseButton "354255" "F4F6F8"
  ${NSD_OnClick} $DirectoryBrowseButton BrowseInstallDirectory
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000200,i60,i197,i310,i22,p$DirectoryPage,p0,p0,p0)p.r0'
  StrCpy $DirectoryRequiredSpace $0
  SendMessage $DirectoryRequiredSpace ${WM_SETFONT} $WelcomeBodyFont 0
  SetCtlColors $DirectoryRequiredSpace "596676" "F8FAFB"
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000200,i60,i221,i310,i22,p$DirectoryPage,p0,p0,p0)p.r0'
  StrCpy $DirectoryAvailableSpace $0
  SendMessage $DirectoryAvailableSpace ${WM_SETFONT} $WelcomeBodyFont 0
  SetCtlColors $DirectoryAvailableSpace "596676" "F8FAFB"
  ${NSD_CreateLabel} 0 0 0 0 "上一步"
  Pop $DirectoryBackButton
  System::Call 'USER32::SetWindowLongW(p$DirectoryBackButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$DirectoryBackButton,p0,i390,i287,i70,i32,i0x0004)'
  SendMessage $DirectoryBackButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $DirectoryBackButton "354255" "F4F6F8"
  ${NSD_OnClick} $DirectoryBackButton DirectoryBackClick
  ${NSD_CreateLabel} 0 0 0 0 "安装"
  Pop $DirectoryInstallButton
  System::Call 'USER32::SetWindowLongW(p$DirectoryInstallButton,i-16,i0x50000301)'
  System::Call 'USER32::SetWindowPos(p$DirectoryInstallButton,p0,i468,i287,i70,i32,i0x0004)'
  SendMessage $DirectoryInstallButton ${WM_SETFONT} $WelcomeButtonFont 0
  SetCtlColors $DirectoryInstallButton "FFFFFF" "4F46E5"
  ${NSD_OnClick} $DirectoryInstallButton DirectoryInstallClick
  Call UpdateInstallSpaceLabels

  nsDialogs::Show
FunctionEnd

Function InstallDirectoryPageLeave
  ${NSD_GetText} $DirectoryInput $INSTDIR
  Call EnsureMyTodoInstallDirectory
  Call ReleaseApplicationLaunchGuard
  Call AcquireApplicationLaunchGuard
  StrCpy $InstallerPageActive ""
  ${NSD_FreeIcon} $DirectoryIconImage
  StrCpy $DirectoryIconImage ""
FunctionEnd

Function PrepareUpdateWindow
  ${If} $UpdateWindowPrepared == "1"
    Return
  ${EndIf}

  System::Call 'USER32::GetWindowRect(p$HWNDPARENT,@r0)'
  System::Call '*$0(i.r1,i.r2,i.r3,i.r4)'
  IntOp $5 $3 - $1
  IntOp $6 $4 - $2
  IntOp $5 $5 - 520
  IntOp $5 $5 / 2
  IntOp $6 $6 - 230
  IntOp $6 $6 / 2
  IntOp $1 $1 + $5
  IntOp $2 $2 + $6
  System::Call 'USER32::GetSystemMenu(p$HWNDPARENT,i0)p.r9'
  System::Call 'USER32::DeleteMenu(p$9,i0xF060,i0x0000)'
  System::Call 'USER32::SetWindowLongW(p$HWNDPARENT,i-16,i0x90400000)'
  System::Call 'USER32::SetWindowPos(p$HWNDPARENT,p0,i$1,i$2,i520,i230,i0x0024)'
  Call ApplyInstallerWindowEffects
  SetCtlColors $HWNDPARENT "172033" "FFFFFF"
  StrCpy $UpdateWindowPrepared "1"
FunctionEnd

Function HideUpdateInstallerChrome
  Call HideInstallerChrome
FunctionEnd

Function UpdateProgressTick
  ${If} $UpdateProgressBar == ""
    Return
  ${EndIf}

  SendMessage $UpdateProgressBar ${PBM_GETPOS} 0 0 $0
  ${NSD_SetText} $UpdateProgressPercent "$0%"
  ${If} $0 < 12
    ${If} $IsInAppUpdate == "1"
      ${NSD_SetText} $UpdateProgressStatus "准备更新"
    ${Else}
      ${NSD_SetText} $UpdateProgressStatus "准备安装"
    ${EndIf}
  ${ElseIf} $0 < 92
    ${If} $IsInAppUpdate == "1"
      ${NSD_SetText} $UpdateProgressStatus "替换程序文件"
    ${Else}
      ${NSD_SetText} $UpdateProgressStatus "写入程序文件"
    ${EndIf}
  ${Else}
    ${NSD_SetText} $UpdateProgressStatus "完成安装"
  ${EndIf}
FunctionEnd

Function InstallProgressPageShow
  StrCpy $InstallerPageActive "progress"
  ${If} $IsInAppUpdate == "1"
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:MyTodo 更新"
    Call PrepareUpdateWindow
  ${Else}
    Call PrepareInstallerWindow
  ${EndIf}
  Call HideUpdateInstallerChrome

  FindWindow $UpdateProgressPage "#32770" "" $HWNDPARENT
  ${If} $IsInAppUpdate == "1"
    SetCtlColors $UpdateProgressPage "172033" "FFFFFF"
  ${Else}
    SetCtlColors $UpdateProgressPage "172033" "F8FAFB"
  ${EndIf}
  Push $UpdateProgressPage
  Call FillPageToInstallerWindow

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
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000200,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
  StrCpy $UpdateProgressTitle $0
  CreateFont $UpdateTitleFont "Microsoft YaHei UI" "13" "700"
  SendMessage $UpdateProgressTitle ${WM_SETFONT} $UpdateTitleFont 0
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"MyTodo ${VERSION}",i0x50000200,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
  StrCpy $UpdateProgressVersion $0
  CreateFont $UpdateBodyFont "Microsoft YaHei UI" "9" "400"
  SendMessage $UpdateProgressVersion ${WM_SETFONT} $UpdateBodyFont 0
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000200,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
  StrCpy $UpdateProgressStatus $0
  SendMessage $UpdateProgressStatus ${WM_SETFONT} $UpdateBodyFont 0
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"0%",i0x50000202,i0,i0,i0,i0,p$UpdateProgressPage,p0,p0,p0)p.r0'
  StrCpy $UpdateProgressPercent $0
  CreateFont $UpdatePercentFont "Microsoft YaHei UI" "9" "700"
  SendMessage $UpdateProgressPercent ${WM_SETFONT} $UpdatePercentFont 0

  ${If} $IsInAppUpdate == "1"
    SendMessage $UpdateProgressTitle ${WM_SETTEXT} 0 "STR:正在安装更新"
    SetCtlColors $UpdateProgressTitle "172033" "FFFFFF"
    SetCtlColors $UpdateProgressVersion "748093" "FFFFFF"
    SetCtlColors $UpdateProgressStatus "748093" "FFFFFF"
    SetCtlColors $UpdateProgressPercent "4F46E5" "FFFFFF"
    System::Call 'USER32::SetWindowPos(p$UpdateProgressIcon,p0,i60,i47,i36,i36,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressTitle,p0,i108,i42,i330,i27,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressVersion,p0,i108,i70,i330,i20,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressBar,p0,i60,i132,i400,i9,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressStatus,p0,i60,i151,i300,i19,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressPercent,p0,i380,i151,i80,i19,i0x0004)'
  ${Else}
    SendMessage $UpdateProgressTitle ${WM_SETTEXT} 0 "STR:正在安装 MyTodo"
    SetCtlColors $UpdateProgressTitle "172033" "F8FAFB"
    SetCtlColors $UpdateProgressVersion "748093" "F8FAFB"
    SetCtlColors $UpdateProgressStatus "748093" "F8FAFB"
    SetCtlColors $UpdateProgressPercent "4F46E5" "F8FAFB"
    System::Call 'USER32::SetWindowPos(p$UpdateProgressIcon,p0,i74,i112,i38,i38,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressTitle,p0,i126,i106,i360,i28,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressVersion,p0,i126,i135,i360,i20,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressBar,p0,i74,i195,i432,i9,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressStatus,p0,i74,i214,i300,i19,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateProgressPercent,p0,i426,i214,i80,i19,i0x0004)'
  ${EndIf}

  ${NSD_CreateTimer} UpdateProgressTick 100
  Call UpdateProgressTick
FunctionEnd

Function InstallProgressPageLeave
  ${NSD_KillTimer} UpdateProgressTick
  ${If} $UpdateProgressIconImage != ""
    ${NSD_FreeIcon} $UpdateProgressIconImage
  ${EndIf}
  StrCpy $UpdateProgressIconImage ""
  StrCpy $UpdateProgressBar ""
  StrCpy $InstallerPageActive ""
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
  Call ReleaseApplicationLaunchGuard
  Call ClearInstallationLock
  ${If} $IsInAppUpdate == "1"
    StrCpy $1 "--updated"
  ${Else}
    StrCpy $1 ""
  ${EndIf}
  ExecShell "open" "$INSTDIR\${APP_FILENAME}.exe" "$1"
FunctionEnd

!macro customInstallMode
  ; MyTodo is a per-user application. Keeping one scope prevents a stale
  ; machine-wide registry entry from reopening the installer after elevation.
  StrCpy $isForceMachineInstall "0"
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  StrCpy $IsInAppUpdate "0"
  StrCpy $IsUpgradeInstall "0"
  StrCpy $InstallerEntryState "fresh"
  StrCpy $InstallerWindowPrepared "0"
  StrCpy $InstallerPageActive ""
  StrCpy $InstallerAllowExit "0"
  StrCpy $InstallationLockActive "0"
  StrCpy $InstallationLockFile ""
  StrCpy $ApplicationLaunchGuardHandle ""
  StrCpy $UpdateWindowPrepared "0"
  ${If} ${isUpdated}
    StrCpy $IsInAppUpdate "1"
  ${EndIf}

  ${If} ${UAC_IsInnerInstance}
    Return
  ${EndIf}

  ${If} $IsInAppUpdate == "1"
    ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $INSTDIR "$0"
    ${EndIf}
    Call CreateInstallationLock
    Return
  ${EndIf}

  ReadRegStr $InstalledVersion HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $InstalledVersion != ""
    ${VersionCompare} "$InstalledVersion" "${VERSION}" $VersionComparison
    ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $INSTDIR "$0"
    ${EndIf}

    ${If} $VersionComparison == "1"
      StrCpy $InstallerEntryState "downgrade"
    ${ElseIf} $VersionComparison == "0"
      StrCpy $InstallerEntryState "same"
    ${Else}
      StrCpy $InstallerEntryState "upgrade"
      StrCpy $IsUpgradeInstall "1"
    ${EndIf}

    ${If} ${Silent}
      ${If} $InstallerEntryState == "same"
      ${OrIf} $InstallerEntryState == "downgrade"
        Quit
      ${EndIf}
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
  StrCpy $InstallerPageActive "finish"
  ${If} $IsInAppUpdate == "1"
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:MyTodo 更新"
    Call PrepareUpdateWindow
  ${Else}
    Call PrepareInstallerWindow
  ${EndIf}
  Call HideUpdateInstallerChrome
  Push $mui.FinishPage
  Call FillPageToInstallerWindow

  ShowWindow $mui.FinishPage.Image 0
  ShowWindow $mui.FinishPage.Title 0
  ShowWindow $mui.FinishPage.Text 0

  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"✓",i0x50000201,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
  StrCpy $UpdateFinishCheck $0
  CreateFont $UpdateCheckFont "Segoe UI Symbol" "24" "700"
  SendMessage $UpdateFinishCheck ${WM_SETFONT} $UpdateCheckFont 0
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000201,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
  StrCpy $UpdateFinishTitle $0
  CreateFont $UpdateTitleFont "Microsoft YaHei UI" "13" "700"
  SendMessage $UpdateFinishTitle ${WM_SETFONT} $UpdateTitleFont 0
  System::Call 'USER32::CreateWindowExW(i0,w"STATIC",w"",i0x50000201,i0,i0,i0,i0,p$mui.FinishPage,p0,p0,p0)p.r0'
  StrCpy $UpdateFinishText $0
  SendMessage $UpdateFinishText ${WM_SETFONT} $UpdateBodyFont 0
  ${NSD_CreateLabel} 0 0 0 0 "完成"
  Pop $UpdateFinishButton
  System::Call 'USER32::SetWindowLongW(p$UpdateFinishButton,i-16,i0x50000301)'
  CreateFont $UpdateButtonFont "Microsoft YaHei UI" "9" "700"
  SendMessage $UpdateFinishButton ${WM_SETFONT} $UpdateButtonFont 0
  SetCtlColors $UpdateFinishButton "FFFFFF" "4F46E5"
  ${NSD_OnClick} $UpdateFinishButton FinishUpdateClick

  ${If} $IsInAppUpdate == "1"
    SetCtlColors $mui.FinishPage "172033" "FFFFFF"
    SetCtlColors $UpdateFinishCheck "1D9A72" "E4F8F1"
    SetCtlColors $UpdateFinishTitle "172033" "FFFFFF"
    SetCtlColors $UpdateFinishText "748093" "FFFFFF"
    SendMessage $UpdateFinishTitle ${WM_SETTEXT} 0 "STR:更新完成"
    SendMessage $UpdateFinishText ${WM_SETTEXT} 0 "STR:点击完成启动 MyTodo"
    SendMessage $mui.FinishPage.Run ${BM_SETCHECK} ${BST_CHECKED} 0
    ShowWindow $mui.FinishPage.Run 0
    ShowWindow $mui.FinishPage.ShowReadme 0
    System::Call 'USER32::SetWindowPos(p$UpdateFinishCheck,p0,i236,i20,i48,i46,i0x0004)'
    System::Call 'GDI32::CreateEllipticRgn(i0,i0,i48,i46)p.r1'
    System::Call 'USER32::SetWindowRgn(p$UpdateFinishCheck,p$1,i1)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishTitle,p0,i40,i72,i440,i28,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishText,p0,i40,i104,i440,i22,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishButton,p0,i404,i172,i78,i32,i0x0004)'
  ${Else}
    SetCtlColors $mui.FinishPage "172033" "F8FAFB"
    SetCtlColors $UpdateFinishCheck "1D9A72" "E4F8F1"
    SetCtlColors $UpdateFinishTitle "172033" "F8FAFB"
    SetCtlColors $UpdateFinishText "748093" "F8FAFB"
    SendMessage $UpdateFinishTitle ${WM_SETTEXT} 0 "STR:安装完成"
    SendMessage $UpdateFinishText ${WM_SETTEXT} 0 "STR:MyTodo ${VERSION} 已准备就绪"
    SendMessage $mui.FinishPage.Run ${WM_SETTEXT} 0 "STR:立即启动 MyTodo"
    SendMessage $mui.FinishPage.ShowReadme ${WM_SETTEXT} 0 "STR:开机自动启动"
    SetCtlColors $mui.FinishPage.Run "465467" "F8FAFB"
    SetCtlColors $mui.FinishPage.ShowReadme "465467" "F8FAFB"
    ShowWindow $mui.FinishPage.Run 1
    ShowWindow $mui.FinishPage.ShowReadme 1
    System::Call 'USER32::SetWindowPos(p$UpdateFinishCheck,p0,i266,i48,i48,i46,i0x0004)'
    System::Call 'GDI32::CreateEllipticRgn(i0,i0,i48,i46)p.r1'
    System::Call 'USER32::SetWindowRgn(p$UpdateFinishCheck,p$1,i1)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishTitle,p0,i60,i102,i460,i28,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishText,p0,i60,i135,i460,i22,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$mui.FinishPage.Run,p0,i202,i181,i220,i24,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$mui.FinishPage.ShowReadme,p0,i202,i213,i220,i24,i0x0004)'
    System::Call 'USER32::SetWindowPos(p$UpdateFinishButton,p0,i251,i287,i78,i32,i0x0004)'
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
