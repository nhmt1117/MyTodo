const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { buildTodoSyncPayload } = require("../src/main/syncManager");
const FREE_LIMITS = require("../src/shared/freeLimits");

test("free limits match Contracts", () => {
  const source = path.resolve(__dirname, "../../MyTodo-Contracts/config/free-limits.json");
  if (!fs.existsSync(source)) return;
  const contract = JSON.parse(fs.readFileSync(source, "utf8"));
  assert.deepEqual(FREE_LIMITS, {
    activeTodos: contract.free.activeTodos,
    completedTodos: contract.free.completedTodos,
  });
  assert.equal(contract.free.devicesPerPlatform, 1);
});

test("membership limits apply offline and downgrades never bulk-trim completed history", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-member-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = loadStore(directory); store.loadTodoFile();
  let membership = { limits: { activeTodos: 2, completedTodos: 5 } };
  store.setMembershipProvider(() => membership);
  for (let i = 0; i < 4; i++) {
    const task = store.addTodoItem({ text: `Completed ${i}` }); store.setArchived(task.id, true);
  }
  membership = { limits: { activeTodos: 2, completedTodos: 1 } };
  const before = store.getTodoList().length;
  const one = store.addTodoItem({ text: "One" }); const two = store.addTodoItem({ text: "Two" });
  assert.throws(() => store.addTodoItem({ text: "Excess" }), /最多 2/);
  store.setArchived(one.id, true);
  assert.equal(store.getTodoList().length, before + 1);
  store.setArchived(one.id, true);
  store.updateTodo({ id: one.id, archived: true, text: "Updated" });
  assert.equal(store.getTodoList().length, before + 1);
  assert.ok(store.getTodoList().some((task) => task.id === two.id));
});

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

test("preserves the shared full todo payload through the Windows store", (t) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "contracts/todo-roundtrip.json"), "utf8"));
  const source = path.resolve(__dirname, "../../MyTodo-Contracts/fixtures/todo-roundtrip.json");
  if (fs.existsSync(source)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), fixture);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-full-payload-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = loadStore(directory);
  store.loadTodoFile();
  const item = store.applyCloudTodo(fixture.entityId, fixture.payload, 3);
  assert.equal(item.cloudRevision, 3);
  assert.equal(item.timezone, fixture.payload.timezone);
  assert.equal(item.recurrenceStartDate, fixture.payload.recurrenceRule.startDate);
  assert.deepEqual(buildTodoSyncPayload(item), fixture.payload);
});

test("cloud snapshot removes missing synced tasks but preserves offline work", (t) => {
  const cases = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../MyTodo-Contracts/fixtures/sync-recovery-cases.json"), "utf8",
  ));
  assert.equal(cases.length, 4);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-snapshot-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = loadStore(directory);
  store.loadTodoFile();
  const missingId = "10000000-0000-4000-8000-000000000001";
  const pendingId = "10000000-0000-4000-8000-000000000002";
  const presentId = "10000000-0000-4000-8000-000000000003";
  const newCloudId = "10000000-0000-4000-8000-000000000004";
  store.applyCloudTodo(missingId, { title: "Deleted in cloud" }, 2);
  store.applyCloudTodo(pendingId, { title: "Offline edit" }, 2);
  store.setTodoCloudState(pendingId, 2, "pending");
  store.applyCloudTodo(presentId, { title: "Old cloud title" }, 1);
  const localOnly = store.addTodoItem({ text: "Offline new task" });

  store.applyCloudSnapshot([
    { id: pendingId, title: "Cloud version", revision: 3 },
    { id: presentId, title: "New cloud title", revision: 2 },
    { id: newCloudId, title: "New cloud task", revision: 1 },
  ], (id) => id === pendingId);
  const snapshot = store.getTodoSyncSnapshot();
  assert.ok(snapshot.find((item) => item.uuid === missingId).deletedAt);
  assert.equal(snapshot.find((item) => item.uuid === pendingId).text, "Offline edit");
  assert.equal(snapshot.find((item) => item.uuid === presentId).text, "New cloud title");
  assert.equal(snapshot.find((item) => item.uuid === newCloudId).text, "New cloud task");
  assert.equal(snapshot.find((item) => item.id === localOnly.id).text, "Offline new task");
});

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
  assert.match(original.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(original.cloudRevision, 0);
  assert.equal(original.syncState, "local");
  assert.match(original.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(original.remindTime, "09:00");
  assert.equal(original.snoozedReminderKey, "");
  assert.equal(original.snoozedUntil, "");
  store = loadStore(directory);
  const reloaded = store.loadTodoFile()[0];
  assert.equal(reloaded.date, original.date);
  assert.equal(reloaded.uuid, original.uuid);
  assert.equal(store.addTodoItem({ text: "Next" }).id, 8);
});

test("completion time survives edits, reloads and sync payloads", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-completed-at-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let store = loadStore(directory);
  store.loadTodoFile();
  const item = store.addTodoItem({ text: "Finish me" });
  const completed = store.setArchived(item.id, true);
  assert.match(completed.completedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(store.updateTodo({ id: item.id, text: "Edited later" }).completedAt, completed.completedAt);
  store = loadStore(directory);
  assert.equal(store.loadTodoFile()[0].completedAt, completed.completedAt);
  assert.equal(store.setArchived(item.id, false).completedAt, "");
});

