const fs = require("fs");
const path = require("path");

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonWithBackup(filePath, fallbackValue) {
  try {
    return { value: readJsonFile(filePath), source: "primary" };
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`;
    try {
      return {
        value: readJsonFile(backupPath),
        source: "backup",
        primaryError,
      };
    } catch (backupError) {
      if (primaryError.code === "ENOENT" && backupError.code === "ENOENT") {
        return { value: cloneFallback(fallbackValue), source: "default" };
      }
      return {
        value: cloneFallback(fallbackValue),
        source: "default",
        primaryError,
        backupError,
      };
    }
  }
}

function copyValidPrimaryToBackup(filePath) {
  if (!fs.existsSync(filePath)) return;

  try {
    readJsonFile(filePath);
  } catch (error) {
    // Keep the previous known-good backup when the primary file is invalid.
    return;
  }
  fs.copyFileSync(filePath, `${filePath}.bak`);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, content, "utf8");
    copyValidPrimaryToBackup(filePath);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

module.exports = {
  readJsonWithBackup,
  writeJsonAtomic,
};
