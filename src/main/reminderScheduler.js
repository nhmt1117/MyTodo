const {
  formatLocalDate,
  getNextOccurrenceDate,
  getReminderCandidate,
  getUpcomingReminderEntries,
  normalizeTime,
  parseLocalDate,
} = require("../shared/recurrence");
const { getGlobalConfig, markSummarySent } = require("./config");
const todoStore = require("./todoStore");

const CHECK_INTERVAL_MS = 30 * 1000;
const LOOKAHEAD_MS = 60 * 1000;
const PRECISION_INTERVAL_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let scanTimer = null;
let precisionTimer = null;
const precisionQueue = new Map();
let showReminder = () => false;
let schedulerRunning = false;
let startedAt = "";
let lastCheckAt = "";
let nextCheckAt = "";
let lastError = "";
let lastClockSignature = "";
let lastRecoveryReason = "";

function getMinutesOfDay(time) {
  const [hour, minute] = normalizeTime(time).split(":").map(Number);
  return hour * 60 + minute;
}

function isWithinQuietHours(now, config) {
  if (!config.quietHoursEnabled) return false;
  const start = getMinutesOfDay(config.quietStart);
  const end = getMinutesOfDay(config.quietEnd);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function getQuietHoursResumeAt(now, config) {
  if (!isWithinQuietHours(now, config)) return "";

  const [hour, minute] = normalizeTime(config.quietEnd).split(":").map(Number);
  const resumeAt = new Date(now);
  resumeAt.setHours(hour, minute, 0, 0);
  if (resumeAt <= now) resumeAt.setDate(resumeAt.getDate() + 1);
  return resumeAt.toISOString();
}

function getWeekStartKey(now, weekStartMon = true) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = weekStartMon ? (day === 0 ? -6 : 1 - day) : -day;
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

function getTaskDueDate(item, now) {
  if (!item.isCycle) return parseLocalDate(item.date);
  return getNextOccurrenceDate(item, now);
}

function getUpcomingTasks(items, now, maximumDays) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return items
    .filter((item) => !item.archived)
    .map((item) => ({ item, dueDate: getTaskDueDate(item, start) }))
    .filter(({ dueDate }) => dueDate && dueDate >= start)
    .map(({ item, dueDate }) => ({
      item,
      dueDate,
      daysUntil: Math.floor((dueDate.getTime() - start.getTime()) / DAY_MS),
    }))
    .filter(({ daysUntil }) => daysUntil <= maximumDays)
    .sort((left, right) => left.dueDate - right.dueDate);
}

function createSummaryCandidate(kind, key, entries, config) {
  const isWeekly = kind === "weekly";
  const visibleEntries = entries.slice(0, 4);
  const description = visibleEntries
    .map(({ item, dueDate }) => `${formatLocalDate(dueDate).slice(5)} ${item.text}`)
    .join("\n");
  const remaining = Math.max(0, entries.length - visibleEntries.length);
  return {
    id: 0,
    key: `summary:${kind}:${key}`,
    kind: "summary",
    summaryKind: kind,
    summaryKey: key,
    title: "MyTodo 提醒",
    body: isWeekly ? `未来 7 天有 ${entries.length} 项任务截止` : `今日任务摘要 · ${entries.length} 项需关注`,
    description: `${description}${remaining ? `\n另有 ${remaining} 项` : ""}`,
    dueDate: "",
    dueTime: "",
    remindTime: "",
    reason: isWeekly ? "每周概览" : `每日 ${config.dailySummaryTime}`,
    priority: entries.some(({ item }) => item.priority === "high") ? "high" : "mid",
    isCycle: false,
    cycleType: "",
  };
}

function getSummaryCandidates(now, items, config) {
  const candidates = [];
  const today = formatLocalDate(now);
  const upcomingWeek = getUpcomingTasks(items, now, 7);
  const weekKey = getWeekStartKey(now, config.weekStartMon);
  const weeklyDue =
    config.weeklySummary &&
    config.lastWeeklySummaryKey !== weekKey &&
    upcomingWeek.length > 0;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dailyEntries = upcomingWeek.filter(({ item, daysUntil }) => {
    return daysUntil <= 1 || (item.priority === "high" && daysUntil <= 3);
  });
  const dailyDue =
    config.dailySummary &&
    config.lastDailySummaryDate !== today &&
    currentMinutes >= getMinutesOfDay(config.dailySummaryTime) &&
    dailyEntries.length > 0;

  if (weeklyDue) {
    const weekly = createSummaryCandidate("weekly", weekKey, upcomingWeek, config);
    weekly.alsoMarkDailyKey = config.dailySummary && dailyEntries.length ? today : "";
    candidates.push(weekly);
  } else if (dailyDue) {
    candidates.push(createSummaryCandidate("daily", today, dailyEntries, config));
  }
  return candidates;
}

function presentCandidate(candidate, presenter) {
  try {
    return presenter(candidate) === true;
  } catch (error) {
    console.warn("自定义提醒窗口显示失败", error);
    return false;
  }
}

function checkReminders(now = new Date(), presenter = showReminder) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) return [];
  const config = getGlobalConfig();
  if (isWithinQuietHours(current, config)) return [];

  const items = todoStore.getTodoList();
  const sent = [];
  for (const item of items) {
    const candidate = getReminderCandidate(item, current);
    if (!candidate || !presentCandidate(candidate, presenter)) continue;
    todoStore.markRemindersSent([{ id: candidate.id, key: candidate.key }]);
    sent.push({ id: candidate.id, key: candidate.key, kind: candidate.kind });
  }

  for (const candidate of getSummaryCandidates(current, items, config)) {
    if (!presentCandidate(candidate, presenter)) continue;
    markSummarySent(candidate.summaryKind, candidate.summaryKey);
    if (candidate.alsoMarkDailyKey) markSummarySent("daily", candidate.alsoMarkDailyKey);
    sent.push({ id: candidate.id, key: candidate.key, kind: candidate.kind });
  }
  return sent;
}

