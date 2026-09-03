# MyTodo

MyTodo 是一个基于 Electron 的个人待办与循环提醒工具，提供待办列表、系统通知、日历视图、任务归档、开机自启设置，以及一个可拖动并自动记忆位置的单词悬浮窗。

当前版本为 **v1.0.0 发布候选**。核心功能、Windows 安装/卸载、快捷方式和依赖安全审计已验收；Windows toast 的视觉点击、任务栏图标、安装版悬浮窗重启和开机自启仍待人工确认，详见 [发布清单](V1_RELEASE_CHECKLIST.md)。本轮只验证 Windows x64，macOS/Linux 的打包脚本不代表已测试支持。

## 使用

Windows 用户运行发布包 `MyTodo Setup 1.0.0.exe` 安装，无需安装 Node.js。关闭主窗口会隐藏到托盘；完全退出请使用托盘菜单中的“退出程序”。

左下角书本按钮切换单词悬浮窗。拖动后自动保存位置；双击非“下一个”按钮区域隐藏悬浮窗，双击按钮只切换单词。

## 功能

- 新增、编辑、删除普通待办
- 按截止日期或优先级排序
- 按日期和时间发送一次性系统通知
- 每日、每周、每月循环任务及系统通知
- 循环任务在日历中按规则展示每次实例
- 逾期任务高亮，并支持“不再提醒”
- 任务归档与恢复
- 日历视图查看每日任务
- 每周起始日设置
- 开机自动启动
- 单词悬浮窗，支持拖动位置持久化和双击关闭

## 开发环境

本次构建测试环境为 Node.js 24.16.0、npm 11.13.0、Electron 44.1.1、electron-builder 26.15.3、Windows x64。请保留仓库中的 `package-lock.json`，以使用经过验证的依赖组合。

安装依赖：

```bat
install.bat
```

安装脚本会显示 npm 的交互式进度条、HTTP 请求耗时和 Electron 下载/验证状态。依赖下载是并行的，npm 不提供可信的总下载速度；只要进度条、`npm http fetch` 或 Electron 下载输出持续变化，安装就在继续。连续 5 分钟没有任何新输出时，再检查网络或镜像连接，避免在正常解压阶段过早关闭终端。
启动开发版：

```bat
start.bat
```

也可以直接运行：

```bash
npm ci --no-audit
npm start
```

## 打包

打包 Windows 安装包：

```bat
build.bat
```

或运行：

```bash
npm run build:win
```

`build.bat` 会先执行检查，再生成安装包、校验 ASAR 中的源码和元数据，最后生成 `dist/SHA256SUMS.txt`。直接使用 npm 时运行：

```bash
npm run check
npm run build:win
npm run verify:release
```

打包产物输出到 `dist/`。对外分发安装程序，不要分发整个工作目录或测试数据。

### 构建排错

- 项目在 `postinstall` 中检查 Electron 可执行文件，并以自动化测试覆盖 Electron 内置 ZIP 解压大文件。不要只凭 npm 的成功提示判断安装完整。
- 如安装失败，修复网络/权限问题后重新运行 `install.bat`；不要关闭 TLS 证书校验。脚本采用 Electron 国内镜像，npm 包下载地址由锁文件固定。
- 如 electron-builder 的 Windows 工具下载或解压失败，请在允许创建符号链接的构建环境重新执行；不要通过禁用 `signAndEditExecutable` 绕过问题，否则图标和版本信息可能无法写入。
- `.build-cache/`、`.release-smoke/` 和 `.v1-test-profile/` 都是本地验证产物，不参与打包。

## 项目结构