test("free limits reject active overflow and remove the earliest completed task", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-free-limits-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const list = [
    ...Array.from({ length: 100 }, (_, index) => ({
      id: index + 1, text: `Active ${index}`, archived: false,
    })),
    ...Array.from({ length: 500 }, (_, index) => ({
      id: index + 101, text: `Completed ${index}`, archived: true,
      completedAt: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
      date: index === 0 ? "2030-01-01" : "2020-01-01",
    })),
  ];
  fs.writeFileSync(path.join(directory, "todo-store.json"), JSON.stringify({ list, maxId: 601 }));
  const store = loadStore(directory);
  store.loadTodoFile();
  assert.throws(() => store.addTodoItem({ text: "Too many" }), /最多 100 条/);
  assert.throws(() => store.setArchived(101, false), /最多 100 条/);
  const finished = store.setArchived(1, true);
  assert.ok(finished.completedAt);
  const visible = store.getTodoList();
  assert.equal(visible.filter((todo) => todo.archived).length, 500);
  assert.equal(visible.some((todo) => todo.id === 101), false);
  assert.equal(visible.some((todo) => todo.id === 102), true);
  assert.equal(visible.some((todo) => todo.id === 1), true);
  const later = store.addTodoItem({ text: "Later completion" });
  const edited = store.updateTodo({ id: later.id, archived: true });
  assert.equal(edited.id, later.id);
  assert.equal(edited.archived, true);
  assert.equal(store.getTodoList().some((todo) => todo.id === 102), false);
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
  assert.equal(persisted.schemaVersion, 3);
});

test("text edits preserve snooze while automatic priority changes reset it", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-snooze-edit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = loadStore(directory);
  store.loadTodoFile();
  const item = store.addTodoItem({
    text: "Initial",
    date: "2026-10-05",
    dueTime: "09:00",
    priority: "mid",
    remind: true,
    reminderMode: "auto",
  });
  const snoozed = store.snoozeTodoReminder(
    item.id,
    "once:2026-10-05:09:00:0",
    15,
    new Date("2026-10-05T00:00:00.000Z"),
  ).snoozedUntil;
  assert.equal(store.updateTodo({ id: item.id, text: "Edited" }).snoozedUntil, snoozed);
  assert.equal(store.updateTodo({ id: item.id, priority: "high" }).snoozedUntil, "");
});

test("synced deletions keep a hidden tombstone for cloud propagation", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-tombstone-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const uuid = "8ec41df8-89f7-4df3-8e3d-0badc30cfe72";
  fs.writeFileSync(path.join(directory, "todo-store.json"), JSON.stringify({
    schemaVersion: 3,
    list: [{
      id: 1,
      uuid,
      text: "Synced task",
      cloudRevision: 4,
      syncState: "synced",
    }],
    maxId: 2,
  }));

  const store = loadStore(directory);
  store.loadTodoFile();
  assert.equal(store.deleteTodo(1), true);
  assert.deepEqual(store.getTodoList(), []);
  const tombstone = store.getTodoSyncSnapshot()[0];
  assert.equal(tombstone.uuid, uuid);
  assert.equal(tombstone.cloudRevision, 4);
  assert.equal(tombstone.syncState, "pending");
  assert.match(tombstone.deletedAt, /^\d{4}-\d{2}-\d{2}T/);

  const persisted = JSON.parse(fs.readFileSync(path.join(directory, "todo-store.json"), "utf8"));
  assert.equal(persisted.list.length, 1);
  assert.equal(persisted.list[0].deletedAt, tombstone.deletedAt);
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

test("restoring a backup replaces tasks, recovers read-only storage, and records sync changes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-restore-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const existingUuid = "8ec41df8-89f7-4df3-8e3d-0badc30cfe72";
  const restoredUuid = "e5895547-ee55-44e9-a86d-e7a61a32669f";
  fs.writeFileSync(path.join(directory, "todo-store.json"), JSON.stringify({
    schemaVersion: 3,
    list: [{ id: 1, uuid: existingUuid, text: "Cloud task", cloudRevision: 7 }],
    maxId: 2,
  }));

  const store = loadStore(directory);
  store.loadTodoFile();
  const mutations = [];
  store.setTodoMutationListener((operation, item) => mutations.push({ operation, item }));
  const result = store.restoreTodoList([{
    id: 4,
    uuid: restoredUuid,
    text: "Restored task",
    date: "2026-09-18",
  }], new Date("2026-09-18T10:00:00.000Z"));

  assert.deepEqual(result.map((item) => item.text), ["Restored task"]);
  const snapshot = store.getTodoSyncSnapshot();
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot.find((item) => item.uuid === restoredUuid).syncState, "local");
  const tombstone = snapshot.find((item) => item.uuid === existingUuid);
  assert.equal(tombstone.deletedAt, "2026-09-18T10:00:00.000Z");
  assert.equal(tombstone.syncState, "pending");
  assert.deepEqual(mutations.map((entry) => entry.operation), ["upsert", "delete"]);

  fs.writeFileSync(path.join(directory, "todo-store.json"), "{broken-primary", "utf8");
  fs.writeFileSync(path.join(directory, "todo-store.json.bak"), "{broken-backup", "utf8");
  const protectedStore = loadStore(directory);
  t.mock.method(console, "error", () => {});
  protectedStore.loadTodoFile();
  assert.equal(protectedStore.getTodoStorageStatus().readOnly, true);
  protectedStore.restoreTodoList([{ id: 1, text: "Recovered from backup" }]);
  assert.equal(protectedStore.getTodoStorageStatus().readOnly, false);
  assert.equal(protectedStore.getTodoList()[0].text, "Recovered from backup");
});
