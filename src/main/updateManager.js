const AUTO_CHECK_DELAY_MS = 30 * 1000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_UPDATER_LOG_LENGTH = 1200;

function formatUpdaterLogValue(value) {
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createUpdaterLogger(consoleApi = console) {
  function write(method, values) {
    const message = values
      .map(formatUpdaterLogValue)
      .join(" ")
      .replace(/\s+Headers:\s*\{[\s\S]*$/i, "")
      .replace(/^Error:\s+Error:\s+/i, "Error: ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_UPDATER_LOG_LENGTH);
    if (message) consoleApi[method](`[updater] ${message}`);
  }

  return {
    debug: (...values) => write("log", values),
    info: (...values) => write("log", values),
    warn: (...values) => write("warn", values),
    error: (...values) => write("error", values),
  };
}

// Windows NSIS update lifecycle is kept here so the rest of the app only sees state changes.
function createUpdateManager(options = {}) {
  const app = options.app;
  const platform = options.platform || process.platform;
  const timerApi = options.timerApi || {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const loadUpdater = options.loadUpdater || (() => require("electron-updater").autoUpdater);
  const isPackaged = options.isPackaged == null ? !!app?.isPackaged : !!options.isPackaged;
  const isPortable = options.isPortable == null
    ? !!process.env.PORTABLE_EXECUTABLE_DIR
    : !!options.isPortable;

  let updater = null;
  let started = false;
  let startupTimer = null;
  let intervalTimer = null;
  let notifyStatus = () => {};
  let boundListeners = [];
  let currentCheckIsManual = false;
  let state = {
    phase: "idle",
    supported: false,
    unsupportedReason: "",
    autoCheckEnabled: true,
    currentVersion: typeof app?.getVersion === "function" ? app.getVersion() : "",
    availableVersion: "",
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    lastCheckedAt: "",
    errorMessage: "",
    manual: false,
  };

  function cloneState() {
    return { ...state };
  }

  function emitState(patch = {}) {
    state = { ...state, ...patch };
    const snapshot = cloneState();
    try {
      notifyStatus(snapshot);
    } catch (error) {
      console.warn("Failed to send update status", error);
    }
    return snapshot;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Update request failed").trim();
    return message.slice(0, 240);
  }

  function clearSchedule() {
    if (startupTimer) timerApi.clearTimeout(startupTimer);
    if (intervalTimer) timerApi.clearInterval(intervalTimer);
    startupTimer = null;
    intervalTimer = null;
  }

  function scheduleAutomaticChecks() {
    clearSchedule();
    if (!started || !state.supported || !state.autoCheckEnabled) return;

    startupTimer = timerApi.setTimeout(() => {
      startupTimer = null;
      checkForUpdates({ manual: false });
    }, options.autoCheckDelayMs ?? AUTO_CHECK_DELAY_MS);
    intervalTimer = timerApi.setInterval(() => {
      checkForUpdates({ manual: false });
    }, options.autoCheckIntervalMs ?? AUTO_CHECK_INTERVAL_MS);
    startupTimer?.unref?.();
    intervalTimer?.unref?.();
  }

  function on(eventName, handler) {
    updater.on(eventName, handler);
    boundListeners.push([eventName, handler]);
  }

  function bindUpdaterEvents() {
    on("checking-for-update", () => {
      emitState({
        phase: "checking",
        manual: currentCheckIsManual,
        errorMessage: "",
      });
    });
    on("update-available", (info = {}) => {
      emitState({
        phase: "available",
        availableVersion: String(info.version || ""),
        lastCheckedAt: new Date().toISOString(),
        errorMessage: "",
        manual: currentCheckIsManual,
      });
    });
    on("update-not-available", () => {
      emitState({
        phase: "up-to-date",
        availableVersion: "",
        lastCheckedAt: new Date().toISOString(),
        errorMessage: "",
        manual: currentCheckIsManual,
      });
    });
    on("download-progress", (progress = {}) => {
      emitState({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0),
        transferred: Math.max(0, Number(progress.transferred) || 0),
        total: Math.max(0, Number(progress.total) || 0),
        errorMessage: "",
      });
    });
    on("update-downloaded", (info = {}) => {
      emitState({
        phase: "downloaded",
        availableVersion: String(info.version || state.availableVersion || ""),
        percent: 100,
        bytesPerSecond: 0,
        errorMessage: "",
      });
    });
    on("update-cancelled", () => {
      emitState({ phase: "available", percent: 0, bytesPerSecond: 0 });
    });
    on("error", (error) => {
      emitState({
        phase: "error",
        errorMessage: friendlyError(error),
        lastCheckedAt: new Date().toISOString(),
        manual: currentCheckIsManual,
      });
    });
  }

  function start(startOptions = {}) {
    if (typeof startOptions.notifyStatus === "function") {
      notifyStatus = startOptions.notifyStatus;
    }
    state.autoCheckEnabled = startOptions.autoCheckEnabled !== false;
    if (started) {
      scheduleAutomaticChecks();
      return emitState();
    }

    started = true;
    let unsupportedReason = "";
    if (platform !== "win32") unsupportedReason = "not-windows";
    else if (!isPackaged) unsupportedReason = "development";
    else if (isPortable) unsupportedReason = "portable";

    if (unsupportedReason) {
      return emitState({
        phase: "unsupported",
        supported: false,
        unsupportedReason,
      });
    }

    try {
      updater = loadUpdater();
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.logger = options.updaterLogger || createUpdaterLogger();
      bindUpdaterEvents();
      emitState({ phase: "idle", supported: true, unsupportedReason: "" });
      scheduleAutomaticChecks();
    } catch (error) {
      emitState({
        phase: "error",
        supported: false,
        unsupportedReason: "initialization-failed",
        errorMessage: friendlyError(error),
      });
    }
    return cloneState();
  }

  async function checkForUpdates(checkOptions = {}) {
    if (!state.supported || !updater) return cloneState();
    if (["checking", "downloading", "downloaded"].includes(state.phase)) return cloneState();

    currentCheckIsManual = checkOptions.manual !== false;
    emitState({
      phase: "checking",
      manual: currentCheckIsManual,
      errorMessage: "",
    });
    try {
      await updater.checkForUpdates();
    } catch (error) {
      if (state.phase !== "error") {
        emitState({
          phase: "error",
          errorMessage: friendlyError(error),
          lastCheckedAt: new Date().toISOString(),
          manual: currentCheckIsManual,
        });
      }
    }
    return cloneState();
  }

  async function downloadUpdate() {
    if (!updater || state.phase !== "available") return cloneState();
    emitState({
      phase: "downloading",
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
      errorMessage: "",
    });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      if (state.phase !== "error") {
        emitState({ phase: "error", errorMessage: friendlyError(error) });
      }
    }
    return cloneState();
  }

  function installUpdate() {
    if (!updater || state.phase !== "downloaded") return false;
    timerApi.setTimeout(() => updater.quitAndInstall(false, true), 80);
    return true;
  }

  function setAutoCheckEnabled(enabled) {
    state.autoCheckEnabled = !!enabled;
    scheduleAutomaticChecks();
    return emitState();
  }

  function stop() {
    clearSchedule();
    if (updater) {
      for (const [eventName, handler] of boundListeners) {
        updater.removeListener(eventName, handler);
      }
    }
    boundListeners = [];
    updater = null;
    started = false;
  }

  return {
    checkForUpdates,
    downloadUpdate,
    getState: cloneState,
    installUpdate,
    setAutoCheckEnabled,
    start,
    stop,
  };
}

let defaultManager = null;

function getDefaultManager() {
  if (!defaultManager) {
    const { app } = require("electron");
    defaultManager = createUpdateManager({ app });
  }
  return defaultManager;
}

module.exports = {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  checkForUpdates: (options) => getDefaultManager().checkForUpdates(options),
  createUpdaterLogger,
  createUpdateManager,
  downloadUpdate: () => getDefaultManager().downloadUpdate(),
  getUpdateState: () => getDefaultManager().getState(),
  installUpdate: () => getDefaultManager().installUpdate(),
  setAutoCheckEnabled: (enabled) => getDefaultManager().setAutoCheckEnabled(enabled),
  startUpdateManager: (options) => getDefaultManager().start(options),
  stopUpdateManager: () => getDefaultManager().stop(),
};