```text
.
├── main.js                 # Electron 应用启动入口
├── preload.js              # Renderer 与主进程之间的安全 API 桥
├── index.html              # 主窗口 HTML
├── float.html              # 单词悬浮窗 HTML
├── renderer/
│   ├── styles.css          # 主窗口样式
│   ├── renderer.js         # 主窗口交互逻辑
│   ├── float.css           # 单词悬浮窗样式
│   └── float.js            # 单词悬浮窗交互逻辑
├── assets/
│   └── mytodo-icon-source.png # 图标源稿（不随安装包分发）
├── src/main/
│   ├── config.js           # 全局配置读写、开机自启、窗口尺寸/位置
│   ├── storage.js          # JSON 原子写入、备份与恢复
│   ├── todoStore.js        # 待办数据读写和任务操作
│   ├── reminderScheduler.js # 系统通知调度
│   ├── windows.js          # 主窗口、托盘、悬浮窗
│   └── ipc.js              # IPC 接口注册
├── src/shared/
│   └── recurrence.js       # 主进程和界面共用的循环规则
├── test/                   # Node.js 自动化测试
├── scripts/                # Electron 安装检查、发布产物校验
├── wordlist.json           # 单词悬浮窗词库
└── MyTodo.ico              # 应用图标
```

`MyTodo.ico` 是由 `assets/mytodo-icon-source.png` 生成的 Windows 多尺寸图标，包含 16、32、48、64、128、256 像素的 32 位透明图层。修改图标时请重新生成全部图层，不能只替换 256 像素版本。

## 数据位置

应用数据默认保存在 Electron 的 `userData` 目录中。Windows 默认路径在 C 盘的 `%APPDATA%\MyTodo`，通常是 `C:\Users\<用户名>\AppData\Roaming\MyTodo`。

- `todo-store.json`：待办任务数据
- `win-config.json`：窗口尺寸、悬浮窗位置、应用设置
- `todo-store.json.bak`、`win-config.json.bak`：上一次有效数据的自动备份

可在应用的“设置”页查看当前数据位置并更改目录。确认切换后，应用会迁移以上任务、设置和备份文件；目标目录若已有 MyTodo 数据，应用会拒绝覆盖，防止两套数据混合。Electron 的缓存不属于应用数据，仍由系统管理。
升级前，先通过托盘完全退出应用，再另外备份整个数据目录；`.bak` 只保留上一次有效写入，不代替长期备份。手动恢复时也要先退出应用，再替换数据文件。启动旧数据时会补充创建时间、提醒时间和提醒去重字段。

开发测试请使用独立目录，避免迁移或通知调度改变日常数据：

```bash
npm start -- --user-data-dir=D:/MyTodo-test-profile
```

## 提醒与循环规则

- 普通待办在截止日期的设定时间提醒一次。应用未运行时不会驻留调度；下次启动后会补发尚未发送的到期提醒。
- 每日循环从开始日期起每天发生；每周循环以开始日期的星期为准；每月循环以开始日期的日号为准。
- 月度循环遇到没有对应日号的月份会跳过，例如每月 31 日不会在 2 月触发。
- 同一个循环实例只提醒一次；修改日期、时间或循环规则后会重新计算提醒。
- 循环任务只检查当天的实例，不补发停机期间其他日期的历史循环提醒。
- 调度检查间隔约 30 秒；实际通知展示受 Windows 通知设置、勿扰状态和安装身份影响。应用目前不提供退出后唤醒或后台系统服务。

## 质量检查

语法检查及自动化测试：

```bash
npm run check
```

单独运行测试：

```bash
npm test
```

## 发布说明

- Windows 安装包由 `npm run build:win` 生成到 `dist/`。
- 当前安装包未购买代码签名证书，首次运行时 Windows SmartScreen 可能显示未知发布者提示。
- 发布前测试过程和结果记录在 [测试记录](V1_RELEASE_TEST_REPORT.md)，版本变更见 [CHANGELOG](CHANGELOG.md)。
- 已使用 npm 官方 registry 完成一次依赖审计，结果为 0 vulnerabilities。后续依赖升级后仍应重新运行 `npm audit --registry=https://registry.npmjs.org`；该操作会向 npm 审计服务提交依赖名称和版本。

## License

[MIT](LICENSE)
