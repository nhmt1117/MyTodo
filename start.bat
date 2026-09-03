@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
cls
echo ======================================
echo        MyTodo Electron 开发启动脚本
echo ======================================
echo.

:: 国内镜像加速
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

where npm >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 npm，请先安装 Node.js
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [提示] 未发现依赖包，开始执行 npm install
    call install.bat
    if errorlevel 1 (
        echo [错误] 依赖安装失败！
        if not defined MYTODO_NO_PAUSE pause
        exit /b 1
    )
    echo.
    echo [完成] 依赖安装完毕
    echo.
)

echo 正在启动 Electron ...
echo.
call npm start -- %*
if errorlevel 1 (
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo.
echo 程序已退出
if not defined MYTODO_NO_PAUSE pause
