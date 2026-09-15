const fs = require("fs");
const path = require("path");

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonFile(filePath, validate) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (typeof validate === "function" && !validate(value)) {
    const error = new Error(`Invalid JSON data structure: ${filePath}`);
    error.code = "EINVALIDDATA";
    throw error;
  }
  return value;
}

function readJsonWithBackup(filePath, fallbackValue, validate) {
  try {
    return { value: readJsonFile(filePath, validate), source: "primary" };
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`;
    try {
      return {
        value: readJsonFile(backupPath, validate),
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

function copyValidPrimaryToBackup(filePath, validate) {
  if (!fs.existsSync(filePath)) return;

  try {
    readJsonFile(filePath, validate);
  } catch (error) {
    // Keep the previous known-good backup when the primary file is invalid.
    return;
  }
  fs.copyFileSync(filePath, `${filePath}.bak`);
}

function writeJsonAtomic(filePath, value, validateExisting) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, content, "utf8");
    copyValidPrimaryToBackup(filePath, validateExisting);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

module.exports = {
  readJsonWithBackup,
  writeJsonAtomic,
};
