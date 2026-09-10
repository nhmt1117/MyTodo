const root = document.querySelector("#reminderRoot");
const deadlineTime = document.querySelector("#deadlineTime");
const taskTitle = document.querySelector("#taskTitle");
const taskDescription = document.querySelector("#taskDescription");
const queueStatus = document.querySelector("#queueStatus");
const actionButtons = Array.from(document.querySelectorAll("button"));


let currentReminder = null;
let actionPending = false;

function formatDeadline(payload) {
  const dateValue = String(payload.dueDate || "");
  const timeValue = String(payload.remindTime || "");
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!parts) return [dateValue, timeValue].filter(Boolean).join(" ") || "未设置";
  return `${parts[1]}/${parts[2]}/${parts[3]} ${timeValue}`.trim();
}

function setActionPending(pending) {
  actionPending = pending;
  actionButtons.forEach((button) => {
    button.disabled = pending;
  });
}

function renderReminder(payload) {
  if (!payload || typeof payload !== "object") return;

  currentReminder = { id: Number(payload.id), key: String(payload.key || "") };
  root.dataset.priority = ["low", "mid", "high"].includes(payload.priority)
    ? payload.priority
    : "mid";
  taskTitle.textContent = String(payload.body || "待办提醒");
  taskDescription.textContent = String(payload.description || "").trim() || "无备注内容";
  deadlineTime.textContent = formatDeadline(payload);

  const remainingCount = Math.max(0, Number(payload.remainingCount) || 0);
  queueStatus.textContent = remainingCount ? `另有 ${remainingCount} 条待提醒` : "";
  queueStatus.hidden = remainingCount === 0;
  setActionPending(false);

  root.classList.remove("is-entering");
  requestAnimationFrame(() => root.classList.add("is-entering"));
}

async function submitAction(action) {
  if (!currentReminder || actionPending) return;
  setActionPending(true);
  try {
    const accepted = await window.electronAPI.reminderAction(action, currentReminder);
    if (!accepted) setActionPending(false);
  } catch (_error) {
    setActionPending(false);
  }
}

document.querySelector("#dismissButton").onclick = () => submitAction("dismiss");
document.querySelector("#acknowledgeButton").onclick = () => submitAction("dismiss");
document.querySelector("#snoozeButton").onclick = () => submitAction("snooze");
root.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  submitAction("open");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") submitAction("dismiss");
});

window.electronAPI.onReminderDisplay(renderReminder);