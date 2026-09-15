const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function defaultConfig(overrides = {}) {
  return {
    weekStartMon: true,
    weeklySummary: false,
    dailySummary: false,
    dailySummaryTime: "09:00",
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
    lastDailySummaryDate: "",
    lastWeeklySummaryKey: "",
    ...overrides,
  };
}

function loadScheduler(items, configOverrides = {}) {
  const schedulerPath = require.resolve("../src/main/reminderScheduler");
  delete require.cache[schedulerPath];
  const marks = [];
  const summaryMarks = [];
  const config = defaultConfig(configOverrides);
  const todoStore = {
    getTodoList: () => items,
    markRemindersSent: (entries) => marks.push(entries),
  };
  const configStore = {
    getGlobalConfig: () => ({ ...config }),
    markSummarySent: (kind, key) => {
      summaryMarks.push({ kind, key });
      if (kind === "daily") config.lastDailySummaryDate = key;
      if (kind === "weekly") config.lastWeeklySummaryKey = key;
      return true;
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "./todoStore") return todoStore;
    if (request === "./config") return configStore;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { scheduler: require(schedulerPath), marks, summaryMarks };
  } finally {
    Module._load = originalLoad;
  }
}

function task(overrides = {}) {
  return {
    id: 1,
    text: "发布 MyTodo",
    desc: "上传安装包并核对哈希",
    date: "2026-09-03",
    priority: "high",
    remind: true,
    dueTime: "09:00",
    remindTime: "09:00",
    reminderMode: "custom",
    customReminderOffsets: [0],
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

test("scheduler records a task reminder after the custom presenter accepts it", () => {
  const { scheduler, marks } = loadScheduler([task()]);
  const presented = [];
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 9, 0), (candidate) => {
    presented.push(candidate);
    return true;
  });
  const key = "once:2026-09-03:09:00:0";
  assert.deepEqual(sent, [{ id: 1, key, kind: "task" }]);
  assert.deepEqual(marks, [[{ id: 1, key }]]);
  assert.equal(presented[0].body, "发布 MyTodo");
  assert.equal(presented[0].description, "上传安装包并核对哈希");
  assert.equal(presented[0].reason, "截止时间");
});

test("scheduler retries when the presenter rejects or throws", (t) => {
  t.mock.method(console, "warn", () => {});
  const { scheduler, marks } = loadScheduler([task()]);
  const now = new Date(2026, 8, 3, 9, 0);
  let rejected = 0;
  let failed = 0;
  assert.deepEqual(scheduler.checkReminders(now, () => { rejected += 1; return false; }), []);
  assert.deepEqual(scheduler.checkReminders(now, () => { rejected += 1; return false; }), []);
  assert.deepEqual(scheduler.checkReminders(now, () => { failed += 1; throw new Error("test"); }), []);
  assert.equal(rejected, 2);
  assert.equal(failed, 1);
  assert.deepEqual(marks, []);
});

test("quiet hours defer all task and summary reminders", () => {
  const { scheduler, marks, summaryMarks } = loadScheduler(
    [task({ date: "2026-09-04" })],
    { weeklySummary: true, quietHoursEnabled: true },
  );
  let attempts = 0;
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 23, 0), () => {
    attempts += 1;
    return true;
  });
  assert.deepEqual(sent, []);
  assert.equal(attempts, 0);
  assert.deepEqual(marks, []);
  assert.deepEqual(summaryMarks, []);
});

test("weekly summary stacks task entries and covers the daily digest", () => {
  const { scheduler, summaryMarks } = loadScheduler(
    [
      task({ date: "2026-09-05", remind: false }),
      task({ id: 2, text: "核对发布包", date: "2026-09-06", remind: false }),
    ],
    { weeklySummary: true, dailySummary: true, dailySummaryTime: "09:00" },
  );
  const presented = [];
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 8, 0), (candidate) => {
    presented.push(candidate);
    return true;
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(presented.map((entry) => entry.summaryKind), ["weekly"]);
  assert.equal(presented[0].kind, "summary");
  assert.equal(presented[0].description, "09-05 发布 MyTodo\n09-06 核对发布包");
  assert.deepEqual(summaryMarks, [
    { kind: "weekly", key: "2026-08-31" },
    { kind: "daily", key: "2026-09-03" },
  ]);
});

test("reminder service reports its actual lifecycle and last check", () => {
  const { scheduler } = loadScheduler([]);
  assert.equal(scheduler.getReminderServiceStatus().running, false);
  scheduler.startReminderScheduler({ showReminder: () => true });
  const running = scheduler.getReminderServiceStatus();
  assert.equal(running.running, true);
  assert.match(running.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(running.lastCheckAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(running.lastError, "");
  assert.equal(running.intervalSeconds, 30);
  assert.equal(running.lookaheadSeconds, 60);
  assert.equal(running.precisionSeconds, 1);
  scheduler.stopReminderScheduler();
  assert.equal(scheduler.getReminderServiceStatus().running, false);
});

test("reminder service reports quiet-hours deferral and its resume time", () => {
  const { scheduler } = loadScheduler([], {
    quietHoursEnabled: true,
    quietStart: "22:00",
    quietEnd: "08:00",
  });
  const lateNight = scheduler.getReminderServiceStatus(new Date(2026, 8, 3, 23, 30));
  assert.equal(lateNight.quietHoursActive, true);
  assert.equal(lateNight.quietHoursResumeAt, new Date(2026, 8, 4, 8, 0).toISOString());

  const morning = scheduler.getReminderServiceStatus(new Date(2026, 8, 3, 7, 30));
  assert.equal(morning.quietHoursActive, true);
  assert.equal(morning.quietHoursResumeAt, new Date(2026, 8, 3, 8, 0).toISOString());

  const daytime = scheduler.getReminderServiceStatus(new Date(2026, 8, 3, 12, 0));
  assert.equal(daytime.quietHoursActive, false);
  assert.equal(daytime.quietHoursResumeAt, "");
});

test("coarse scans queue reminders and the precision queue fires them on time", () => {
  const { scheduler, marks } = loadScheduler([task()]);
  const queued = scheduler.queueUpcomingReminders(new Date(2026, 8, 3, 8, 59, 20));
  assert.equal(queued.length, 1);
  assert.equal(scheduler.getReminderServiceStatus().queuedReminderCount, 1);

  let attempts = 0;
  assert.deepEqual(
    scheduler.runPrecisionQueue(new Date(2026, 8, 3, 8, 59, 59), () => {
      attempts += 1;
      return true;
    }),
    [],
  );
  assert.equal(attempts, 0);

  const sent = scheduler.runPrecisionQueue(new Date(2026, 8, 3, 9, 0), () => {
    attempts += 1;
    return true;
  });
  const key = "once:2026-09-03:09:00:0";
  assert.deepEqual(sent, [{ id: 1, key, kind: "task" }]);
  assert.deepEqual(marks, [[{ id: 1, key }]]);
  assert.equal(attempts, 1);
  assert.equal(scheduler.getReminderServiceStatus().queuedReminderCount, 0);
});

test("scheduler presents an incomplete overdue task once for the current day", () => {
  const overdue = task({
    date: "2026-09-02",
  });
  const { scheduler, marks } = loadScheduler([overdue]);
  const presented = [];
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 8, 0), (candidate) => {
    presented.push(candidate);
    return true;
  });
  assert.deepEqual(sent, [{ id: 1, key: "overdue:2026-09-03", kind: "task" }]);
  assert.equal(presented[0].reason, "已逾期 1 天");
  assert.deepEqual(marks, [[{ id: 1, key: "overdue:2026-09-03" }]]);
});
