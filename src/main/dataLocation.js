const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

const DATA_FILES = [
  "todo-store.json",
  "todo-store.json.bak",
  "win-config.json",
  "win-config.json.bak",
];
const LOCATION_FILE_NAME = "MyTodo-data-location.json";
const DEFAULT_DATA_DIRECTORY_NAME = "MyTodoData";

let defaultDataDirectory = null;
let activeDataDirectory = null;
let dataLocationStatus = { state: "pending", message: "数据位置尚未初始化" };

function isLocationRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value.directory === undefined || typeof value.directory === "string");
}

function normalizeDataDirectory(directory) {
  const value = String(directory || "").trim();
  if (!value || !path.isAbsolute(value)) return "";
  return path.resolve(value);
}

function isSameDirectory(left, right) {
  const leftPath = normalizeDataDirectory(left);
  const rightPath = normalizeDataDirectory(right);
  if (!leftPath || !rightPath) return false;
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function getLocationFilePath() {
  const baseDirectory = hasUserDataOverride()
    ? app.getPath("userData")
    : app.getPath("appData");
  return path.join(baseDirectory, LOCATION_FILE_NAME);
}

function hasUserDataOverride() {
  return process.argv.some(
    (argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
  );
}

function getLegacyDataDirectory() {
  return normalizeDataDirectory(app.getPath("userData"));
}

function getPackagedDataDirectory(executablePath = app.getPath("exe")) {
  const appDirectory = path.dirname(executablePath);
  return path.join(path.dirname(appDirectory), DEFAULT_DATA_DIRECTORY_NAME);
}

function getDefaultDataDirectory() {
  if (!defaultDataDirectory) {
    defaultDataDirectory = normalizeDataDirectory(
      app.isPackaged && !hasUserDataOverride()
        ? getPackagedDataDirectory()
        : getLegacyDataDirectory(),
    );
  }
  return defaultDataDirectory;
}

function migrateLegacyDataIfNeeded(defaultDirectory) {
  const legacyDirectory = getLegacyDataDirectory();
  if (isSameDirectory(legacyDirectory, defaultDirectory)) return;

  const legacyFiles = getExistingDataFiles(legacyDirectory);
  if (!legacyFiles.length) return;

  if (getExistingDataFiles(defaultDirectory).length) {
    console.warn("新默认数据目录已有数据，保留旧目录以避免覆盖", legacyDirectory);
    return;
  }

  activeDataDirectory = legacyDirectory;
  try {
    migrateDataDirectory(defaultDirectory);
  } catch (error) {
    activeDataDirectory = legacyDirectory;
    console.error("无法迁移旧数据目录，继续使用原位置", error);
  }
}
function initializeDataDirectory() {
  const defaultDirectory = getDefaultDataDirectory();
  const result = readJsonWithBackup(getLocationFilePath(), {}, isLocationRecord);
  const configuredDirectory = normalizeDataDirectory(result.value?.directory);
  activeDataDirectory = configuredDirectory || defaultDirectory;

  if (!configuredDirectory) migrateLegacyDataIfNeeded(defaultDirectory);

  if (result.source === "backup") {
    dataLocationStatus = {
      state: "recovered",
      message: "数据位置记录已从备份恢复",
    };
    console.warn("数据位置记录损坏，已从备份恢复", result.primaryError);
    writeLocation(activeDataDirectory);
  } else if (result.primaryError) {
    dataLocationStatus = {
      state: "error",
      message: "数据位置记录无法读取，已临时使用默认位置",
    };
    console.error("数据位置记录无法读取，已使用默认位置", result.primaryError);
  } else {
    dataLocationStatus = { state: "ok", message: "数据位置正常" };
  }

  return getDataLocation();
}

function ensureInitialized() {
  if (!activeDataDirectory) initializeDataDirectory();
}

function getDataDirectory() {
  ensureInitialized();
  return activeDataDirectory;
}

function getDataLocation() {
  ensureInitialized();
  return {
    directory: activeDataDirectory,
    defaultDirectory: getDefaultDataDirectory(),
    isCustom: !isSameDirectory(activeDataDirectory, getDefaultDataDirectory()),
  };
}

function getDataLocationStatus() {
  return { ...dataLocationStatus };
}

function getDataFilePath(fileName) {
  if (!DATA_FILES.includes(fileName)) {
    throw new Error(`Unsupported MyTodo data file: ${fileName}`);
  }
  return path.join(getDataDirectory(), fileName);
}

function getExistingDataFiles(directory) {
  return DATA_FILES.filter((fileName) => {
    try {
      return fs.statSync(path.join(directory, fileName)).isFile();
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
}

function removeFiles(directory, fileNames) {
  const failures = [];
  for (const fileName of fileNames) {
    try {
      fs.rmSync(path.join(directory, fileName), { force: true });
    } catch (error) {
      failures.push({ fileName, error });
    }
  }
  return failures;
}

function writeLocation(directory) {
  writeJsonAtomic(getLocationFilePath(), { directory }, isLocationRecord);
}

function migrateDataDirectory(targetDirectory) {
  ensureInitialized();

  const sourceDirectory = activeDataDirectory;
  const target = normalizeDataDirectory(targetDirectory);
  if (!target) throw new Error("请选择有效的数据文件夹");
  if (isSameDirectory(sourceDirectory, target)) {
    return { ...getDataLocation(), unchanged: true, cleanupPending: [] };
  }

  fs.mkdirSync(target, { recursive: true });
  const targetFiles = getExistingDataFiles(target);
  if (targetFiles.length) {
    throw new Error(`目标文件夹已包含 MyTodo 数据：${targetFiles.join("、")}`);
  }

  const sourceFiles = getExistingDataFiles(sourceDirectory);
  const createdFiles = [];
  const temporaryFiles = [];

  try {
    for (const fileName of sourceFiles) {
      const sourcePath = path.join(sourceDirectory, fileName);
      const targetPath = path.join(target, fileName);
      const temporaryPath = path.join(
        target,
        `.${fileName}.${process.pid}.${Date.now()}.${createdFiles.length}.migration.tmp`,
      );
      temporaryFiles.push(temporaryPath);
      fs.copyFileSync(sourcePath, temporaryPath);
      fs.renameSync(temporaryPath, targetPath);
      createdFiles.push(fileName);
    }
  } catch (error) {
    removeFiles(target, createdFiles);
    for (const temporaryPath of temporaryFiles) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  try {
    writeLocation(target);
  } catch (error) {
    removeFiles(target, createdFiles);
    throw error;
  }

  activeDataDirectory = target;
  dataLocationStatus = { state: "ok", message: "数据位置正常" };
  const cleanupFailures = removeFiles(sourceDirectory, sourceFiles);
  return {
    ...getDataLocation(),
    unchanged: false,
    migratedFiles: sourceFiles,
    cleanupPending: cleanupFailures.map((failure) => failure.fileName),
  };
}

module.exports = {
  DATA_FILES,
  getDataDirectory,
  getDataFilePath,
  getDataLocation,
  getDataLocationStatus,
  getPackagedDataDirectory,
  initializeDataDirectory,
  isSameDirectory,
  migrateDataDirectory,
  normalizeDataDirectory,
};
