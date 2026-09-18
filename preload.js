const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  winMinimize: () => ipcRenderer.send("win-minimize"),
  winClose: () => ipcRenderer.send("win-close"),
  resolveCloseConfirmation: (action, dontAskAgain) => ipcRenderer.invoke("resolve-close-confirmation", action, dontAskAgain === true),
  cancelCloseConfirmation: () => ipcRenderer.invoke("cancel-close-confirmation"),
  onCloseConfirmationRequested: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("close-confirmation-requested", listener);
    return () => ipcRenderer.removeListener("close-confirmation-requested", listener);
  },
  toggleMainWindowMaximize: () => ipcRenderer.invoke("win-toggle-maximize"),
  onReminderDisplay: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("reminder-display", listener);
    return () => ipcRenderer.removeListener("reminder-display", listener);
  },
  reminderAction: (action, identity) => ipcRenderer.invoke("reminder-action", action, identity),
  onTodoDataChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("todo-data-changed", listener);
    return () => ipcRenderer.removeListener("todo-data-changed", listener);
  },
  onOpenTodoDetail: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, todoId) => callback(todoId);
    ipcRenderer.on("open-todo-detail", listener);
    return () => ipcRenderer.removeListener("open-todo-detail", listener);
  },
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  getReminderServiceStatus: () => ipcRenderer.invoke("get-reminder-service-status"),
  triggerDevelopmentReminder: () => ipcRenderer.invoke("trigger-development-reminder"),
  getStorageStatus: () => ipcRenderer.invoke("get-storage-status"),
  getSyncState: () => ipcRenderer.invoke("get-sync-state"),
  enableSync: (options) => ipcRenderer.invoke("enable-sync", options),
  recoverSyncAccount: (options) => ipcRenderer.invoke("recover-sync-account", options),
  syncNow: () => ipcRenderer.invoke("sync-now"),
  createPairingSession: (options) => ipcRenderer.invoke("create-pairing-session", options),
  getPairingSessionStatus: (sessionId) => ipcRenderer.invoke("get-pairing-session-status", sessionId),
  listSyncDevices: () => ipcRenderer.invoke("list-sync-devices"),
  revokeSyncDevice: (deviceId) => ipcRenderer.invoke("revoke-sync-device", deviceId),
  getSyncConflicts: () => ipcRenderer.invoke("get-sync-conflicts"),
  resolveSyncConflict: (options) => ipcRenderer.invoke("resolve-sync-conflict", options),
  copyText: (value) => clipboard.writeText(String(value || "")),
  onSyncStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sync-status", listener);
    return () => ipcRenderer.removeListener("sync-status", listener);
  },
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
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
  getDataLocation: () => ipcRenderer.invoke("get-data-location"),
  chooseDataLocation: () => ipcRenderer.invoke("choose-data-location"),
  openDataDirectory: () => ipcRenderer.invoke("open-data-directory"),
  exportDataBackup: () => ipcRenderer.invoke("export-data-backup"),
  selectDataBackup: () => ipcRenderer.invoke("select-data-backup"),
  restoreDataBackup: (filePath) => ipcRenderer.invoke("restore-data-backup", filePath),
  openLogDirectory: () => ipcRenderer.invoke("open-log-directory"),
  toggleFloatWin: () => ipcRenderer.invoke("toggle-float-win"),
  moveFloatWin: (deltaX, deltaY) => ipcRenderer.invoke("move-float-win", deltaX, deltaY),
  saveFloatWinPosition: () => ipcRenderer.invoke("save-float-win-position"),
  closeFloatWin: () => ipcRenderer.invoke("close-float-win"),
});
