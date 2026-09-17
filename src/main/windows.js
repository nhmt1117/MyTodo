const { app, BrowserWindow, Menu, Tray, screen } = require("electron");
const path = require("path");
const {
  getGlobalConfig,
  normalizeFloatBounds,
  setFloatBounds,
  setGlobalConfig,
  setMainWindowBounds,
} = require("./config");

const APP_ROOT = path.join(__dirname, "..", "..");
function getAppIconPath() {
  const resourcesRoot = app.isPackaged && process.resourcesPath
    ? process.resourcesPath
    : APP_ROOT;
  return path.join(resourcesRoot, "MyTodo.ico");
}

const APP_ICON_PATH = getAppIconPath();
const APP_TASKBAR_ICON_PATH = app.isPackaged && process.resourcesPath
  ? path.join(process.resourcesPath, "MyTodoTaskbar.ico")
  : APP_ICON_PATH;
const APP_USER_MODEL_ID = "com.nhmt.mytodo";
const FLOAT_WIN_SIZE = { width: 220, height: 130 };
const REMINDER_WIN_SIZES = {
  "bottom-right": { width: 410, height: 276 },
  "top-center": { width: 640, height: 190 },
};
const REMINDER_MARGIN = 6;

let mainWindow = null;
let floatWindow = null;
let tray = null;
let isQuitting = false;
let floatMoveSaveTimer = null;
let reminderWindow = null;
let reminderWindowReady = false;
let reminderWindowReadyPromise = null;
let currentReminder = null;
let reminderDisplaySequence = 0;
let reminderHideGuardTimer = null;
let closePromptPending = false;
let quitFallbackTimer = null;
const reminderQueue = [];

function markQuitting() {
  isQuitting = true;
}

function destroyTray() {
  if (!tray) return false;
  tray.destroy();
  tray = null;
  return true;
}

function applyTaskbarDetails(targetWindow) {
  if (process.platform !== "win32") return;
  targetWindow.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_TASKBAR_ICON_PATH,
    appIconIndex: 0,
  });
}

function destroyManagedWindows() {
  if (floatMoveSaveTimer) {
    clearTimeout(floatMoveSaveTimer);
    floatMoveSaveTimer = null;
  }
  if (reminderHideGuardTimer) {
    clearTimeout(reminderHideGuardTimer);
    reminderHideGuardTimer = null;
  }

  const managedWindows = [reminderWindow, floatWindow, mainWindow];
  for (const targetWindow of managedWindows) {
    if (!targetWindow || targetWindow.isDestroyed()) continue;
    try {
      targetWindow.destroy();
    } catch (error) {
      console.warn("关闭应用窗口失败", error);
    }
  }

  mainWindow = null;
  floatWindow = null;
  reminderWindow = null;
  reminderWindowReady = false;
  reminderWindowReadyPromise = null;
  currentReminder = null;
  reminderDisplaySequence = 0;
  reminderQueue.length = 0;
}

function prepareForApplicationQuit() {
  markQuitting();
  destroyTray();
  destroyManagedWindows();

  if (quitFallbackTimer) return;
  quitFallbackTimer = setTimeout(() => app.exit(0), 1500);
  quitFallbackTimer.unref?.();
}

function quitApplication() {
  if (isQuitting) return false;
  prepareForApplicationQuit();
  app.quit();
  return true;
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function showTodoDetailInMainWindow(todoId) {
  const id = Number(todoId);
  showMainWindow();
  if (!Number.isFinite(id) || !mainWindow || mainWindow.isDestroyed()) return false;

  const targetWindow = mainWindow;
  const sendTaskId = () => {
    if (!targetWindow.isDestroyed() && mainWindow === targetWindow) {
      targetWindow.webContents.send("open-todo-detail", id);
    }
  };
  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", sendTaskId);
  } else {
    sendTaskId();
  }
  return true;
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

function requestCloseMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (isQuitting) return quitApplication();
  if (closePromptPending) return false;

  const config = getGlobalConfig();
  if (config.closeToTrayPrompt === false) {
    if (config.closeWithoutPromptAction === "quit") return quitApplication();
    hideMainWindow();
    return false;
  }

  closePromptPending = true;
  mainWindow.webContents.send("close-confirmation-requested");
  return false;
}

function resolveCloseMainWindow(action, dontAskAgain = false) {
  if (!closePromptPending) return false;

  closePromptPending = false;
  const shouldQuit = action === "quit";
  let updatedConfig = null;
  if (dontAskAgain) {
    updatedConfig = setGlobalConfig({
      closeToTrayPrompt: false,
      closeWithoutPromptAction: shouldQuit ? "quit" : "tray",
    }, { applyAutoStart: false });
  }
  if (shouldQuit) quitApplication();
  else hideMainWindow();
  return { handled: true, config: updatedConfig };
}

