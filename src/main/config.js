const { app } = require("electron");
const { normalizeTime } = require("../shared/recurrence");
const { getDataFilePath } = require("./dataLocation");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

const defaultConfig = {
  width: 1100,
  height: 760,
  weekStartMon: true,
  autoStart: false,
  autoCheckUpdates: true,
  notificationSound: true,
  weeklySummary: true,
  dailySummary: true,
  dailySummaryTime: "09:00",
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "08:00",
  lastDailySummaryDate: "",
  lastWeeklySummaryKey: "",
  trayNoticeShown: false,
  closeToTrayPrompt: true,
  closeWithoutPromptAction: "tray",
  floatBounds: null,
};

let globalConfig = { ...defaultConfig };
let configStatus = { state: "pending", message: "设置尚未加载" };

function isConfigRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getConfigPath() {
  return getDataFilePath("win-config.json");
}

function normalizeFloatBounds(bounds) {
  if (!bounds) return null;

  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizeGlobalConfig(cfg) {
  const width = Number(cfg.width);
  const height = Number(cfg.height);
  return {
    width: Number.isFinite(width) ? Math.max(860, Math.round(width)) : defaultConfig.width,
    height: Number.isFinite(height) ? Math.max(680, Math.round(height)) : defaultConfig.height,
    weekStartMon: cfg.weekStartMon !== false,
    autoStart: !!cfg.autoStart,
    autoCheckUpdates: cfg.autoCheckUpdates !== false,
    notificationSound: cfg.notificationSound !== false,
    weeklySummary: cfg.weeklySummary !== false,
    dailySummary: cfg.dailySummary !== false,
    dailySummaryTime: normalizeTime(cfg.dailySummaryTime, defaultConfig.dailySummaryTime),
    quietHoursEnabled: cfg.quietHoursEnabled === true,
    quietStart: normalizeTime(cfg.quietStart, defaultConfig.quietStart),
    quietEnd: normalizeTime(cfg.quietEnd, defaultConfig.quietEnd),
    lastDailySummaryDate: String(cfg.lastDailySummaryDate || ""),
    lastWeeklySummaryKey: String(cfg.lastWeeklySummaryKey || ""),
    trayNoticeShown: !!cfg.trayNoticeShown,
    closeToTrayPrompt: cfg.closeToTrayPrompt !== false,
    closeWithoutPromptAction: cfg.closeWithoutPromptAction === "quit" ? "quit" : "tray",
    floatBounds: normalizeFloatBounds(cfg.floatBounds),
  };
}

function cloneConfig() {
  return {
    ...globalConfig,
    floatBounds: globalConfig.floatBounds ? { ...globalConfig.floatBounds } : null,
  };
}

function applyAutoStartSetting() {
  if (
    process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux"
  ) {
    app.setLoginItemSettings({
      openAtLogin: globalConfig.autoStart,
      path: process.execPath,
      args: ["--hidden"],
    });
  }
}

function loadGlobalConfig() {
  const result = readJsonWithBackup(getConfigPath(), defaultConfig, isConfigRecord);
  globalConfig = normalizeGlobalConfig({ ...defaultConfig, ...result.value });

  if (result.source === "backup") {
    configStatus = { state: "recovered", message: "应用设置已从备份恢复" };
    console.warn("配置文件损坏，已从备份恢复", result.primaryError);
    saveGlobalConfig({ applyAutoStart: false });
  } else if (result.primaryError) {
    configStatus = { state: "error", message: "应用设置无法读取，已恢复默认值" };
    console.error("配置文件及备份均无法读取，已使用默认配置", result.primaryError);
  } else {
    configStatus = { state: "ok", message: "应用设置正常" };
  }

  return cloneConfig();
}

function saveGlobalConfig(options = {}) {
  writeJsonAtomic(getConfigPath(), globalConfig, isConfigRecord);
  if (options.applyAutoStart !== false) applyAutoStartSetting();
}

function getGlobalConfig() {
  return cloneConfig();
}

function getConfigStatus() {
  return { ...configStatus };
}

function setGlobalConfig(cfg, options = {}) {
  globalConfig = normalizeGlobalConfig({ ...globalConfig, ...cfg });
  saveGlobalConfig(options);
  configStatus = { state: "ok", message: "应用设置正常" };
  return cloneConfig();
}

function markSummarySent(kind, key) {
  const summaryKey = String(key || "");
  if (!summaryKey || !["daily", "weekly"].includes(kind)) return false;
  const field = kind === "daily" ? "lastDailySummaryDate" : "lastWeeklySummaryKey";
  if (globalConfig[field] === summaryKey) return false;
  globalConfig[field] = summaryKey;
  saveGlobalConfig({ applyAutoStart: false });
  return true;
}

function setMainWindowBounds(bounds) {
  globalConfig = normalizeGlobalConfig({
    ...globalConfig,
    width: bounds.width,
    height: bounds.height,
  });
  saveGlobalConfig({ applyAutoStart: false });
  return cloneConfig();
}

function setFloatBounds(bounds) {
  globalConfig = normalizeGlobalConfig({
    ...globalConfig,
    floatBounds: bounds,
  });
  saveGlobalConfig({ applyAutoStart: false });
  return cloneConfig().floatBounds;
}

module.exports = {
  applyAutoStartSetting,
  getConfigStatus,
  getGlobalConfig,
  loadGlobalConfig,
  markSummarySent,
  normalizeFloatBounds,
  setFloatBounds,
  setGlobalConfig,
  setMainWindowBounds,
};
