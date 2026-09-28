# 架构说明

会员额度由 `src/shared/membershipLimits.js` 解析，`syncAccount` 缓存服务端权益，`syncManager` 在同步前刷新，`todoStore` 通过提供函数读取，避免本地操作依赖网络。

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

游标过期时，主进程先将云端快照与本地任务合并，保留待上传或冲突任务，并在任务文件落盘后推进游标；快照失败不会清空离线队列。