function cancelCloseMainWindow() {
  if (!closePromptPending) return false;
  closePromptPending = false;
  return true;
}

function notifyTodoDataChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("todo-data-changed");
  return true;
}

function notifyUpdateStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("update-status", status);
  return true;
}

function notifySyncStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("sync-status", status);
  return true;
}

function minimizeMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
}

function toggleMainWindowMaximize() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
}

function normalizeReminderPayload(candidate) {
  if (!candidate || typeof candidate !== "object") return null;

  const id = Number(candidate.id);
  const key = String(candidate.key || "");
  const body = String(candidate.body || "").trim();
  if (!Number.isFinite(id) || !key || !body) return null;

  return {
    id,
    key,
    kind: candidate.kind === "summary" ? "summary" : "task",
    summaryKind: String(candidate.summaryKind || ""),
    title: String(candidate.title || "MyTodo 提醒"),
    body,
    description: String(candidate.description || ""),
    dueDate: String(candidate.dueDate || ""),
    dueTime: String(candidate.dueTime || candidate.remindTime || ""),
    remindTime: String(candidate.dueTime || candidate.remindTime || ""),
    reason: String(candidate.reason || ""),
    priority: ["low", "mid", "high"].includes(candidate.priority)
      ? candidate.priority
      : "mid",
    isCycle: !!candidate.isCycle,
    cycleType: String(candidate.cycleType || ""),
    isSnoozed: !!candidate.isSnoozed,
    developmentTest: !!candidate.developmentTest,
  };
}

function getReminderWindowBounds() {
  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const position = getGlobalConfig().reminderPosition === "top-center" ? "top-center" : "bottom-right";
  const preferredSize = REMINDER_WIN_SIZES[position];
  const reminderWidth = Math.min(preferredSize.width, Math.max(320, width - REMINDER_MARGIN * 2));
  const reminderHeight = Math.min(preferredSize.height, Math.max(160, height - REMINDER_MARGIN * 2));
  if (position === "top-center") {
    return {
      x: x + Math.round((width - reminderWidth) / 2),
      y: y + REMINDER_MARGIN,
      width: reminderWidth,
      height: reminderHeight,
    };
  }

  return {
    x: x + width - reminderWidth - REMINDER_MARGIN,
    y: y + height - reminderHeight - REMINDER_MARGIN,
    width: reminderWidth,
    height: reminderHeight,
  };
}

function sendReminderContent() {
  if (!currentReminder || !reminderWindowReady || !reminderWindow || reminderWindow.isDestroyed()) {
    return false;
  }
  const config = getGlobalConfig();
  reminderWindow.webContents.send("reminder-display", {
    ...currentReminder,
    remainingCount: reminderQueue.length,
    soundEnabled: config.notificationSound !== false,
    reminderPosition: config.reminderPosition === "top-center" ? "top-center" : "bottom-right",
  });
  return true;
}

function refreshReminderWindowPlacement(options = {}) {
  if (!reminderWindow || reminderWindow.isDestroyed()) return false;
  reminderWindow.setBounds(getReminderWindowBounds());
  if (options.notifyRenderer !== false) sendReminderContent();
  return true;
}

function sendCurrentReminder() {
  if (
    !currentReminder ||
    !reminderWindowReady ||
    !reminderWindow ||
    reminderWindow.isDestroyed()
  ) {
    return false;
  }

  if (reminderHideGuardTimer) {
    clearTimeout(reminderHideGuardTimer);
    reminderHideGuardTimer = null;
  }
  refreshReminderWindowPlacement({ notifyRenderer: false });
  reminderWindow.setIgnoreMouseEvents(false);
  sendReminderContent();
  reminderWindow.showInactive();
  return true;
}

function showNextReminder() {
  if (currentReminder || reminderQueue.length === 0) return false;
  currentReminder = {
    ...reminderQueue.shift(),
    displayId: ++reminderDisplaySequence,
  };
  return sendCurrentReminder();
}

function hideReminderWindow() {
  if (!reminderWindow || reminderWindow.isDestroyed()) return false;

  if (reminderHideGuardTimer) clearTimeout(reminderHideGuardTimer);
  const targetWindow = reminderWindow;
  targetWindow.setIgnoreMouseEvents(true);
  targetWindow.hide();
  reminderHideGuardTimer = setTimeout(() => {
    reminderHideGuardTimer = null;
    if (
      targetWindow.isDestroyed() ||
      reminderWindow !== targetWindow ||
      currentReminder ||
      reminderQueue.length ||
      !targetWindow.isVisible()
    ) {
      return;
    }

    console.warn("提醒窗口隐藏失败，正在重建窗口");
    targetWindow.destroy();
    prepareReminderWindow();
  }, 250);
  reminderHideGuardTimer.unref?.();
  return true;
}

function createReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) return reminderWindow;

  reminderWindowReady = false;
  reminderWindow = new BrowserWindow({
    title: "MyTodo 提醒",
    icon: APP_ICON_PATH,
    ...REMINDER_WIN_SIZES["bottom-right"],
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  reminderWindow.setSkipTaskbar(true);
  reminderWindow.setAlwaysOnTop(true, "pop-up-menu");
  reminderWindow.setIgnoreMouseEvents(true);
  const targetWindow = reminderWindow;
  reminderWindowReadyPromise = targetWindow
    .loadFile(path.join(APP_ROOT, "reminder.html"))
    .then(() => {
      if (targetWindow.isDestroyed() || reminderWindow !== targetWindow) return false;
      reminderWindowReady = true;
      return true;
    })
    .catch((error) => {
      console.warn("自定义提醒页面加载失败", error);
      if (!targetWindow.isDestroyed()) targetWindow.destroy();
      return false;
    });
  reminderWindow.on("closed", () => {
    if (reminderHideGuardTimer) {
      clearTimeout(reminderHideGuardTimer);
      reminderHideGuardTimer = null;
    }
    reminderWindow = null;
    reminderWindowReady = false;
    reminderWindowReadyPromise = null;
    currentReminder = null;
    reminderQueue.length = 0;
  });

  return reminderWindow;
}

async function prepareReminderWindow() {
  createReminderWindow();
  return reminderWindowReadyPromise ? reminderWindowReadyPromise : reminderWindowReady;
}

function showReminder(candidate) {
  const payload = normalizeReminderPayload(candidate);
  if (!payload) return false;

  createReminderWindow();
  if (!reminderWindowReady) return false;

  const isDuplicate =
    (currentReminder && currentReminder.id === payload.id && currentReminder.key === payload.key) ||
    reminderQueue.some((item) => item.id === payload.id && item.key === payload.key);
  if (isDuplicate) return true;

  reminderQueue.push(payload);
  if (!currentReminder) showNextReminder();
  else sendCurrentReminder();
  return true;
}

function handleReminderAction(sender, action, identity = {}, handlers = {}) {
  if (
    !reminderWindow ||
    reminderWindow.isDestroyed() ||
    reminderWindow.webContents !== sender ||
    !currentReminder
  ) {
    return false;
  }

  const matchesCurrent =
    Number(identity.id) === currentReminder.id &&
    String(identity.key || "") === currentReminder.key &&
    Number(identity.displayId) === currentReminder.displayId;
  if (!matchesCurrent || !["dismiss", "open", "snooze", "skip", "complete"].includes(action)) {
    return false;
  }

  const handledReminder = { ...currentReminder };
  if (action === "snooze") {
    if (typeof handlers.snooze !== "function" || handlers.snooze(handledReminder) !== true) {
      return false;
    }
  }
  if (action === "complete") {
    if (typeof handlers.complete !== "function" || handlers.complete(handledReminder) !== true) {
      return false;
    }
  }

  currentReminder = null;
  if (action === "open") {
    if (handledReminder.kind === "summary" || handledReminder.developmentTest) showMainWindow();
    else showTodoDetailInMainWindow(handledReminder.id);
  }
  if (reminderQueue.length) showNextReminder();
  else hideReminderWindow();
  return true;
}
function createTray() {
  tray = new Tray(APP_ICON_PATH);
  const contextMenu = Menu.buildFromTemplate([
    { label: " 打开主窗口 ", click: showMainWindow },
    {
      label: " 退出程序 ",
      click: quitApplication,
    },
  ]);

  tray.setToolTip("MyTodo 待办工具 ");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) hideMainWindow();
    else showMainWindow();
  });

  return tray;
}

function getDefaultFloatBounds() {
  const margin = 24;
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - FLOAT_WIN_SIZE.width - margin,
    y: y + height - FLOAT_WIN_SIZE.height - margin,
    width: FLOAT_WIN_SIZE.width,
    height: FLOAT_WIN_SIZE.height,
  };
}

function getDisplayForBounds(bounds) {
  const displays = screen.getAllDisplays();
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  return (
    displays.find((display) => {
      const area = display.workArea;
      return (
        center.x >= area.x &&
        center.x <= area.x + area.width &&
        center.y >= area.y &&
        center.y <= area.y + area.height
      );
    }) || screen.getPrimaryDisplay()
  );
}

function keepBoundsVisible(bounds) {
  const display = getDisplayForBounds(bounds);
  const { x, y, width, height } = display.workArea;
  const next = { ...bounds };

  next.x = Math.min(Math.max(next.x, x), x + Math.max(width - next.width, 0));
  next.y = Math.min(Math.max(next.y, y), y + Math.max(height - next.height, 0));
  return next;
}

