# 测试说明

```powershell
.\scripts\check.ps1 quick
.\scripts\check.ps1 full
.\scripts\check.ps1 release
```

- quick：语法检查和自动测试。
- full：quick 加 Windows 安装包构建。
- release：full 加成品完整性校验。

提醒、退出、安装升级、任务栏图标和窗口行为必须在真实 Windows 安装版人工验证。普通文字和样式调整只运行 quick。
