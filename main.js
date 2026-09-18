const { app, dialog, powerMonitor } = require("electron");
const { applyAutoStartSetting, loadGlobalConfig, setGlobalConfig } = require("./src/main/config");
const { initializeDataDirectory } = require("./src/main/dataLocation");
const { consumeInstallerOptions } = require("./src/main/installOptions");
const { isInstallationInProgress } = require("./src/main/installLock");
const { registerIpcHandlers } = require("./src/main/ipc");
const { initializeLogger } = require("./src/main/logger");
const {
  refreshReminderSchedule,
  startReminderScheduler,
  stopReminderScheduler,
} = require("./src/main/reminderScheduler");
const todoStore = require("./src/main/todoStore");
const { loadSyncAccount } = require("./src/main/syncAccount");
const syncManager = require("./src/main/syncManager");
const { loadSyncOutbox } = require("./src/main/syncOutbox");
const { startUpdateManager, stopUpdateManager } = require("./src/main/updateManager");
const { showStartupStorageNotice } = require("./src/main/supportTools");
const {
  createMainWindow,
  createTray,
  notifySyncStatus,
  notifyTodoDataChanged,
  notifyUpdateStatus,
  prepareForApplicationQuit,
  prepareReminderWindow,
  showMainWindow,
  showReminder,
} = require("./src/main/windows");

app.setAppUserModelId("com.nhmt.mytodo");

let powerRefreshTimer = null;
const powerHandlers = new Map();

function registerPowerMonitorHandlers() {
  if (!powerMonitor || typeof powerMonitor.on !== "function") return;
  for (const eventName of ["resume", "unlock-screen"]) {
    const handler = () => {
      if (powerRefreshTimer) clearTimeout(powerRefreshTimer);
      powerRefreshTimer = setTimeout(() => {
        powerRefreshTimer = null;
        refreshReminderSchedule(new Date(), eventName);
      }, 750);
      powerRefreshTimer.unref?.();
    };
    powerHandlers.set(eventName, handler);
    powerMonitor.on(eventName, handler);
  }
}

function unregisterPowerMonitorHandlers() {
  if (powerRefreshTimer) clearTimeout(powerRefreshTimer);
  powerRefreshTimer = null;
  if (powerMonitor && typeof powerMonitor.removeListener === "function") {
    for (const [eventName, handler] of powerHandlers) {
      powerMonitor.removeListener(eventName, handler);
    }
  }
  powerHandlers.clear();
}

const installationInProgress = isInstallationInProgress();
const hasSingleInstanceLock = !installationInProgress && app.requestSingleInstanceLock();

if (installationInProgress) {
  // Leave immediately so a launch attempt cannot hold program files open or
  // make the silent installer mistake the warning window for a running app.
  app.quit();
} else if (!hasSingleInstanceLock) {
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
    todoStore.loadTodoFile();
    loadSyncOutbox();
    loadSyncAccount();
    todoStore.setTodoMutationListener(syncManager.captureTodoMutation);
    registerIpcHandlers();
    createMainWindow({ showOnReady: !process.argv.includes("--hidden") });
    createTray();
    startUpdateManager({
      autoCheckEnabled: config.autoCheckUpdates,
      notifyStatus: notifyUpdateStatus,
    });
    syncManager.startSyncManager({
      notifyStatus: notifySyncStatus,
      notifyTodoDataChanged,
    });
    await showStartupStorageNotice();
    await prepareReminderWindow();
    startReminderScheduler({ showReminder });
    registerPowerMonitorHandlers();
  }).catch((error) => {
    console.error("MyTodo 启动失败", error);
    dialog.showErrorBox("MyTodo 启动失败", String(error && error.message ? error.message : error));
    app.quit();
  });

  app.on("before-quit", () => {
    unregisterPowerMonitorHandlers();
    stopReminderScheduler();
    syncManager.stopSyncManager();
    stopUpdateManager();
    prepareForApplicationQuit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
