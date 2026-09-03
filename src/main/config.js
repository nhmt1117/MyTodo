const { app } = require("electron");
const { getDataFilePath } = require("./dataLocation");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

const defaultConfig = {
  width: 620,
  height: 1000,
  weekStartMon: true,
  autoStart: false,
  floatBounds: null,
};

let globalConfig = { ...defaultConfig };

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
  return {
    width: Number.isFinite(Number(cfg.width)) ? Number(cfg.width) : defaultConfig.width,
    height: Number.isFinite(Number(cfg.height)) ? Number(cfg.height) : defaultConfig.height,
    weekStartMon: cfg.weekStartMon !== false,
    autoStart: !!cfg.autoStart,
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
    });
  }
}

function loadGlobalConfig() {
  const result = readJsonWithBackup(getConfigPath(), defaultConfig);
  globalConfig = normalizeGlobalConfig({ ...defaultConfig, ...result.value });

  if (result.source === "backup") {
    console.warn("配置文件损坏，已从备份恢复", result.primaryError);
    saveGlobalConfig({ applyAutoStart: false });
  } else if (result.primaryError) {
    console.error("配置文件及备份均无法读取，已使用默认配置", result.primaryError);
  }

  return cloneConfig();
}

function saveGlobalConfig(options = {}) {
  writeJsonAtomic(getConfigPath(), globalConfig);
  if (options.applyAutoStart !== false) applyAutoStartSetting();
}

function getGlobalConfig() {
  return cloneConfig();
}

function setGlobalConfig(cfg, options = {}) {
  globalConfig = normalizeGlobalConfig({ ...globalConfig, ...cfg });
  saveGlobalConfig(options);
  return cloneConfig();
}

function setMainWindowBounds(bounds) {
  globalConfig = normalizeGlobalConfig({
    ...globalConfig,
    width: bounds.width,
    height: bounds.height,
  });
  saveGlobalConfig();
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
  getGlobalConfig,
  loadGlobalConfig,
  normalizeFloatBounds,
  setFloatBounds,
  setGlobalConfig,
  setMainWindowBounds,
};
