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
  const item = store.addTodoItem({ text: "Test", date: "2026-09-03", remind: true });
  assert.equal(item.remindTime, "09:00");
  store.getTodoList()[0].text = "Changed clone";
  assert.equal(store.getTodoList()[0].text, "Test");
  assert.equal(store.updateTodo({ id: item.id, text: "Edited" }).text, "Edited");
  assert.equal(store.setArchived(item.id, true).archived, true);
  assert.equal(store.setArchived(item.id, false).archived, false);
  assert.equal(store.muteTodoRemind(item.id).muteRemind, true);
  assert.equal(store.addToToday(item.id).muteRemind, false);
  store.markRemindersSent([{ id: item.id, key: "once:2026-09-03:09:00" }]);
  store = loadStore(directory);
  store.loadTodoFile();
  assert.equal(store.getTodoList()[0].lastReminderKey, "once:2026-09-03:09:00");
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
  store = loadStore(directory);
  assert.equal(store.loadTodoFile()[0].date, original.date);
  assert.equal(store.addTodoItem({ text: "Next" }).id, 8);
});
