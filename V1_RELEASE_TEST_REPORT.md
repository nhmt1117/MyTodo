# MyTodo v1 发布测试记录

测试版本：1.0.0

测试日期：2026-09-03

测试平台：Windows 11 x64（10.0.26200）、Node.js 24.16.0、npm 11.13.0、Electron 44.1.1、electron-builder 26.15.3。

状态：发布候选。功能、安装、卸载、快捷方式、删除确认和依赖安全审计已完成；Windows toast 的视觉/点击、任务栏图标、安装版悬浮窗重启和开机自启仍需最后人工确认。

## 自动化检查

- [x] JavaScript 语法检查。
- [x] 循环规则、提醒去重和通知失败重试。
- [x] JSON 原子写入、备份恢复、失败写入保留原文件。
- [x] 正式版元数据、模块引用、测试入口隔离及删除确认入口。
- [x] ICO 包含 16、32、48、64、128、256 像素图层；六个图层均为 32 位 RGBA PNG。
- [x] 图标源稿为深海军蓝勾选卡与黄色便签的透明 PNG。
- [x] 29–31 日跨月、闰年和跨年日历导航不会跳过月份。
- [x] 批处理外部目录调用、带空格路径、npm 失败返回码、CRLF 换行。
- [x] Electron 内置 ZIP 解压大文件及后续文件完整性。

最近一次 `npm run check`：26 项测试通过，0 失败，0 跳过。

依赖审计：配置的 npmmirror 不提供 audit 接口；改用 npm 官方 registry 执行 `npm audit --registry=https://registry.npmjs.org`，升级 Electron、electron-builder 及测试用 archiver 后结果为 `found 0 vulnerabilities`。

## 主窗口流程

- [x] 新增、编辑、归档、恢复、逾期高亮和“不再提醒”。
- [x] 日历展示普通待办以及每日、每周、每月循环实例。
- [x] 安装版删除确认：删除菜单先显示确认弹窗；取消后任务仍在；确认后任务从列表消失。
- [x] 安装版通知调度：隔离任务在 16:19:09 和复测的 16:22:09 收到 Electron `show` 回调，持久化记录分别写入对应的 `once:2026-09-03:HH:mm` 去重键。
- [ ] Windows toast 的视觉展示及点击回到主窗口。当前 Windows 自动化接口未将原生 toast 暴露为可操作窗口，无法据此伪造通过结论。

删除和通知均使用 `.delete-confirm-profile/`，不会读写日常 `%APPDATA%/mytodo/` 数据。通知的 `show` 回调证明 Electron 已向 Windows 通知通道提交展示；最终视觉效果仍可能受 Windows 勿扰、通知权限和系统显示策略影响。

## 单词悬浮窗

- [x] 正常打开并显示书本按钮图标。
- [x] 拖动后位置坐标被写入配置，关闭后再次打开恢复保存坐标。
- [x] unpacked 正式包重启应用后恢复坐标。
- [x] 双击非“下一个”按钮区域关闭；双击按钮区域仅切换单词。
- [ ] 不在 Windows 任务栏产生额外窗口、长时间运行、多显示器和 DPI 变化。按用户安排延期。
- [ ] 安装版重启后的悬浮窗位置复验。

## 安装包

- [x] `npm run build:win` 成功，`npm run verify:release` 验证 22 个打包源码/文档文件。
- [x] 安装程序可启动，提供当前用户安装与目录选择界面。
- [x] 安装完成后可启动 MyTodo；卸载后再次安装成功。
- [x] 桌面和开始菜单快捷方式均能启动 `C:\Users\nhmt\AppData\Local\Programs\MyTodo\MyTodo.exe`，启动时使用了隔离数据目录。
- [x] 安装器及已安装应用使用 MyTodo 多尺寸 ICO；快捷方式引用同一安装目录图标资源。
- [ ] Windows 任务栏图标的最后目视确认。自动化窗口截图不包含任务栏区域。

安装过程使用默认的 per-user 目标 `C:\Users\nhmt\AppData\Local\Programs\MyTodo`。安装器界面、目录浏览、完成页、卸载页和重新安装均已走通；“运行 MyTodo”勾选项在安装验收时取消，避免接触日常数据。

## 干净环境与产物

- [x] 干净目录安装依赖并验证 Electron 可执行文件。
- [x] 从外部工作目录调用 `start.bat`，启动 Electron 后退出，脚本返回成功。
- [x] 提供 `npm run verify:release`，逐字节比对打包源码和发布文档、检查包内额外文件并生成 `dist/SHA256SUMS.txt`。
- [x] 最终 `build.bat` 通过：26 项测试、NSIS 构建、22 个打包文件比对和 SHA-256 生成均成功。最终分发哈希以 `dist/SHA256SUMS.txt` 为准。

## 已知发布说明

- 安装包未进行商业代码签名，Windows SmartScreen 可能显示未知发布者提示。
- 应用退出后无法调度通知；再次启动会补发尚未发送的到期普通待办。
- 循环任务只补发当天尚未发送的实例，不追溯停机期间的其他日期。
- Windows toast 的展示受系统通知设置、勿扰状态和安装身份影响；应用以 Electron `show` 回调作为“已展示”的去重条件。
- GitHub 远端 `https://github.com/nhmt1117/MyTodo.git` 当前未返回引用；尚未初始化工作区 Git、创建标签或上传任何文件。
