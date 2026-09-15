const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatLocalDate,
  getReminderCandidate,
  getReminderOffsets,
  getReminderSchedule,
  getUpcomingReminderEntries,
  normalizeTime,
  occursOnDate,
  parseLocalDate,
  shiftMonthToStart,
} = require("../src/shared/recurrence");

function task(overrides = {}) {
  return {
    id: 1,
    text: "复盘",
    desc: "",
    date: "2026-09-03",
    dueTime: "09:00",
    remindTime: "09:00",
    priority: "mid",
    remind: true,
    reminderMode: "auto",
    customReminderOffsets: [],
    muteRemind: false,
    archived: false,
    isCycle: false,
    cycleType: "",
    lastReminderKey: "",
    sentReminderKeys: [],
    snoozedReminderKey: "",
    snoozedUntil: "",
    ...overrides,
  };
}

test("validates local dates and reminder times", () => {
  assert.equal(parseLocalDate("2026-02-29"), null);
  assert.equal(parseLocalDate("2028-02-29").getDate(), 29);
  assert.equal(normalizeTime("23:59"), "23:59");
  assert.equal(normalizeTime("24:00"), "09:00");
});

test("calendar month navigation never skips a month from the 29th through 31st", () => {
  assert.equal(formatLocalDate(shiftMonthToStart(new Date(2026, 0, 31), 1)), "2026-02-01");
  assert.equal(formatLocalDate(shiftMonthToStart(new Date(2024, 1, 29), 1)), "2024-03-01");
  assert.equal(formatLocalDate(shiftMonthToStart(new Date(2026, 11, 31), 1)), "2027-01-01");
  assert.equal(shiftMonthToStart("invalid", 1), null);
});

test("daily, weekly and monthly cycles use the start date as anchor", () => {
  const cycle = task({ isCycle: true, cycleType: "daily" });
  assert.equal(occursOnDate(cycle, "2026-09-04"), true);
  assert.equal(occursOnDate({ ...cycle, cycleType: "weekly" }, "2026-09-10"), true);
  assert.equal(occursOnDate({ ...cycle, cycleType: "weekly" }, "2026-09-11"), false);
  assert.equal(occursOnDate({ ...cycle, cycleType: "monthly" }, "2026-10-03"), true);
  assert.equal(occursOnDate({ ...cycle, cycleType: "monthly" }, "2026-10-04"), false);
  assert.equal(occursOnDate(cycle, "2026-09-02"), false);
  assert.equal(occursOnDate({ ...cycle, archived: true }, "2026-09-03"), false);
});

test("priority maps to gentle, standard and strong reminder nodes", () => {
  assert.deepEqual(getReminderOffsets(task({ priority: "low" })), [1440, 0]);
  assert.deepEqual(getReminderOffsets(task({ priority: "mid" })), [4320, 1440, 0]);
  assert.deepEqual(getReminderOffsets(task({ priority: "high" })), [10080, 4320, 1440, 120, 0]);
  assert.deepEqual(getReminderOffsets(task({
    reminderMode: "custom",
    customReminderOffsets: [120, 0, 120, -1, 999999],
  })), [120, 0]);
});

test("frequent cycles discard reminder nodes that would overlap occurrences", () => {
  assert.deepEqual(getReminderOffsets(task({
    isCycle: true,
    cycleType: "daily",
    priority: "high",
  })), [120, 0]);
  assert.deepEqual(getReminderOffsets(task({
    isCycle: true,
    cycleType: "weekly",
    priority: "high",
  })), [4320, 1440, 120, 0]);
});

test("one-time reminders support exact-time delivery and legacy sent keys", () => {
  const item = task({
    text: "交付版本",
    reminderMode: "custom",
    customReminderOffsets: [0],
  });
  assert.equal(getReminderCandidate(item, new Date(2026, 8, 3, 8, 59)), null);
  const due = getReminderCandidate(item, new Date(2026, 8, 3, 9, 0));
  assert.equal(due.key, "once:2026-09-03:09:00:0");
  assert.equal(due.reason, "截止时间");
  assert.equal(
    getReminderCandidate({ ...item, lastReminderKey: "once:2026-09-03:09:00" }, new Date(2026, 8, 3, 9, 1)),
    null,
  );
});

