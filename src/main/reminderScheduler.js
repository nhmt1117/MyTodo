const { getReminderCandidate } = require("../shared/recurrence");
const todoStore = require("./todoStore");

const CHECK_INTERVAL_MS = 30 * 1000;

let timer = null;
let showReminder = () => false;

function checkReminders(now = new Date(), presenter = showReminder) {
  const sent = [];
  for (const item of todoStore.getTodoList()) {
    const candidate = getReminderCandidate(item, now);
    if (!candidate) continue;

    let accepted = false;
    try {
      accepted = presenter(candidate) === true;
    } catch (error) {
      console.warn("自定义提醒窗口显示失败", error);
    }
    if (!accepted) continue;

    todoStore.markRemindersSent([{ id: candidate.id, key: candidate.key }]);
    sent.push({ id: candidate.id, key: candidate.key });
  }

  return sent;
}

function startReminderScheduler(options = {}) {
  if (typeof options.showReminder === "function") {
    showReminder = options.showReminder;
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