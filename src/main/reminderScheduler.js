const { Notification } = require("electron");
const path = require("path");
const { getReminderCandidate } = require("../shared/recurrence");
const todoStore = require("./todoStore");

const APP_ROOT = path.join(__dirname, "..", "..");
const CHECK_INTERVAL_MS = 30 * 1000;

let timer = null;
let showMainWindow = () => {};
let warnedUnsupported = false;
const activeNotifications = new Set();
const pendingReminderKeys = new Set();

function releaseNotification(notification, key) {
  activeNotifications.delete(notification);
  pendingReminderKeys.delete(key);
}

function scheduleRelease(notification, key, delay) {
  const releaseTimer = setTimeout(() => releaseNotification(notification, key), delay);
  releaseTimer.unref?.();
  return releaseTimer;
}

function checkReminders(now = new Date()) {
  if (!Notification.isSupported()) {
    if (!warnedUnsupported) {
      console.warn("当前系统不支持 Electron 系统通知");
      warnedUnsupported = true;
    }
    return [];
  }

  const sent = [];
  for (const item of todoStore.getTodoList()) {
    const candidate = getReminderCandidate(item, now);
    if (!candidate || pendingReminderKeys.has(candidate.key)) continue;

    const notification = new Notification({
      title: candidate.title,
      body: candidate.body,
      icon: path.join(APP_ROOT, "MyTodo.ico"),
      timeoutType: "default",
    });
    notification.on("click", showMainWindow);
    activeNotifications.add(notification);
    pendingReminderKeys.add(candidate.key);

    // A native notification can fail asynchronously on Windows. Do not suppress a
    // future retry until Electron confirms that this instance reached the user.
    let releaseTimer = scheduleRelease(notification, candidate.key, CHECK_INTERVAL_MS * 2);
    notification.once("show", () => {
      clearTimeout(releaseTimer);
      todoStore.markRemindersSent([{ id: candidate.id, key: candidate.key }]);
      pendingReminderKeys.delete(candidate.key);
      releaseTimer = scheduleRelease(notification, candidate.key, 5 * 60 * 1000);
    });
    notification.once("failed", () => {
      clearTimeout(releaseTimer);
      releaseNotification(notification, candidate.key);
    });
    notification.once("close", () => {
      clearTimeout(releaseTimer);
      activeNotifications.delete(notification);
    });

    try {
      notification.show();
    } catch (error) {
      clearTimeout(releaseTimer);
      releaseNotification(notification, candidate.key);
      console.warn("系统通知显示失败", error);
      continue;
    }
    if (activeNotifications.has(notification)) {
      sent.push({ id: candidate.id, key: candidate.key });
    }
  }

  return sent;
}

function startReminderScheduler(options = {}) {
  if (typeof options.showMainWindow === "function") {
    showMainWindow = options.showMainWindow;
  }
  if (timer) return;

  checkReminders();
  timer = setInterval(checkReminders, CHECK_INTERVAL_MS);
}

function stopReminderScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  checkReminders,
  startReminderScheduler,
  stopReminderScheduler,
};
