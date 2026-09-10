const { app, BrowserWindow, Menu, Tray, screen } = require("electron");
const path = require("path");
const {
  getGlobalConfig,
  normalizeFloatBounds,
  setFloatBounds,
  setMainWindowBounds,
} = require("./config");

const APP_ROOT = path.join(__dirname, "..", "..");
const APP_ICON_PATH = path.join(APP_ROOT, "MyTodo.ico");
const FLOAT_WIN_SIZE = { width: 220, height: 130 };
const REMINDER_WIN_SIZE = { width: 388, height: 230 };
const REMINDER_MARGIN = 18;

let mainWindow = null;
let floatWindow = null;
let tray = null;
let isQuitting = false;
let floatMoveSaveTimer = null;
let reminderWindow = null;
let reminderWindowReady = false;
let reminderWindowReadyPromise = null;
let currentReminder = null;
const reminderQueue = [];

function markQuitting() {
  isQuitting = true;
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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
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
    title: String(candidate.title || "MyTodo 提醒"),
    body,
    description: String(candidate.description || ""),
    dueDate: String(candidate.dueDate || ""),
    remindTime: String(candidate.remindTime || ""),
    priority: ["low", "mid", "high"].includes(candidate.priority)
      ? candidate.priority
      : "mid",
    isCycle: !!candidate.isCycle,
    cycleType: String(candidate.cycleType || ""),
    isSnoozed: !!candidate.isSnoozed,
  };
}

function getReminderWindowBounds() {
  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  return {
    x: x + width - REMINDER_WIN_SIZE.width - REMINDER_MARGIN,
    y: y + height - REMINDER_WIN_SIZE.height - REMINDER_MARGIN,
    width: REMINDER_WIN_SIZE.width,
    height: REMINDER_WIN_SIZE.height,
  };
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

  reminderWindow.setBounds(getReminderWindowBounds());
  reminderWindow.webContents.send("reminder-display", {
    ...currentReminder,
    remainingCount: reminderQueue.length,
  });
  reminderWindow.showInactive();
  return true;
}

function showNextReminder() {
  if (currentReminder || reminderQueue.length === 0) return false;
  currentReminder = reminderQueue.shift();
  return sendCurrentReminder();
}

function createReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) return reminderWindow;

  reminderWindowReady = false;
  reminderWindow = new BrowserWindow({
    title: "MyTodo 提醒",
    icon: APP_ICON_PATH,
    ...REMINDER_WIN_SIZE,
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
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  reminderWindow.setSkipTaskbar(true);
  reminderWindow.setAlwaysOnTop(true, "pop-up-menu");
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
    String(identity.key || "") === currentReminder.key;
  if (!matchesCurrent || !["dismiss", "open", "snooze"].includes(action)) return false;

  const handledReminder = { ...currentReminder };
  if (action === "snooze") {
    if (typeof handlers.snooze !== "function" || handlers.snooze(handledReminder) !== true) {
      return false;
    }
  }

  reminderWindow.hide();
  currentReminder = null;
  if (action === "open") showTodoDetailInMainWindow(handledReminder.id);
  showNextReminder();
  return true;
}
function createTray() {
  tray = new Tray(APP_ICON_PATH);
  const contextMenu = Menu.buildFromTemplate([
    { label: " 打开主窗口 ", click: showMainWindow },
    {
      label: " 退出程序 ",
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("MyTodo 待办工具 ");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
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

function createMainWindow() {
  const config = getGlobalConfig();

  mainWindow = new BrowserWindow({
    title: "MyTodo",
    icon: APP_ICON_PATH,
    width: config.width,
    height: config.height,
    minWidth: 540,
    minHeight: 700,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(APP_ROOT, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(APP_ROOT, "index.html"));
  mainWindow.on("close", (event) => {
    setMainWindowBounds(mainWindow.getBounds());
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.setIcon(APP_ICON_PATH);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  return mainWindow;
}

module.exports = {
  closeFloatWindow,
  createFloatWindow,
  createMainWindow,
  createTray,
  handleReminderAction,
  hideMainWindow,
  markQuitting,
  minimizeMainWindow,
  moveFloatWindow,
  prepareReminderWindow,
  saveFloatWindowBounds,
  showMainWindow,
  showReminder,
  toggleMainWindowMaximize,
  toggleFloatWindow,
};
