# 技术决策

- Windows 继续使用 Electron，避免在多端阶段同时重写成熟桌面能力。
- 本地数据始终可独立工作；云同步是增量能力，不是启动前提。
- 使用 JSON 原子写入和 `.bak` 保持本地版可检查、可恢复。
- 同步采用稳定 UUID、持久化 outbox、revision 和 cursor。
- 应用内提醒窗替代受限的系统通知交互，但调度仍由主进程负责。
- Windows Release 使用 NSIS 与 electron-updater，安装器和应用退出流程共同维护进程锁。
