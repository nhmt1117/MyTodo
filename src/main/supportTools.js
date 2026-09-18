const { app, dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const {
  createDataBackup,
  getDataBackupSummary,
  readDataBackup,
} = require("./backup");
const {
  getConfigStatus,
  getGlobalConfig,
  replaceGlobalConfig,
} = require("./config");
const {
  getDataLocation,
  getDataLocationStatus,
} = require("./dataLocation");
const { getLogDirectory } = require("./logger");
const todoStore = require("./todoStore");
const { getSyncAccountStatus } = require("./syncAccount");
const { getSyncOutboxStatus } = require("./syncOutbox");

function getStorageStatus() {
  const components = {
    location: getDataLocationStatus(),
    config: getConfigStatus(),
    todos: todoStore.getTodoStorageStatus(),
    syncAccount: getSyncAccountStatus(),
    syncOutbox: getSyncOutboxStatus(),
  };
  const values = Object.values(components);
  const state = values.some((entry) => entry.state === "error")
    ? "error"
    : values.some((entry) => entry.state === "recovered")
      ? "recovered"
      : "ok";
  return {
    state,
    readOnly: !!components.todos.readOnly,
    components,
  };
}

async function openDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const errorMessage = await shell.openPath(directory);
  if (errorMessage) throw new Error(errorMessage);
  return true;
}

function getBackupFileName(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `MyTodo-Backup-${stamp}.json`;
}

function getPreRestoreBackupFileName(now = new Date()) {
  return getBackupFileName(now).replace("MyTodo-Backup-", "MyTodo-Before-Restore-");
}

async function exportDataBackup() {
  const location = getDataLocation();
  const selection = await dialog.showSaveDialog({
    title: "导出 MyTodo 数据备份",
    defaultPath: path.join(app.getPath("documents"), getBackupFileName()),
    filters: [{ name: "MyTodo 数据备份", extensions: ["json"] }],
  });
  if (selection.canceled || !selection.filePath) return { cancelled: true };

  const result = createDataBackup({
    destinationPath: selection.filePath,
    dataDirectory: location.directory,
    appVersion: app.getVersion(),
    todos: todoStore.getTodoList(),
    config: getGlobalConfig(),
  });
  return { cancelled: false, ...result };
}

async function selectDataBackup() {
  const selection = await dialog.showOpenDialog({
    title: "选择 MyTodo 数据备份",
    defaultPath: app.getPath("documents"),
    properties: ["openFile"],
    filters: [{ name: "MyTodo 数据备份", extensions: ["json"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };

  const backup = readDataBackup(selection.filePaths[0]);
  return {
    cancelled: false,
    filePath: backup.filePath,
    ...getDataBackupSummary(backup.payload),
  };
}

function restoreDataBackup(filePath) {
  const backup = readDataBackup(filePath);
  const location = getDataLocation();
  const previousConfig = getGlobalConfig();
  const safetyBackupPath = path.join(
    location.directory,
    "Backups",
    getPreRestoreBackupFileName(),
  );

  createDataBackup({
    destinationPath: safetyBackupPath,
    dataDirectory: location.directory,
    appVersion: app.getVersion(),
    todos: todoStore.getTodoList(),
    config: previousConfig,
  });

  try {
    const config = replaceGlobalConfig(backup.payload.data.config);
    const todos = todoStore.restoreTodoList(backup.payload.data.todoStore.list);
    return {
      cancelled: false,
      config,
      safetyBackupPath,
      todoCount: todos.length,
    };
  } catch (error) {
    try {
      replaceGlobalConfig(previousConfig);
    } catch (rollbackError) {
      console.error("恢复失败后回滚应用设置失败", rollbackError);
    }
    throw error;
  }
}

async function showStartupStorageNotice() {
  const status = getStorageStatus();
  const issues = Object.values(status.components).filter((entry) => entry.state !== "ok");
  if (!issues.length) return status;

  const response = await dialog.showMessageBox({
    type: status.state === "error" ? "error" : "warning",
    buttons: ["知道了", "打开数据目录"],
    defaultId: 0,
    cancelId: 0,
    message: status.readOnly ? "MyTodo 已保护异常任务数据" : "MyTodo 检测到数据恢复情况",
    detail: issues.map((entry) => `• ${entry.message}`).join("\n"),
    noLink: true,
  });
  if (response.response === 1) await openDirectory(getDataLocation().directory);
  return status;
}

module.exports = {
  exportDataBackup,
  getBackupFileName,
  getPreRestoreBackupFileName,
  getStorageStatus,
  openDataDirectory: () => openDirectory(getDataLocation().directory),
  openLogDirectory: () => openDirectory(getLogDirectory()),
  restoreDataBackup,
  selectDataBackup,
  showStartupStorageNotice,
};
