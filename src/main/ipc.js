const { app, dialog, ipcMain } = require("electron");
const { getGlobalConfig, setGlobalConfig } = require("./config");
const { getDataLocation, migrateDataDirectory } = require("./dataLocation");
const todoStore = require("./todoStore");
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
  ipcMain.handle("set-global-config", async (evt, cfg) => setGlobalConfig(cfg));
  ipcMain.handle("get-data-location", async () => getDataLocation());
  ipcMain.handle("choose-data-location", chooseAndMigrateDataDirectory);
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
