const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } = require("../src/main/backup");

function loadSupportTools(options) {
  const modulePath = require.resolve("../src/main/supportTools");
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: () => options.root,
          getVersion: () => "2.0.10",
        },
        dialog: {
          showOpenDialog: async () => ({ canceled: false, filePaths: [options.backupPath] }),
        },
        shell: { openPath: async () => "" },
      };
    }
    if (request === "./config") return options.config;
    if (request === "./dataLocation") {
      return {
        getDataLocation: () => ({ directory: options.dataDirectory }),
        getDataLocationStatus: () => ({ state: "ok", message: "ok" }),
      };
    }
    if (request === "./logger") return { getLogDirectory: () => options.dataDirectory };
    if (request === "./todoStore") return options.todoStore;
    if (request === "./syncAccount") {
      return { getSyncAccountStatus: () => ({ state: "ok", message: "ok" }) };
    }
    if (request === "./syncOutbox") {
      return { getSyncOutboxStatus: () => ({ state: "ok", message: "ok" }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("backup selection previews data and restore creates a rollback snapshot", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-support-restore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "data");
  const backupPath = path.join(root, "restore.json");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, "todo-store.json"), JSON.stringify({
    list: [{ id: 1, text: "Current" }],
  }));
  fs.writeFileSync(backupPath, JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: "2.0.9",
    exportedAt: "2026-09-18T08:00:00.000Z",
    data: {
      todoStore: { schemaVersion: 3, list: [{ id: 2, text: "Restored" }] },
      config: { notificationSound: false },
    },
  }));

  let config = { notificationSound: true, autoStart: false };
  let todos = [{ id: 1, text: "Current" }];
  const support = loadSupportTools({
    root,
    backupPath,
    dataDirectory,
    config: {
      getConfigStatus: () => ({ state: "ok", message: "ok" }),
      getGlobalConfig: () => ({ ...config }),
      replaceGlobalConfig: (next) => { config = { ...next }; return { ...config }; },
    },
    todoStore: {
      getTodoList: () => todos.map((item) => ({ ...item })),
      getTodoStorageStatus: () => ({ state: "ok", message: "ok", readOnly: false }),
      restoreTodoList: (next) => { todos = next.map((item) => ({ ...item })); return todos; },
    },
  });

  const preview = await support.selectDataBackup();
  assert.equal(preview.todoCount, 1);
  assert.equal(preview.appVersion, "2.0.9");

  const result = support.restoreDataBackup(preview.filePath);
  assert.equal(result.todoCount, 1);
  assert.equal(config.notificationSound, false);
  assert.equal(todos[0].text, "Restored");
  assert.match(result.safetyBackupPath, /MyTodo-Before-Restore-/);
  const safetyBackup = JSON.parse(fs.readFileSync(result.safetyBackupPath, "utf8"));
  assert.equal(safetyBackup.data.todoStore.list[0].text, "Current");
});
