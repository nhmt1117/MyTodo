(function attachTodoRecurrence(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.todoRecurrence = api;
})(typeof globalThis === "object" ? globalThis : this, function createTodoRecurrence() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
  }

  function normalizeTime(value, fallback = "09:00") {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return fallback;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : fallback;
  }

  function shiftMonthToStart(dateValue, delta) {
    const date = new Date(dateValue);
    const amount = Number(delta);
    if (Number.isNaN(date.getTime()) || !Number.isInteger(amount)) return null;

    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  }

  function getCycleStart(item) {
    const explicitStart = parseLocalDate(item && item.date);
    if (explicitStart) return explicitStart;

    const createdAt = new Date(item && item.createdAt);
    return Number.isNaN(createdAt.getTime()) ? null : parseLocalDate(formatLocalDate(createdAt));
  }

  function toUtcDayNumber(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
  }

  function occursOnDate(item, dateValue) {
    if (!item || !item.isCycle || item.archived) return false;

    const target = parseLocalDate(dateValue);
    const start = getCycleStart(item);
    if (!target || !start || target < start) return false;

    if (item.cycleType === "daily") return true;
    if (item.cycleType === "weekly") {
      return (toUtcDayNumber(target) - toUtcDayNumber(start)) % 7 === 0;
    }
    if (item.cycleType === "monthly") return target.getDate() === start.getDate();
    return false;
  }

  function getReminderCandidate(item, now = new Date()) {
    if (!item || !item.remind || item.muteRemind || item.archived) return null;

    const time = normalizeTime(item.remindTime);
    const [hour, minute] = time.split(":").map(Number);
    const today = formatLocalDate(now);
    let dueAt;
    let key;

    if (item.isCycle) {
      if (!occursOnDate(item, today)) return null;
      dueAt = parseLocalDate(today);
      key = `cycle:${today}:${time}`;
    } else {
      dueAt = parseLocalDate(item.date);
      if (!dueAt) return null;
      key = `once:${item.date}:${time}`;
    }

    dueAt.setHours(hour, minute, 0, 0);
    if (now < dueAt || item.lastReminderKey === key) return null;

    return {
      id: Number(item.id),
      key,
      title: "MyTodo 提醒",
      body: item.isCycle ? `${item.text}（循环任务）` : item.text,
    };
  }

  return {
    formatLocalDate,
    getReminderCandidate,
    normalizeTime,
    occursOnDate,
    parseLocalDate,
    shiftMonthToStart,
  };
});
