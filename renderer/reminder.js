const root = document.querySelector("#reminderRoot");
const deadlineRow = document.querySelector("#deadlineRow");
const deadlineTime = document.querySelector("#deadlineTime");
const taskTitle = document.querySelector("#taskTitle");
const taskDescription = document.querySelector("#taskDescription");
const reminderReason = document.querySelector("#reminderReason");
const queueStatus = document.querySelector("#queueStatus");
const snoozeControl = document.querySelector("#snoozeControl");
const snoozeMenu = document.querySelector("#snoozeMenu");
const snoozeButton = document.querySelector("#snoozeButton");
const primaryActionButton = document.querySelector("#primaryActionButton");
const notificationSound = document.querySelector("#notificationSound");
const actionButtons = Array.from(document.querySelectorAll("button"));

let currentReminder = null;
let actionPending = false;
let lastSoundIdentity = "";
let autoCloseTimer = null;
let autoCloseSeconds = 0;

const DEFAULT_SNOOZE_MINUTES = 15;
const AUTO_CLOSE_SECONDS = 5;

function stopAutoCloseCountdown() {
  if (autoCloseTimer) clearInterval(autoCloseTimer);
  autoCloseTimer = null;
  autoCloseSeconds = 0;
  snoozeButton.textContent = DEFAULT_SNOOZE_MINUTES + " 分钟后";
}

function renderAutoCloseCountdown() {
  snoozeButton.textContent = DEFAULT_SNOOZE_MINUTES + " 分钟后（" + autoCloseSeconds + " 秒）";
}

function startAutoCloseCountdown(kind) {
  stopAutoCloseCountdown();
  if (kind !== "task") return;
  autoCloseSeconds = AUTO_CLOSE_SECONDS;
  renderAutoCloseCountdown();
  autoCloseTimer = setInterval(() => {
    autoCloseSeconds -= 1;
    renderAutoCloseCountdown();
    if (autoCloseSeconds > 0) return;
    stopAutoCloseCountdown();
    submitAction("snooze", { minutes: DEFAULT_SNOOZE_MINUTES });
  }, 1000);
}

function playNotificationSound(payload) {
  const identity = String(payload.id) + ":" + String(payload.key || "");
  if (payload.soundEnabled === false || identity === lastSoundIdentity) return;
  lastSoundIdentity = identity;
  notificationSound.volume = 0.58;
  notificationSound.currentTime = 0;
  const playback = notificationSound.play();
  if (playback && typeof playback.catch === "function") playback.catch(() => {});
}

function formatDeadline(payload) {
  const dateValue = String(payload.dueDate || "");
  const timeValue = String(payload.dueTime || payload.remindTime || "");
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!parts) return [dateValue, timeValue].filter(Boolean).join(" ") || "未设置";
  return parts[1] + "/" + parts[2] + "/" + parts[3] + (timeValue ? " " + timeValue : "");
}

function getTomorrowMorningDelay() {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return Math.max(1, Math.min(2880, Math.round((target.getTime() - now.getTime()) / 60000)));
}

function setActionPending(pending) {
  actionPending = pending;
  actionButtons.forEach((button) => {
    button.disabled = pending;
  });
}

function setSnoozeMenu(open) {
  snoozeMenu.hidden = !open;
  if (open) stopAutoCloseCountdown();
}

function renderReminder(payload) {
  if (!payload || typeof payload !== "object") return;
  const kind = payload.kind === "summary" ? "summary" : "task";
  const isNewReminder = !currentReminder ||
    currentReminder.id !== Number(payload.id) ||
    currentReminder.key !== String(payload.key || "");
  currentReminder = { id: Number(payload.id), key: String(payload.key || ""), kind };
  root.dataset.priority = ["low", "mid", "high"].includes(payload.priority) ? payload.priority : "mid";
  root.dataset.kind = kind;
  reminderReason.textContent = String(payload.reason || (kind === "summary" ? "任务概览" : "待办提醒"));
  taskTitle.textContent = String(payload.body || "待办提醒");
  taskDescription.textContent = String(payload.description || "").trim() || (kind === "summary" ? "暂无摘要内容" : "无备注");
  deadlineTime.textContent = formatDeadline(payload);
  deadlineRow.hidden = kind === "summary";
  snoozeControl.hidden = kind === "summary";
  primaryActionButton.textContent = kind === "summary" ? "打开 MyTodo" : "完成任务";
  const remainingCount = Math.max(0, Number(payload.remainingCount) || 0);
  queueStatus.textContent = remainingCount ? "另有 " + remainingCount + " 条提醒" : "";
  queueStatus.hidden = remainingCount === 0;
  if (isNewReminder) {
    setSnoozeMenu(false);
    setActionPending(false);
    root.classList.remove("is-entering");
    requestAnimationFrame(() => root.classList.add("is-entering"));
    playNotificationSound(payload);
    startAutoCloseCountdown(kind);
  }
}

async function submitAction(action, extra) {
  if (!currentReminder || actionPending) return;
  stopAutoCloseCountdown();
  setSnoozeMenu(false);
  setActionPending(true);
  try {
    const identity = Object.assign({}, currentReminder, extra || {});
    const accepted = await window.electronAPI.reminderAction(action, identity);
    if (!accepted) setActionPending(false);
  } catch (_error) {
    setActionPending(false);
  }
}

document.querySelector("#dismissButton").addEventListener("click", () => submitAction("dismiss"));
snoozeButton.addEventListener("click", () => submitAction("snooze", { minutes: DEFAULT_SNOOZE_MINUTES }));
document.querySelector("#snoozeMenuButton").addEventListener("click", (event) => {
  event.stopPropagation();
  if (!actionPending) setSnoozeMenu(snoozeMenu.hidden);
});
snoozeMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-minutes]");
  if (!button) return;
  const minutes = button.dataset.minutes === "tomorrow"
    ? getTomorrowMorningDelay()
    : Number(button.dataset.minutes);
  submitAction("snooze", { minutes });
});
primaryActionButton.addEventListener("click", () => {
  submitAction(currentReminder && currentReminder.kind === "summary" ? "open" : "complete");
});
root.addEventListener("click", (event) => {
  if (event.target.closest("button") || event.target.closest(".snooze-menu")) return;
  submitAction("open");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") submitAction("dismiss");
});
window.electronAPI.onReminderDisplay(renderReminder);
