(function attachTodoRecurrence(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.todoRecurrence = api;
})(typeof globalThis === "object" ? globalThis : this, function createTodoRecurrence() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const REMINDER_MODES = new Set(["auto", "gentle", "standard", "strong", "custom"]);
  const DEFAULT_REMINDER_OFFSETS = Object.freeze({
    gentle: Object.freeze([1440, 0]),
    standard: Object.freeze([4320, 1440, 0]),
    strong: Object.freeze([10080, 4320, 1440, 120, 0]),
  });

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

  function createLocalDateTime(dateValue, timeValue) {
    const date = parseLocalDate(dateValue);
    if (!date) return null;
    const [hour, minute] = normalizeTime(timeValue).split(":").map(Number);
    date.setHours(hour, minute, 0, 0);
    return date;
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

  function normalizeReminderMode(value) {
    return REMINDER_MODES.has(value) ? value : "auto";
  }

  function normalizeReminderOffsets(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((offset) => {
      return Number.isInteger(offset) && offset >= 0 && offset <= 30 * 24 * 60;
    }))].sort((left, right) => right - left);
  }

  function getEffectiveReminderMode(item) {
    const mode = normalizeReminderMode(item && item.reminderMode);
    if (mode !== "auto") return mode;
    if (item && item.priority === "high") return "strong";
    if (item && item.priority === "low") return "gentle";
    return "standard";
  }

  function getReminderOffsets(item) {
    const mode = getEffectiveReminderMode(item);
    let offsets = mode === "custom"
      ? normalizeReminderOffsets(item && item.customReminderOffsets)
      : [...DEFAULT_REMINDER_OFFSETS[mode]];
    if (!offsets.length) offsets = [0];

    if (item && item.isCycle && item.cycleType === "daily") {
      offsets = offsets.filter((offset) => offset <= 120);
    } else if (item && item.isCycle && item.cycleType === "weekly") {
      offsets = offsets.filter((offset) => offset < 10080);
    }
    return offsets.length ? offsets : [0];
  }

  function getReminderReason(offsetMinutes, isSnoozed = false) {
    if (isSnoozed) return "延后提醒";
    const offset = Number(offsetMinutes);
    if (offset === 0) return "截止时间";
    if (offset % 10080 === 0) return `提前 ${offset / 10080} 周`;
    if (offset % 1440 === 0) return `提前 ${offset / 1440} 天`;
    if (offset % 60 === 0) return `提前 ${offset / 60} 小时`;
    return `提前 ${offset} 分钟`;
  }

  function getReminderKey(item, occurrenceDate, dueTime, offsetMinutes) {
    const type = item && item.isCycle ? "cycle" : "once";
    return `${type}:${occurrenceDate}:${dueTime}:${Number(offsetMinutes)}`;
  }

  function getLegacyReminderKey(item, occurrenceDate, dueTime) {
    const type = item && item.isCycle ? "cycle" : "once";
    return `${type}:${occurrenceDate}:${dueTime}`;
  }

  function getReminderSchedule(item, occurrenceDate) {
    const date = String(occurrenceDate || item?.date || "");
    const dueTime = normalizeTime(item?.dueTime || item?.remindTime);
    const dueAt = createLocalDateTime(date, dueTime);
    if (!dueAt) return [];

    return getReminderOffsets(item).map((offsetMinutes) => ({
      key: getReminderKey(item, date, dueTime, offsetMinutes),
      legacyKey: getLegacyReminderKey(item, date, dueTime),
      occurrenceDate: date,
      dueTime,
      dueAt: new Date(dueAt),
      reminderAt: new Date(dueAt.getTime() - offsetMinutes * 60 * 1000),
      offsetMinutes,
      reason: getReminderReason(offsetMinutes),
    }));
  }

  function getNextOccurrenceDate(item, from = new Date()) {
    if (!item || !item.isCycle) return parseLocalDate(item && item.date);
    const cursor = new Date(from);
    if (Number.isNaN(cursor.getTime())) return null;
    cursor.setHours(0, 0, 0, 0);
    for (let offset = 0; offset <= 370; offset += 1) {
      const candidate = new Date(cursor);
      candidate.setDate(cursor.getDate() + offset);
      if (occursOnDate(item, formatLocalDate(candidate))) return candidate;
    }
    return null;
  }

  function parseReminderKey(key) {
    const match = /^(once|cycle):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}):(\d+)$/.exec(String(key || ""));
    if (!match) return null;
    return {
      type: match[1],
      occurrenceDate: match[2],
      dueTime: match[3],
      offsetMinutes: Number(match[4]),
    };
  }

  function buildCandidate(item, schedule, options = {}) {
    return {
      id: Number(item.id),
      key: schedule.key,
      kind: "task",
      title: "MyTodo 提醒",
      body: String(item.text || ""),
      description: String(item.desc || ""),
      dueDate: schedule.occurrenceDate,
      dueTime: schedule.dueTime,
      remindTime: schedule.dueTime,
      reason: options.reason || getReminderReason(schedule.offsetMinutes, options.isSnoozed),
      offsetMinutes: schedule.offsetMinutes,
      isSnoozed: !!options.isSnoozed,
      priority: ["low", "mid", "high"].includes(item.priority) ? item.priority : "mid",
      isCycle: !!item.isCycle,
      cycleType: item.isCycle ? String(item.cycleType || "") : "",
    };
  }

  function wasReminderSent(item, schedule) {
    const history = Array.isArray(item.sentReminderKeys) ? item.sentReminderKeys : [];
    if (history.includes(schedule.key) || item.lastReminderKey === schedule.key) return true;
    return schedule.offsetMinutes === 0 && item.lastReminderKey === schedule.legacyKey;
  }

  function createDueSchedule(item, key) {
    const occurrenceDate = String(item && item.date || "");
    const dueTime = normalizeTime(item && (item.dueTime || item.remindTime));
    const dueAt = createLocalDateTime(occurrenceDate, dueTime);
    if (!dueAt) return null;
    return {
      key: String(key || getReminderKey(item, occurrenceDate, dueTime, 0)),
      legacyKey: getLegacyReminderKey(item, occurrenceDate, dueTime),
      occurrenceDate,
      dueTime,
      dueAt,
      reminderAt: new Date(dueAt),
      offsetMinutes: 0,
      reason: getReminderReason(0),
    };
  }

  function getScheduleForReminderKey(item, key) {
    const parsed = parseReminderKey(key);
    if (parsed) {
      return getReminderSchedule(item, parsed.occurrenceDate).find((entry) => entry.key === key) || null;
    }
    return /^overdue:\d{4}-\d{2}-\d{2}$/.test(String(key || "")) && !item.isCycle
      ? createDueSchedule(item, key)
      : null;
  }

  function getSnoozedCandidate(item, now) {
    if (!item.snoozedReminderKey || !item.snoozedUntil) return null;
    const snoozedUntil = new Date(item.snoozedUntil);
    if (Number.isNaN(snoozedUntil.getTime()) || now < snoozedUntil) return null;
    const schedule = getScheduleForReminderKey(item, item.snoozedReminderKey);
    return schedule ? buildCandidate(item, schedule, { isSnoozed: true }) : null;
  }

  function getOverdueCandidate(item, now) {
    if (item.isCycle) return null;
    const dueDate = parseLocalDate(item.date);
    const today = parseLocalDate(formatLocalDate(now));
    if (!dueDate || !today || dueDate >= today) return null;

    const key = `overdue:${formatLocalDate(now)}`;
    const history = Array.isArray(item.sentReminderKeys) ? item.sentReminderKeys : [];
    if (history.includes(key) || item.lastReminderKey === key) return null;
    const schedule = createDueSchedule(item, key);
    if (!schedule) return null;
    const overdueDays = Math.max(1, toUtcDayNumber(today) - toUtcDayNumber(dueDate));
    return buildCandidate(item, schedule, { reason: `已逾期 ${overdueDays} 天` });
  }

  function getUpcomingReminderEntries(item, from = new Date(), through = new Date()) {
    if (!item || !item.remind || item.muteRemind || item.archived) return [];
    const current = new Date(from);
    const ending = new Date(through);
    if (
      Number.isNaN(current.getTime()) ||
      Number.isNaN(ending.getTime()) ||
      ending <= current
    ) {
      return [];
    }

    const entries = new Map();
    if (item.snoozedReminderKey && item.snoozedUntil) {
      const snoozedUntil = new Date(item.snoozedUntil);
      const schedule = getScheduleForReminderKey(item, item.snoozedReminderKey);
      if (
        schedule &&
        snoozedUntil > current &&
        snoozedUntil <= ending &&
        !Number.isNaN(snoozedUntil.getTime())
      ) {
        entries.set(schedule.key, {
          id: Number(item.id),
          key: schedule.key,
          kind: "task",
          reminderAt: snoozedUntil,
        });
      }
    }

    const addSchedule = (schedule) => {
      if (
        schedule.reminderAt > current &&
        schedule.reminderAt <= ending &&
        !wasReminderSent(item, schedule) &&
        !entries.has(schedule.key)
      ) {
        entries.set(schedule.key, {
          id: Number(item.id),
          key: schedule.key,
          kind: "task",
          reminderAt: new Date(schedule.reminderAt),
        });
      }
    };

    if (!item.isCycle) {
      getReminderSchedule(item, item.date).forEach(addSchedule);
    } else {
      const maxOffsetDays = Math.ceil(Math.max(...getReminderOffsets(item)) / 1440);
      const today = parseLocalDate(formatLocalDate(current));
      for (let dayOffset = 0; dayOffset <= maxOffsetDays + 1; dayOffset += 1) {
        const occurrence = new Date(today);
        occurrence.setDate(today.getDate() + dayOffset);
        const occurrenceDate = formatLocalDate(occurrence);
        if (!occursOnDate(item, occurrenceDate)) continue;
        getReminderSchedule(item, occurrenceDate).forEach(addSchedule);
      }
    }

    return [...entries.values()].sort((left, right) => left.reminderAt - right.reminderAt);
  }

  function getReminderCandidate(item, now = new Date()) {
    if (!item || !item.remind || item.muteRemind || item.archived) return null;
    const current = new Date(now);
    if (Number.isNaN(current.getTime())) return null;

    const snoozed = getSnoozedCandidate(item, current);
    if (snoozed) return snoozed;
    const snoozedUntil = new Date(item.snoozedUntil);
    if (item.snoozedReminderKey && !Number.isNaN(snoozedUntil.getTime()) && current < snoozedUntil) {
      return null;
    }

    if (!item.isCycle) {
      const taskDate = parseLocalDate(item.date);
      const currentDate = parseLocalDate(formatLocalDate(current));
      if (taskDate && currentDate && taskDate < currentDate) {
        return getOverdueCandidate(item, current);
      }
      const dueSchedules = getReminderSchedule(item, item.date)
        .filter((entry) => entry.reminderAt <= current)
        .sort((left, right) => left.reminderAt - right.reminderAt);
      const latest = dueSchedules.at(-1);
      return latest && !wasReminderSent(item, latest) ? buildCandidate(item, latest) : null;
    }

    const maxOffsetDays = Math.ceil(Math.max(...getReminderOffsets(item)) / 1440);
    const today = parseLocalDate(formatLocalDate(current));
    const candidates = [];
    for (let dayOffset = 0; dayOffset <= maxOffsetDays; dayOffset += 1) {
      const occurrence = new Date(today);
      occurrence.setDate(today.getDate() + dayOffset);
      const occurrenceDate = formatLocalDate(occurrence);
      if (!occursOnDate(item, occurrenceDate)) continue;
      const latest = getReminderSchedule(item, occurrenceDate)
        .filter((entry) => entry.reminderAt <= current)
        .sort((left, right) => left.reminderAt - right.reminderAt)
        .at(-1);
      if (latest && !wasReminderSent(item, latest)) candidates.push(latest);
    }
    candidates.sort((left, right) => left.dueAt - right.dueAt || left.offsetMinutes - right.offsetMinutes);
    return candidates[0] ? buildCandidate(item, candidates[0]) : null;
  }

  return {
    DEFAULT_REMINDER_OFFSETS,
    createLocalDateTime,
    formatLocalDate,
    getEffectiveReminderMode,
    getNextOccurrenceDate,
    getReminderCandidate,
    getReminderOffsets,
    getReminderReason,
    getReminderSchedule,
    getUpcomingReminderEntries,
    normalizeReminderMode,
    normalizeReminderOffsets,
    normalizeTime,
    occursOnDate,
    parseLocalDate,
    shiftMonthToStart,
  };
});
