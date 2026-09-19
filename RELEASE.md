# Windows 发布流程

1. 确认工作区没有混入测试数据、开发地址和密钥。
2. 更新 `package.json`、CHANGELOG 和用户发布说明。
3. 运行 `scripts/check.ps1 release`。
4. 人工验证首次安装、相同版本、升级、降级拦截和运行中安装拦截。
5. 人工验证托盘退出、自动更新、任务栏图标和提醒。
6. Release 上传安装包、`.blockmap` 和 `latest.yml`。
7. 用户明确确认后再提交、打 tag 和发布。

详细行为仍以 README、发布清单和测试报告为准。
