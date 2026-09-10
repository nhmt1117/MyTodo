const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadScheduler(items) {
  const schedulerPath = require.resolve("../src/main/reminderScheduler");
  delete require.cache[schedulerPath];
  const marks = [];
  const todoStore = {
    getTodoList: () => items,
    markRemindersSent: (entries) => marks.push(entries),
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "./todoStore") return todoStore;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { scheduler: require(schedulerPath), marks };
  } finally {
    Module._load = originalLoad;
  }
}

function task() {
  return {
    id: 1,
    text: "发布 MyTodo",
    desc: "上传安装包并核对哈希",
    date: "2026-09-03",
    priority: "high",
    remind: true,
    remindTime: "09:00",
    muteRemind: false,
    archived: false,
    isCycle: false,
    cycleType: "",
    lastReminderKey: "",
  };
}

test("scheduler records a reminder after the custom presenter accepts it", () => {
  const { scheduler, marks } = loadScheduler([task()]);
  const presented = [];
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 9, 0), (candidate) => {
    presented.push(candidate);
    return true;
  });

  assert.deepEqual(sent, [{ id: 1, key: "once:2026-09-03:09:00" }]);
  assert.deepEqual(marks, [[{ id: 1, key: "once:2026-09-03:09:00" }]]);
  assert.equal(presented[0].body, "发布 MyTodo");
  assert.equal(presented[0].description, "上传安装包并核对哈希");
  assert.equal(presented[0].priority, "high");
});

test("scheduler retries when the custom presenter rejects a reminder", () => {
  const { scheduler, marks } = loadScheduler([task()]);
  const now = new Date(2026, 8, 3, 9, 0);
  let attempts = 0;
  const reject = () => {
    attempts += 1;
    return false;
  };

  assert.deepEqual(scheduler.checkReminders(now, reject), []);
  assert.deepEqual(scheduler.checkReminders(now, reject), []);
  assert.equal(attempts, 2);
  assert.deepEqual(marks, []);
});

test("scheduler keeps presenter failures eligible for retry", (t) => {
  t.mock.method(console, "warn", () => {});
  const { scheduler, marks } = loadScheduler([task()]);
  const now = new Date(2026, 8, 3, 9, 0);
  let attempts = 0;
  const fail = () => {
    attempts += 1;
    throw new Error("test failure");
  };

  assert.deepEqual(scheduler.checkReminders(now, fail), []);
  assert.deepEqual(scheduler.checkReminders(now, fail), []);
  assert.equal(attempts, 2);
  assert.deepEqual(marks, []);
});