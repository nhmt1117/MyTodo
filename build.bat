@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
cls
echo ======================================
echo      MyTodo Electron Windows打包脚本
echo      输出目录：./dist
echo ======================================
echo.

:: 国内镜像加速
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

:: 使用本机已准备的 Windows 构建缓存，不覆盖调用者指定的缓存目录
if not defined ELECTRON_BUILDER_CACHE (
    if exist "%~dp0.build-cache\winCodeSign\winCodeSign-2.6.0\rcedit-x64.exe" (
        set "ELECTRON_BUILDER_CACHE=%~dp0.build-cache"
    )
)

:: 检查npm是否存在
where npm >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js / npm，请先安装Node环境
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

:: 检查依赖是否安装
if not exist "node_modules\" (
    echo [警告] 未找到 node_modules，请先运行 install.bat 安装依赖！
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo 开始执行打包命令：npm run build:win
echo.
call npm run check
if errorlevel 1 (
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)
call npm run build:win

if errorlevel 1 (
    echo.
    echo [错误] 打包失败，请查看上方报错日志
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

call npm run verify:release
if errorlevel 1 (
    echo [错误] 发布产物校验失败！
    if not defined MYTODO_NO_PAUSE pause
    exit /b 1
)

echo.
echo [完成] 打包及校验成功！安装包和 SHA256SUMS.txt 位于 dist 文件夹
if not defined MYTODO_NO_PAUSE pause
exit /b 0
