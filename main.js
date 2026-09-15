const { app, dialog } = require("electron");
const { applyAutoStartSetting, loadGlobalConfig, setGlobalConfig } = require("./src/main/config");
const { initializeDataDirectory } = require("./src/main/dataLocation");
const { consumeInstallerOptions } = require("./src/main/installOptions");
const { registerIpcHandlers } = require("./src/main/ipc");
const { initializeLogger } = require("./src/main/logger");
const {
  startReminderScheduler,
  stopReminderScheduler,
} = require("./src/main/reminderScheduler");
const { loadTodoFile } = require("./src/main/todoStore");
const { startUpdateManager, stopUpdateManager } = require("./src/main/updateManager");
const { showStartupStorageNotice } = require("./src/main/supportTools");
const {
  createMainWindow,
  createTray,
  notifyUpdateStatus,
  prepareForApplicationQuit,
  prepareReminderWindow,
  showMainWindow,
  showReminder,
} = require("./src/main/windows");

app.setAppUserModelId("com.nhmt.mytodo");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    initializeLogger();
    initializeDataDirectory();
    let config = loadGlobalConfig();
    const installerOptions = consumeInstallerOptions();
    if (installerOptions) config = setGlobalConfig(installerOptions);
    else applyAutoStartSetting();
    loadTodoFile();
    registerIpcHandlers();
    createMainWindow({ showOnReady: !process.argv.includes("--hidden") });
    createTray();
    startUpdateManager({
      autoCheckEnabled: config.autoCheckUpdates,
      notifyStatus: notifyUpdateStatus,
    });
    await showStartupStorageNotice();
    await prepareReminderWindow();
    startReminderScheduler({ showReminder });
  }).catch((error) => {
    console.error("MyTodo 启动失败", error);
    dialog.showErrorBox("MyTodo 启动失败", String(error && error.message ? error.message : error));
    app.quit();
  });

  app.on("before-quit", () => {
    stopReminderScheduler();
    stopUpdateManager();
    prepareForApplicationQuit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