test("upcoming reminder entries cover the next scan window without firing early", () => {
  const item = task({
    reminderMode: "custom",
    customReminderOffsets: [0],
  });
  const entries = getUpcomingReminderEntries(
    item,
    new Date(2026, 8, 3, 8, 59, 20),
    new Date(2026, 8, 3, 9, 0, 20),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "once:2026-09-03:09:00:0");
  assert.equal(entries[0].reminderAt.getTime(), new Date(2026, 8, 3, 9, 0).getTime());
  assert.deepEqual(
    getUpcomingReminderEntries(
      { ...item, sentReminderKeys: [entries[0].key] },
      new Date(2026, 8, 3, 8, 59, 20),
      new Date(2026, 8, 3, 9, 0, 20),
    ),
    [],
  );
});

test("overdue one-time tasks remind once per day", () => {
  const item = task({
    date: "2026-09-02",
    reminderMode: "custom",
    customReminderOffsets: [0],
  });
  const first = getReminderCandidate(item, new Date(2026, 8, 3, 8, 0));
  assert.equal(first.key, "overdue:2026-09-03");
  assert.equal(first.reason, "已逾期 1 天");
  assert.equal(
    getReminderCandidate({ ...item, sentReminderKeys: [...item.sentReminderKeys, first.key] }, new Date(2026, 8, 3, 18, 0)),
    null,
  );
  const nextDay = getReminderCandidate(
    { ...item, sentReminderKeys: [...item.sentReminderKeys, first.key] },
    new Date(2026, 8, 4, 8, 0),
  );
  assert.equal(nextDay.key, "overdue:2026-09-04");
  assert.equal(nextDay.reason, "已逾期 2 天");
});

test("overdue reminders can be snoozed and queued precisely", () => {
  const key = "overdue:2026-09-03";
  const item = task({
    date: "2026-09-01",
    sentReminderKeys: [key],
    lastReminderKey: key,
    snoozedReminderKey: key,
    snoozedUntil: "2026-09-03T09:15:00+08:00",
  });
  assert.equal(getReminderCandidate(item, new Date("2026-09-03T09:14:59+08:00")), null);
  const entries = getUpcomingReminderEntries(
    item,
    new Date("2026-09-03T09:14:20+08:00"),
    new Date("2026-09-03T09:15:20+08:00"),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, key);
  const due = getReminderCandidate(item, new Date("2026-09-03T09:15:00+08:00"));
  assert.equal(due.key, key);
  assert.equal(due.isSnoozed, true);
  assert.equal(due.reason, "延后提醒");
});

test("a late startup delivers only the latest due milestone", () => {
  const item = task({ priority: "high" });
  const schedule = getReminderSchedule(item, item.date);
  assert.equal(schedule.length, 5);
  const due = getReminderCandidate(item, new Date(2026, 8, 3, 9, 0));
  assert.equal(due.offsetMinutes, 0);
  assert.equal(
    getReminderCandidate({ ...item, sentReminderKeys: [due.key] }, new Date(2026, 8, 3, 9, 1)),
    null,
  );
});

test("snoozed reminders wait until their persisted delay expires", () => {
  const key = "once:2026-09-03:09:00:0";
  const item = task({
    text: "延后任务",
    reminderMode: "custom",
    customReminderOffsets: [0],
    lastReminderKey: key,
    sentReminderKeys: [key],
    snoozedReminderKey: key,
    snoozedUntil: "2026-09-03T09:15:00+08:00",
  });
  assert.equal(getReminderCandidate(item, new Date("2026-09-03T09:14:59+08:00")), null);
  const due = getReminderCandidate(item, new Date("2026-09-03T09:15:00+08:00"));
  assert.equal(due.key, key);
  assert.equal(due.isSnoozed, true);
  assert.equal(due.reason, "延后提醒");
});

test("cycle reminders fire once for each milestone and occurrence", () => {
  const item = task({
    isCycle: true,
    cycleType: "weekly",
    reminderMode: "custom",
    customReminderOffsets: [0],
  });
  const due = getReminderCandidate(item, new Date(2026, 8, 10, 9, 0));
  assert.equal(due.key, "cycle:2026-09-10:09:00:0");
  assert.equal(
    getReminderCandidate({ ...item, sentReminderKeys: [due.key] }, new Date(2026, 8, 10, 12, 0)),
    null,
  );
  assert.equal(getReminderCandidate(item, new Date(2026, 8, 11, 12, 0)), null);
});

test("muted, disabled and archived reminders stay silent", () => {
  const now = new Date(2026, 8, 3, 12, 0);
  assert.equal(getReminderCandidate(task({ muteRemind: true }), now), null);
  assert.equal(getReminderCandidate(task({ remind: false }), now), null);
  assert.equal(getReminderCandidate(task({ archived: true }), now), null);
});
