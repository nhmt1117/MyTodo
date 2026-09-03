const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

function loadScheduler(items, behavior = "show") {
  const schedulerPath = require.resolve("../src/main/reminderScheduler");
  delete require.cache[schedulerPath];
  const marks = [];
  const instances = [];

  class FakeNotification extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      instances.push(this);
    }

    static isSupported() {
      return true;
    }

    show() {
      if (behavior === "show") this.emit("show", {});
      if (behavior === "failed") this.emit("failed", {}, "test failure");
      if (behavior === "throw") throw new Error("test failure");
    }
  }

  const todoStore = {
    getTodoList: () => items,
    markRemindersSent: (entries) => marks.push(entries),
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { Notification: FakeNotification };
    if (request === "./todoStore") return todoStore;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { scheduler: require(schedulerPath), marks, instances };
  } finally {
    Module._load = originalLoad;
  }
}

function task() {
  return {
    id: 1,
    text: "发布 MyTodo",
    date: "2026-09-03",
    remind: true,
    remindTime: "09:00",
    muteRemind: false,
    archived: false,
    isCycle: false,
    lastReminderKey: "",
  };
}

test("scheduler records a reminder only after Electron shows it", () => {
  const { scheduler, marks, instances } = loadScheduler([task()]);
  const sent = scheduler.checkReminders(new Date(2026, 8, 3, 9, 0));

  assert.deepEqual(sent, [{ id: 1, key: "once:2026-09-03:09:00" }]);
  assert.deepEqual(marks, [[{ id: 1, key: "once:2026-09-03:09:00" }]]);
  assert.match(instances[0].options.icon, /MyTodo\.ico$/);
});

test("scheduler leaves failed notifications eligible for the next check", () => {
  const { scheduler, marks, instances } = loadScheduler([task()], "failed");
  const now = new Date(2026, 8, 3, 9, 0);

  scheduler.checkReminders(now);
  scheduler.checkReminders(now);

  assert.equal(instances.length, 2);
  assert.deepEqual(marks, []);
});

test("scheduler keeps direct show failures eligible for retry", (t) => {
  t.mock.method(console, "warn", () => {});
  const { scheduler, marks, instances } = loadScheduler([task()], "throw");
  const now = new Date(2026, 8, 3, 9, 0);

  assert.deepEqual(scheduler.checkReminders(now), []);
  assert.deepEqual(scheduler.checkReminders(now), []);
  assert.equal(instances.length, 2);
  assert.deepEqual(marks, []);
});
