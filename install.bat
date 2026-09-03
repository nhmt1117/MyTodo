@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
cls
echo ======================================
echo        MyTodo Electron 依赖安装脚本
echo ======================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 npm，请先安装 Node.js
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo [1/3] 配置 Electron 国内镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo [2/3] 根据锁文件安装依赖
if exist "package-lock.json" (
    echo [信息] npm 进度条、HTTP 请求耗时和 Electron 下载状态会实时显示。
    call npm ci --no-audit --progress --foreground-scripts --loglevel=http --timing
) else (
    echo [信息] npm 进度条、HTTP 请求耗时和 Electron 下载状态会实时显示。
    call npm install --no-audit --progress --foreground-scripts --loglevel=http --timing
)
if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败！
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo [3/3] 验证 Electron 可执行文件
call npm run check:electron
if errorlevel 1 (
    echo.
    echo [错误] Electron 验证失败！请重新运行 install.bat
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo.
echo [完成] 依赖安装完毕，双击 start.bat 启动项目
if not defined MYTODO_NO_PAUSE pause
