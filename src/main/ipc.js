const { app, dialog, ipcMain } = require("electron");
const { getGlobalConfig, setGlobalConfig } = require("./config");
const { getDataLocation, migrateDataDirectory } = require("./dataLocation");
const { getReminderServiceStatus } = require("./reminderScheduler");
const { formatLocalDate } = require("../shared/recurrence");
const supportTools = require("./supportTools");
const todoStore = require("./todoStore");
const updateManager = require("./updateManager");
const windows = require("./windows");

let registered = false;
async function chooseAndMigrateDataDirectory() {
  const currentLocation = getDataLocation();
  const selection = await dialog.showOpenDialog({
    title: "选择 MyTodo 数据存储位置",
    defaultPath: currentLocation.directory,
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) {
    return { cancelled: true, ...currentLocation };
  }

  const targetDirectory = selection.filePaths[0];
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    buttons: ["取消", "迁移并切换"],
    defaultId: 0,
    cancelId: 0,
    message: "迁移 MyTodo 数据？",
    detail: `任务、窗口设置和备份文件将从：\n${currentLocation.directory}\n\n迁移到：\n${targetDirectory}`,
    noLink: true,
  });
  if (confirmation.response !== 1) {
    return { cancelled: true, ...currentLocation };
  }

  // Persist the current in-memory state before copying its files to the new directory.
  setGlobalConfig({}, { applyAutoStart: false });
  todoStore.saveTodoFile();
  return { cancelled: false, ...migrateDataDirectory(targetDirectory) };
}

function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.on("win-minimize", windows.minimizeMainWindow);
  ipcMain.on("win-close", windows.hideMainWindow);
  ipcMain.handle("win-toggle-maximize", () => windows.toggleMainWindowMaximize());
  ipcMain.handle("reminder-action", (event, action, identity) => {
    const snoozeMinutes = Math.round(Number(identity?.minutes));
    return windows.handleReminderAction(event.sender, action, identity, {
      snooze: (reminder) => {
        if (reminder.developmentTest) return true;
        return reminder.kind === "task" &&
          !!todoStore.snoozeTodoReminder(reminder.id, reminder.key, snoozeMinutes);
      },
      complete: (reminder) => {
        if (reminder.developmentTest) return true;
        if (reminder.kind !== "task") return false;
        const updated = todoStore.setArchived(reminder.id, true);
        if (updated) windows.notifyTodoDataChanged();
        return !!updated;
      },
    });
  });

  ipcMain.handle("get-app-info", async () => ({
    isPackaged: app.isPackaged,
    version: app.getVersion(),
  }));
  ipcMain.handle("get-todo-list", async () => todoStore.getTodoList());
  ipcMain.handle("add-todo-item", async (evt, payload) => todoStore.addTodoItem(payload));
  ipcMain.handle("update-todo", async (evt, payload) => todoStore.updateTodo(payload));
  ipcMain.handle("archive-todo", async (evt, id) => todoStore.setArchived(id, true));
  ipcMain.handle("unarchive-todo", async (evt, id) => todoStore.setArchived(id, false));
  ipcMain.handle("mute-todo-remind", async (evt, id) => todoStore.muteTodoRemind(id));
  ipcMain.handle("add-to-today", async (evt, id) => todoStore.addToToday(id));
  ipcMain.handle("delete-todo", async (evt, id) => todoStore.deleteTodo(id));

  ipcMain.handle("get-float-config", async () => ({
    config: getGlobalConfig(),
  }));
  ipcMain.handle("set-global-config", async (evt, cfg) => {
    const config = setGlobalConfig(cfg);
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, "autoCheckUpdates")) {
      updateManager.setAutoCheckEnabled(config.autoCheckUpdates);
    }
    return config;
  });
  ipcMain.handle("get-update-state", async () => updateManager.getUpdateState());
  ipcMain.handle("get-reminder-service-status", async () => getReminderServiceStatus());
  ipcMain.handle("trigger-development-reminder", async () => {
    if (app.isPackaged) return false;
    const now = new Date();
    const dueTime = String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");
    return windows.showReminder({
      id: -1,
      key: `development:${now.toISOString()}`,
      kind: "task",
      body: "开发版测试提醒",
      description: "用于检查提醒窗口、提示音、倒计时和按钮交互",
      dueDate: formatLocalDate(now),
      dueTime,
      reason: "开发测试",
      priority: "mid",
      developmentTest: true,
    });
  });
  ipcMain.handle("get-storage-status", async () => supportTools.getStorageStatus());
  ipcMain.handle("check-for-updates", async () => updateManager.checkForUpdates({ manual: true }));
  ipcMain.handle("download-update", async () => updateManager.downloadUpdate());
  ipcMain.handle("install-update", async () => updateManager.installUpdate());
  ipcMain.handle("get-data-location", async () => getDataLocation());
  ipcMain.handle("choose-data-location", chooseAndMigrateDataDirectory);
  ipcMain.handle("open-data-directory", supportTools.openDataDirectory);
  ipcMain.handle("export-data-backup", supportTools.exportDataBackup);
  ipcMain.handle("open-log-directory", supportTools.openLogDirectory);
  ipcMain.handle("toggle-float-win", async () => windows.toggleFloatWindow());
  ipcMain.handle("move-float-win", async (evt, deltaX, deltaY) => {
    return windows.moveFloatWindow(deltaX, deltaY);
  });
  ipcMain.handle("save-float-win-position", async () => windows.saveFloatWindowBounds());
  ipcMain.handle("close-float-win", async () => windows.closeFloatWindow());
}

module.exports = {
  registerIpcHandlers,
};
