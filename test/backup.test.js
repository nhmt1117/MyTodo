const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  createDataBackup,
} = require("../src/main/backup");

test("data export contains normalized state and original recovery files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-backup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "data");
  const destinationPath = path.join(root, "exports", "MyTodo-Backup.json");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, "todo-store.json"), "{\"list\":[]}", "utf8");
  fs.writeFileSync(path.join(dataDirectory, "todo-store.json.bak"), "{\"list\":[1]}", "utf8");
  fs.writeFileSync(
    path.join(dataDirectory, "sync-outbox.json"),
    "{\"schemaVersion\":1,\"items\":[]}",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dataDirectory, "sync-account.json"),
    "{\"refreshTokenEncrypted\":\"must-not-export\"}",
    "utf8",
  );

  const result = createDataBackup({
    destinationPath,
    dataDirectory,
    appVersion: "2.0.0",
    todos: [{ id: 4, text: "Backup task" }],
    config: { autoStart: true },
  });
  const backup = JSON.parse(fs.readFileSync(destinationPath, "utf8"));

  assert.equal(result.fileCount, 3);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(backup.appVersion, "2.0.0");
  assert.equal(backup.data.todoStore.schemaVersion, 3);
  assert.equal(backup.data.todoStore.maxId, 5);
  assert.deepEqual(backup.data.todoStore.list, [{ id: 4, text: "Backup task" }]);
  assert.deepEqual(backup.data.config, { autoStart: true });
  assert.equal(backup.originalFiles["todo-store.json"], "{\"list\":[]}");
  assert.equal(backup.originalFiles["sync-account.json"], undefined);
});
