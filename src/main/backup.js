const fs = require("fs");
const path = require("path");

const BACKUP_FORMAT = "mytodo-data-backup";
const BACKUP_FORMAT_VERSION = 1;
const DATA_FILE_NAMES = [
  "todo-store.json",
  "todo-store.json.bak",
  "win-config.json",
  "win-config.json.bak",
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
        schemaVersion: 2,
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
  createDataBackup,
};
