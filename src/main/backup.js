const fs = require("fs");
const path = require("path");

const BACKUP_FORMAT = "mytodo-data-backup";
const BACKUP_FORMAT_VERSION = 1;
const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;
const DATA_FILE_NAMES = [
  "todo-store.json",
  "todo-store.json.bak",
  "win-config.json",
  "win-config.json.bak",
  "sync-outbox.json",
  "sync-outbox.json.bak",
];

function readExistingFiles(directory) {
  const files = {};
  for (const fileName of DATA_FILE_NAMES) {
    const filePath = path.join(directory, fileName);
    try {
      if (fs.statSync(filePath).isFile()) files[fileName] = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

function getNextId(todos) {
  return todos.reduce((maximum, item) => {
    const id = Number(item && item.id);
    return Number.isFinite(id) ? Math.max(maximum, id + 1) : maximum;
  }, 1);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseDataBackup(content) {
  let payload;
  try {
    payload = JSON.parse(String(content || ""));
  } catch (error) {
    throw new Error("备份文件不是有效的 JSON 文件");
  }

  if (!isRecord(payload) || payload.format !== BACKUP_FORMAT) {
    throw new Error("所选文件不是 MyTodo 数据备份");
  }
  if (Number(payload.formatVersion) !== BACKUP_FORMAT_VERSION) {
    throw new Error("该备份版本暂不受当前 MyTodo 支持");
  }
  if (!isRecord(payload.data) || !isRecord(payload.data.todoStore) ||
      !Array.isArray(payload.data.todoStore.list) || !isRecord(payload.data.config)) {
    throw new Error("备份文件缺少任务或设置数据");
  }
  if (payload.data.todoStore.list.some((item) => !isRecord(item) || !String(item.text || "").trim())) {
    throw new Error("备份文件中包含无效任务");
  }
  return payload;
}

function readDataBackup(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!resolvedPath) throw new Error("备份文件路径无效");
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (error) {
    throw new Error("无法读取所选备份文件");
  }
  if (!stat.isFile()) throw new Error("所选路径不是备份文件");
  if (stat.size > MAX_BACKUP_FILE_BYTES) throw new Error("备份文件过大，无法安全恢复");
  return {
    filePath: resolvedPath,
    payload: parseDataBackup(fs.readFileSync(resolvedPath, "utf8")),
  };
}

function getDataBackupSummary(payload) {
  const exportedAt = new Date(payload.exportedAt);
  return {
    appVersion: String(payload.appVersion || ""),
    exportedAt: Number.isNaN(exportedAt.getTime()) ? "" : exportedAt.toISOString(),
    todoCount: payload.data.todoStore.list.length,
  };
}

function createDataBackup(options = {}) {
  if (!options.destinationPath || !options.dataDirectory) {
    throw new Error("备份路径或数据目录无效");
  }
  const destinationPath = path.resolve(String(options.destinationPath));
  const dataDirectory = path.resolve(String(options.dataDirectory));
  const todos = Array.isArray(options.todos) ? options.todos : [];
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: String(options.appVersion || ""),
    exportedAt: new Date().toISOString(),
    data: {
      todoStore: {
        schemaVersion: 3,
        list: todos,
        maxId: getNextId(todos),
      },
      config: options.config && typeof options.config === "object" ? options.config : {},
    },
    originalFiles: readExistingFiles(dataDirectory),
  };

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    destinationPath,
    fileCount: Object.keys(payload.originalFiles).length,
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_FILE_BYTES,
  createDataBackup,
  getDataBackupSummary,
  parseDataBackup,
  readDataBackup,
};
