const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const MAX_LOG_SIZE = 1024 * 1024;
const LOG_FILE_NAME = "main.log";

let initialized = false;
let logDirectory = "";
let logFilePath = "";

function getLogDirectory() {
  if (!logDirectory) logDirectory = app.getPath("logs");
  return logDirectory;
}

function getLogFilePath() {
  if (!logFilePath) logFilePath = path.join(getLogDirectory(), LOG_FILE_NAME);
  return logFilePath;
}

function formatValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function appendLog(level, values) {
  try {
    fs.mkdirSync(getLogDirectory(), { recursive: true });
    const message = values.map(formatValue).join(" ");
    fs.appendFileSync(
      getLogFilePath(),
      `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`,
      "utf8",
    );
  } catch (_error) {
    // Logging must never interrupt the application.
  }
}

function rotateLogIfNeeded() {
  try {
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < MAX_LOG_SIZE) return;
    fs.copyFileSync(filePath, `${filePath}.1`);
    fs.truncateSync(filePath, 0);
  } catch (_error) {
    // A failed rotation should not prevent new log entries.
  }
}

function initializeLogger() {
  if (initialized) return getLogFilePath();
  initialized = true;
  try {
    fs.mkdirSync(getLogDirectory(), { recursive: true });
    rotateLogIfNeeded();
  } catch (_error) {
    return "";
  }

  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      original(...values);
      appendLog(level, values);
    };
  }

  process.on("uncaughtExceptionMonitor", (error) => {
    appendLog("error", ["Uncaught exception", error]);
  });
  process.on("unhandledRejection", (reason) => {
    appendLog("error", ["Unhandled rejection", reason]);
  });
  console.log("MyTodo main process started", app.getVersion());
  return getLogFilePath();
}

module.exports = {
  getLogDirectory,
  getLogFilePath,
  initializeLogger,
};
