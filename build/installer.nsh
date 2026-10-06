; TokenPulse installer additions (electron-builder includes build/installer.nsh).
; A page after the folder choice asks whether to put a shortcut on the desktop.
; electron-builder creates the desktop shortcut as usual; when the box is
; cleared it is taken away again at the end of the install. Updates (silent,
; --updated) skip the page and leave the existing shortcuts alone.

!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  Var tpDesktopBox
  Var tpDesktop

  !macro customInit
    StrCpy $tpDesktop ${BST_CHECKED}
  !macroend

  ; the functions live in the page macro, so they compile where the page goes (after StdUtils, which isUpdated needs)
  !macro customPageAfterChangeDir
    Page custom tpShortcutPage tpShortcutLeave

  Function tpShortcutPage
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "快捷方式" "选择要创建哪些快捷方式"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 10u 100% 12u "创建桌面快捷方式"
    Pop $tpDesktopBox
    ${NSD_SetState} $tpDesktopBox $tpDesktop
    ${NSD_CreateLabel} 0 30u 100% 24u "开始菜单里总会有 TokenPulse。不创建桌面快捷方式的话，也可以以后从开始菜单拖到桌面。"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function tpShortcutLeave
    ${NSD_GetState} $tpDesktopBox $tpDesktop
  FunctionEnd
  !macroend

  !macro customInstall
    ${ifNot} ${isUpdated}
    ${andIf} $tpDesktop != ${BST_CHECKED}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endIf}
  !macroend
!endif