function getPrecisionQueueKey(entry) {
  return `${entry.id}:${entry.key}`;
}

function queueUpcomingReminders(now = new Date(), items = todoStore.getTodoList()) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) return [];
  const through = new Date(current.getTime() + LOOKAHEAD_MS);
  const upcoming = items.flatMap((item) => getUpcomingReminderEntries(item, current, through));

  precisionQueue.clear();
  for (const entry of upcoming) {
    precisionQueue.set(getPrecisionQueueKey(entry), {
      ...entry,
      triggerAt: entry.reminderAt.getTime(),
    });
  }
  stopPrecisionTimerIfIdle();
  return [...precisionQueue.values()];
}

function stopPrecisionTimerIfIdle() {
  if (precisionQueue.size || !precisionTimer) return;
  clearInterval(precisionTimer);
  precisionTimer = null;
}

function runPrecisionQueue(now = new Date(), presenter = showReminder) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) return [];
  const dueEntries = [...precisionQueue.entries()].filter(([, entry]) => {
    return entry.triggerAt <= current.getTime();
  });
  if (!dueEntries.length) return [];

  dueEntries.forEach(([key]) => precisionQueue.delete(key));
  stopPrecisionTimerIfIdle();
  try {
    const sent = checkReminders(current, presenter);
    lastError = "";
    return sent;
  } catch (error) {
    lastError = String(error && error.message ? error.message : error);
    console.error("提醒精确触发失败", error);
    return [];
  }
}

function ensurePrecisionTimer() {
  if (precisionTimer || !precisionQueue.size) return;
  precisionTimer = setInterval(runPrecisionQueue, PRECISION_INTERVAL_MS);
  precisionTimer.unref?.();
}

function getClockSignature(now) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return `${timezone}:${now.getTimezoneOffset()}`;
}

function clearPrecisionSchedule() {
  precisionQueue.clear();
  if (precisionTimer) clearInterval(precisionTimer);
  precisionTimer = null;
}

function runScheduledCheck(now = new Date()) {
  const checkedAt = new Date(now);
  try {
    const clockSignature = getClockSignature(checkedAt);
    const previousCheckAt = Date.parse(lastCheckAt);
    const elapsed = Number.isNaN(previousCheckAt) ? 0 : checkedAt.getTime() - previousCheckAt;
    if (
      lastClockSignature &&
      (clockSignature !== lastClockSignature || elapsed < 0 || elapsed > CHECK_INTERVAL_MS + LOOKAHEAD_MS)
    ) {
      clearPrecisionSchedule();
      lastRecoveryReason = clockSignature !== lastClockSignature ? "timezone-change" : "clock-jump";
    }
    lastClockSignature = clockSignature;
    const sent = checkReminders(checkedAt);
    queueUpcomingReminders(checkedAt);
    ensurePrecisionTimer();
    lastCheckAt = checkedAt.toISOString();
    nextCheckAt = new Date(checkedAt.getTime() + CHECK_INTERVAL_MS).toISOString();
    lastError = "";
    return sent;
  } catch (error) {
    lastCheckAt = checkedAt.toISOString();
    nextCheckAt = new Date(checkedAt.getTime() + CHECK_INTERVAL_MS).toISOString();
    lastError = String(error && error.message ? error.message : error);
    console.error("提醒服务检查失败", error);
    return [];
  }
}

function refreshReminderSchedule(now = new Date(), reason = "manual") {
  clearPrecisionSchedule();
  lastRecoveryReason = String(reason || "manual");
  lastCheckAt = "";
  const current = new Date(now);
  if (!Number.isNaN(current.getTime())) lastClockSignature = getClockSignature(current);
  return runScheduledCheck(now);
}

function getReminderServiceStatus(now = new Date()) {
  const current = new Date(now);
  const config = getGlobalConfig();
  const quietHoursActive = !Number.isNaN(current.getTime()) &&
    isWithinQuietHours(current, config);
  return {
    running: schedulerRunning,
    startedAt,
    lastCheckAt,
    nextCheckAt,
    lastError,
    intervalSeconds: CHECK_INTERVAL_MS / 1000,
    lookaheadSeconds: LOOKAHEAD_MS / 1000,
    precisionSeconds: PRECISION_INTERVAL_MS / 1000,
    queuedReminderCount: precisionQueue.size,
    lastRecoveryReason,
    quietHoursActive,
    quietHoursResumeAt: quietHoursActive ? getQuietHoursResumeAt(current, config) : "",
  };
}

function startReminderScheduler(options = {}) {
  if (typeof options.showReminder === "function") showReminder = options.showReminder;
  if (schedulerRunning) return;

  schedulerRunning = true;
  startedAt = new Date().toISOString();
  runScheduledCheck();
  scanTimer = setInterval(runScheduledCheck, CHECK_INTERVAL_MS);
  scanTimer.unref?.();
}

function stopReminderScheduler() {
  schedulerRunning = false;
  nextCheckAt = "";
  precisionQueue.clear();
  if (scanTimer) clearInterval(scanTimer);
  if (precisionTimer) clearInterval(precisionTimer);
  scanTimer = null;
  precisionTimer = null;
  lastClockSignature = "";
}

module.exports = {
  checkReminders,
  getReminderServiceStatus,
  getSummaryCandidates,
  getWeekStartKey,
  isWithinQuietHours,
  queueUpcomingReminders,
  refreshReminderSchedule,
  runPrecisionQueue,
  runScheduledCheck,
  startReminderScheduler,
  stopReminderScheduler,
};
