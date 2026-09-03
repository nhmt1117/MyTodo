const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  winMinimize: () => ipcRenderer.send("win-minimize"),
  winClose: () => ipcRenderer.send("win-close"),
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  getTodoList: () => ipcRenderer.invoke("get-todo-list"),
  addTodoItem: (payload) => ipcRenderer.invoke("add-todo-item", payload),
  updateTodo: (payload) => ipcRenderer.invoke("update-todo", payload),
  archiveTodo: (id) => ipcRenderer.invoke("archive-todo", id),
  unarchiveTodo: (id) => ipcRenderer.invoke("unarchive-todo", id),
  muteTodoRemind: (id) => ipcRenderer.invoke("mute-todo-remind", id),
  addToToday: (id) => ipcRenderer.invoke("add-to-today", id),
  deleteTodo: (id) => ipcRenderer.invoke("delete-todo", id),
  getFloatConfig: () => ipcRenderer.invoke("get-float-config"),
  setGlobalConfig: (config) => ipcRenderer.invoke("set-global-config", config),
  toggleFloatWin: () => ipcRenderer.invoke("toggle-float-win"),
  moveFloatWin: (deltaX, deltaY) => ipcRenderer.invoke("move-float-win", deltaX, deltaY),
  saveFloatWinPosition: () => ipcRenderer.invoke("save-float-win-position"),
  closeFloatWin: () => ipcRenderer.invoke("close-float-win"),
});
