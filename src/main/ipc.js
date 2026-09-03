const { app, ipcMain } = require("electron");
const { getGlobalConfig, setGlobalConfig } = require("./config");
const todoStore = require("./todoStore");
const windows = require("./windows");

let registered = false;

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
