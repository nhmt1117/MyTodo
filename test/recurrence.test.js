const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatLocalDate,
  getReminderCandidate,
  normalizeTime,
  occursOnDate,
  parseLocalDate,
  shiftMonthToStart,
} = require("../src/shared/recurrence");

function cycle(overrides = {}) {
  return {
    id: 1,
    text: "复盘",
    date: "2026-09-03",
    remind: true,
    remindTime: "09:00",
    muteRemind: false,
    archived: false,
    isCycle: true,
    cycleType: "daily",
    lastReminderKey: "",
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
  assert.equal(occursOnDate(cycle(), "2026-09-04"), true);
  assert.equal(occursOnDate(cycle({ cycleType: "weekly" }), "2026-09-10"), true);
  assert.equal(occursOnDate(cycle({ cycleType: "weekly" }), "2026-09-11"), false);
  assert.equal(occursOnDate(cycle({ cycleType: "monthly" }), "2026-10-03"), true);
  assert.equal(occursOnDate(cycle({ cycleType: "monthly" }), "2026-10-04"), false);
  assert.equal(occursOnDate(cycle(), "2026-09-02"), false);
});

test("archived cycles do not create calendar occurrences", () => {
  assert.equal(occursOnDate(cycle({ archived: true }), "2026-09-03"), false);
});

test("one-time reminders fire once after the selected time", () => {
  const item = cycle({
    isCycle: false,
    cycleType: "",
    date: "2026-09-03",
    text: "交付版本",
  });

  assert.equal(getReminderCandidate(item, new Date(2026, 8, 3, 8, 59)), null);
  const due = getReminderCandidate(item, new Date(2026, 8, 3, 9, 0));
  assert.equal(due.key, "once:2026-09-03:09:00");
  assert.equal(
    getReminderCandidate({ ...item, lastReminderKey: due.key }, new Date(2026, 8, 4, 9, 0)),
    null,
  );
});


test("snoozed reminders wait until their persisted delay expires", () => {
  const item = cycle({
    isCycle: false,
    cycleType: "",
    date: "2026-09-03",
    text: "延后任务",
    lastReminderKey: "once:2026-09-03:09:00",
    snoozedReminderKey: "once:2026-09-03:09:00",
    snoozedUntil: "2026-09-03T09:05:00+08:00",
  });

  assert.equal(getReminderCandidate(item, new Date("2026-09-03T09:04:59+08:00")), null);
  const due = getReminderCandidate(item, new Date("2026-09-03T09:05:00+08:00"));
  assert.equal(due.key, item.snoozedReminderKey);
  assert.equal(due.isSnoozed, true);
  assert.equal(due.dueDate, "2026-09-03");
  assert.equal(due.remindTime, "09:00");
});
test("cycle reminders fire at most once for each occurrence", () => {
  const item = cycle({ cycleType: "weekly" });
  const due = getReminderCandidate(item, new Date(2026, 8, 10, 9, 0));
  assert.equal(due.key, "cycle:2026-09-10:09:00");
  assert.equal(
    getReminderCandidate({ ...item, lastReminderKey: due.key }, new Date(2026, 8, 10, 12, 0)),
    null,
  );
  assert.equal(getReminderCandidate(item, new Date(2026, 8, 11, 12, 0)), null);
});

test("muted, disabled and archived reminders stay silent", () => {
  const now = new Date(2026, 8, 3, 12, 0);
  assert.equal(getReminderCandidate(cycle({ muteRemind: true }), now), null);
  assert.equal(getReminderCandidate(cycle({ remind: false }), now), null);
  assert.equal(getReminderCandidate(cycle({ archived: true }), now), null);
});
