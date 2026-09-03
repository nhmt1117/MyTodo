const { app } = require("electron");
const { applyAutoStartSetting, loadGlobalConfig } = require("./src/main/config");
const { initializeDataDirectory } = require("./src/main/dataLocation");
const { registerIpcHandlers } = require("./src/main/ipc");
const {
  startReminderScheduler,
  stopReminderScheduler,
} = require("./src/main/reminderScheduler");
const { loadTodoFile } = require("./src/main/todoStore");
const {
  createMainWindow,
  createTray,
  markQuitting,
  showMainWindow,
} = require("./src/main/windows");

app.setAppUserModelId("com.nhmt.mytodo");

app.whenReady().then(() => {
  initializeDataDirectory();
  loadGlobalConfig();
  loadTodoFile();
  applyAutoStartSetting();
  registerIpcHandlers();
  createMainWindow();
  createTray();
  startReminderScheduler({ showMainWindow });
});

app.on("before-quit", () => {
  stopReminderScheduler();
  markQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