function restoreFloatWindowBounds() {
  if (!floatWindow || floatWindow.isDestroyed()) return;

  const savedBounds = normalizeFloatBounds(getGlobalConfig().floatBounds);
  const nextBounds = keepBoundsVisible(savedBounds || getDefaultFloatBounds());
  floatWindow.setBounds(nextBounds);
}

function saveFloatWindowBounds() {
  if (!floatWindow || floatWindow.isDestroyed()) return false;

  setFloatBounds(normalizeFloatBounds(floatWindow.getBounds()));
  return true;
}

function scheduleFloatWindowBoundsSave() {
  if (floatMoveSaveTimer) clearTimeout(floatMoveSaveTimer);
  floatMoveSaveTimer = setTimeout(() => {
    floatMoveSaveTimer = null;
    saveFloatWindowBounds();
  }, 300);
}

function createFloatWindow() {
  if (floatWindow && !floatWindow.isDestroyed()) return floatWindow;

  floatWindow = new BrowserWindow({
    title: "单词悬浮窗",
    icon: APP_ICON_PATH,
    width: FLOAT_WIN_SIZE.width,
    height: FLOAT_WIN_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  floatWindow.setSkipTaskbar(true);
  floatWindow.setAlwaysOnTop(true, "floating");
  floatWindow.loadFile(path.join(APP_ROOT, "float.html"));
  floatWindow.once("ready-to-show", () => {
    restoreFloatWindowBounds();
    floatWindow.setSkipTaskbar(true);
    floatWindow.showInactive();
  });
  floatWindow.on("move", scheduleFloatWindowBoundsSave);
  floatWindow.on("closed", () => {
    if (floatMoveSaveTimer) {
      clearTimeout(floatMoveSaveTimer);
      floatMoveSaveTimer = null;
    }
    floatWindow = null;
  });

  return floatWindow;
}

function toggleFloatWindow() {
  if (!floatWindow || floatWindow.isDestroyed()) {
    createFloatWindow();
    return true;
  }

  if (floatWindow.isVisible()) {
    floatWindow.hide();
    return false;
  }

  restoreFloatWindowBounds();
  floatWindow.setSkipTaskbar(true);
  floatWindow.showInactive();
  return true;
}

function moveFloatWindow(deltaX, deltaY) {
  if (!floatWindow || floatWindow.isDestroyed()) return false;

  const dx = Number(deltaX);
  const dy = Number(deltaY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;

  const bounds = floatWindow.getBounds();
  const nextBounds = keepBoundsVisible({
    ...bounds,
    x: bounds.x + dx,
    y: bounds.y + dy,
  });
  floatWindow.setBounds(nextBounds);
  return true;
}

function closeFloatWindow() {
  if (!floatWindow || floatWindow.isDestroyed()) return false;

  saveFloatWindowBounds();
  floatWindow.hide();
  return true;
}

function createMainWindow(options = {}) {
  const config = getGlobalConfig();
  const showOnReady = options.showOnReady !== false;

  mainWindow = new BrowserWindow({
    title: "MyTodo",
    icon: APP_ICON_PATH,
    width: config.width,
    height: config.height,
    minWidth: 860,
    minHeight: 680,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  applyTaskbarDetails(mainWindow);

  mainWindow.loadFile(path.join(APP_ROOT, "index.html"));
  mainWindow.on("close", (event) => {
    setMainWindowBounds(mainWindow.getBounds());
    if (isQuitting) return;

    event.preventDefault();
    requestCloseMainWindow();
  });
  mainWindow.setIcon(APP_ICON_PATH);
  mainWindow.once("ready-to-show", () => {
    mainWindow.setIcon(APP_ICON_PATH);
    applyTaskbarDetails(mainWindow);
    if (showOnReady) mainWindow.show();
  });

  return mainWindow;
}

module.exports = {
  cancelCloseMainWindow,
  closeFloatWindow,
  createFloatWindow,
  createMainWindow,
  createTray,
  destroyManagedWindows,
  destroyTray,
  handleReminderAction,
  hideMainWindow,
  markQuitting,
  minimizeMainWindow,
  moveFloatWindow,
  notifyTodoDataChanged,
  notifySyncStatus,
  notifyUpdateStatus,
  prepareForApplicationQuit,
  prepareReminderWindow,
  quitApplication,
  requestCloseMainWindow,
  refreshReminderWindowPlacement,
  resolveCloseMainWindow,
  saveFloatWindowBounds,
  showMainWindow,
  showReminder,
  toggleMainWindowMaximize,
  toggleFloatWindow,
};
