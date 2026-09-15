const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadStore(directory) {
  const modulePath = require.resolve("../src/main/todoStore");
  delete require.cache[modulePath];
  const dataLocationModulePath = require.resolve("../src/main/dataLocation");
  delete require.cache[dataLocationModulePath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => directory } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("todo CRUD, archive, mute and reminder state persist independently", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-crud-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let store = loadStore(directory);
  store.loadTodoFile();
  assert.equal(store.addTodoItem({ text: "  " }), null);
  const limited = store.addTodoItem({ text: "T".repeat(100), desc: "D".repeat(700) });
  assert.equal(limited.text.length, 80);
  assert.equal(limited.desc.length, 500);
  const limitedUpdate = store.updateTodo({
    id: limited.id,
    text: "U".repeat(100),
    desc: "N".repeat(700),
  });
  assert.equal(limitedUpdate.text.length, 80);
  assert.equal(limitedUpdate.desc.length, 500);
  assert.equal(store.deleteTodo(limited.id), true);
  const item = store.addTodoItem({ text: "Test", date: "2026-09-03", remind: true });
  assert.equal(item.remindTime, "09:00");
  store.getTodoList()[0].text = "Changed clone";
  assert.equal(store.getTodoList()[0].text, "Test");
  assert.equal(store.updateTodo({ id: item.id, text: "Edited" }).text, "Edited");
  assert.equal(store.setArchived(item.id, true).archived, true);
  assert.equal(store.setArchived(item.id, false).archived, false);
  assert.equal(store.muteTodoRemind(item.id).muteRemind, true);
  assert.equal(store.addToToday(item.id).muteRemind, false);
  const reminderKey = "once:2026-09-03:09:00";
  store.markRemindersSent([{ id: item.id, key: reminderKey }]);
  const snoozed = store.snoozeTodoReminder(
    item.id,
    reminderKey,
    5,
    new Date("2026-09-03T09:00:00.000Z"),
  );
  assert.equal(snoozed.snoozedReminderKey, reminderKey);
  assert.equal(snoozed.snoozedUntil, "2026-09-03T09:05:00.000Z");
  store = loadStore(directory);
  store.loadTodoFile();
  assert.equal(store.getTodoList()[0].lastReminderKey, reminderKey);
  assert.equal(store.getTodoList()[0].snoozedUntil, "2026-09-03T09:05:00.000Z");
  store.markRemindersSent([{ id: item.id, key: reminderKey }]);
  assert.equal(store.getTodoList()[0].snoozedReminderKey, "");
  assert.equal(store.getTodoList()[0].snoozedUntil, "");
  assert.equal(store.updateTodo({ id: item.id, remindTime: "10:00" }).lastReminderKey, "");
  assert.equal(store.deleteTodo(item.id), true);
  assert.equal(store.deleteTodo(item.id), false);
  store = loadStore(directory);
  assert.equal(store.loadTodoFile().length, 0);
});

test("legacy cycles receive a stable start date and reminder time", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-migration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "todo-store.json"), JSON.stringify({
    list: [{ id: 7, text: "Legacy cycle", isCycle: true, cycleType: "weekly" }],
    maxId: 1,
  }));
  let store = loadStore(directory);
  const original = store.loadTodoFile()[0];
  assert.match(original.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(original.remindTime, "09:00");
  assert.equal(original.snoozedReminderKey, "");
  assert.equal(original.snoozedUntil, "");
  store = loadStore(directory);
  assert.equal(store.loadTodoFile()[0].date, original.date);
  assert.equal(store.addTodoItem({ text: "Next" }).id, 8);
});

test("snooze supports a next-morning delay up to 48 hours", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-snooze-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = loadStore(directory);
  store.loadTodoFile();
  const item = store.addTodoItem({
    text: "Tomorrow morning",
    date: "2026-09-14",
    dueTime: "09:00",
    remind: true,
    reminderMode: "custom",
    customReminderOffsets: [0],
  });
  const key = "once:2026-09-14:09:00:0";
  const snoozed = store.snoozeTodoReminder(
    item.id,
    key,
    30 * 60,
    new Date("2026-09-13T03:00:00.000Z"),
  );
  assert.equal(snoozed.snoozedUntil, "2026-09-14T09:00:00.000Z");
  assert.equal(store.snoozeTodoReminder(item.id, key, 48 * 60 + 1), undefined);
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, "todo-store.json"), "utf8"));
  assert.equal(persisted.schemaVersion, 2);
});

test("unreadable task data enters read-only protection without overwriting files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-read-only-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const primaryPath = path.join(directory, "todo-store.json");
  const backupPath = `${primaryPath}.bak`;
  fs.writeFileSync(primaryPath, "{broken-primary", "utf8");
  fs.writeFileSync(backupPath, "{broken-backup", "utf8");
  t.mock.method(console, "error", () => {});

  const store = loadStore(directory);
  assert.deepEqual(store.loadTodoFile(), []);
  assert.deepEqual(store.getTodoStorageStatus(), {
    state: "error",
    message: "任务文件及自动备份均无法读取，已进入只读保护",
    readOnly: true,
  });
  assert.throws(() => store.addTodoItem({ text: "Must not overwrite" }), /只读保护状态/);
  assert.equal(fs.readFileSync(primaryPath, "utf8"), "{broken-primary");
  assert.equal(fs.readFileSync(backupPath, "utf8"), "{broken-backup");
});
