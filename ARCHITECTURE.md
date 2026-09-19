# 架构说明

Electron 主进程负责窗口、托盘、存储、提醒、安装更新和同步；渲染进程通过 preload 暴露的受控 IPC 调用能力，不能直接访问 Node.js。

主要边界：

- `src/main/todoStore.js`：任务规范化和持久化入口。
- `src/main/storage.js`：原子 JSON、备份和损坏恢复。
- `src/main/reminderScheduler.js`：提醒扫描、临近队列和摘要。
- `src/main/syncOutbox.js`：离线 mutation 队列。
- `src/main/syncManager.js`：服务端 push、pull 和退避重试。
- `src/main/syncAccount.js`：Windows 安全存储保护的同步凭据。
- `src/main/updateManager.js`：安装版检查与下载更新。
- `src/main/windows.js`：主窗、提醒窗、托盘和退出生命周期。

本地任务与提醒不能依赖网络成功。跨端字段与规则以 MyTodo-Contracts 为准。
