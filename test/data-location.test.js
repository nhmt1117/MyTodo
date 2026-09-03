const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadDataLocation(userDataDirectory, appDataDirectory) {
  const modulePath = require.resolve("../src/main/dataLocation");
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: (name) => (name === "userData" ? userDataDirectory : appDataDirectory),
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("data location uses Electron's default userData directory initially", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-data-location-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDataDirectory = path.join(root, "user-data");
  const appDataDirectory = path.join(root, "app-data");

  const dataLocation = loadDataLocation(userDataDirectory, appDataDirectory);
  assert.deepEqual(dataLocation.initializeDataDirectory(), {
    directory: path.resolve(userDataDirectory),
    defaultDirectory: path.resolve(userDataDirectory),
    isCustom: false,
  });
});

test("data location migration moves tasks, settings and backups", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-data-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const targetDirectory = path.join(root, "target");
  const appDataDirectory = path.join(root, "app-data");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const files = {
    "todo-store.json": '{"list":[{"id":1}]}',
    "todo-store.json.bak": '{"list":[]}',
    "win-config.json": '{"width":620}',
    "win-config.json.bak": '{"width":600}',
  };
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(sourceDirectory, fileName), content, "utf8");
  }

  const dataLocation = loadDataLocation(sourceDirectory, appDataDirectory);
  dataLocation.initializeDataDirectory();
  const result = dataLocation.migrateDataDirectory(targetDirectory);

  assert.equal(result.directory, path.resolve(targetDirectory));
  assert.equal(result.isCustom, true);
  assert.deepEqual(result.cleanupPending, []);
  assert.deepEqual(result.migratedFiles.sort(), Object.keys(files).sort());
  for (const [fileName, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(targetDirectory, fileName), "utf8"), content);
    assert.equal(fs.existsSync(path.join(sourceDirectory, fileName)), false);
  }
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(appDataDirectory, "MyTodo-data-location.json"), "utf8")),
    { directory: path.resolve(targetDirectory) },
  );
});

test("data location migration refuses to overwrite an existing MyTodo data directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-data-conflict-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const targetDirectory = path.join(root, "target");
  const appDataDirectory = path.join(root, "app-data");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, "todo-store.json"), '{"list":[{"id":1}]}', "utf8");
  fs.writeFileSync(path.join(targetDirectory, "todo-store.json"), '{"list":[{"id":2}]}', "utf8");

  const dataLocation = loadDataLocation(sourceDirectory, appDataDirectory);
  dataLocation.initializeDataDirectory();

  assert.throws(
    () => dataLocation.migrateDataDirectory(targetDirectory),
    /目标文件夹已包含 MyTodo 数据/,
  );
  assert.equal(dataLocation.getDataDirectory(), path.resolve(sourceDirectory));
  assert.equal(fs.existsSync(path.join(sourceDirectory, "todo-store.json")), true);
});
test("data location migration keeps the source intact when copying fails", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-data-copy-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const targetDirectory = path.join(root, "target");
  const appDataDirectory = path.join(root, "app-data");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, "todo-store.json"), '{"list":[{"id":1}]}', "utf8");
  fs.writeFileSync(path.join(sourceDirectory, "win-config.json"), '{"width":620}', "utf8");

  const dataLocation = loadDataLocation(sourceDirectory, appDataDirectory);
  dataLocation.initializeDataDirectory();
  const originalCopyFile = fs.copyFileSync;
  const copy = t.mock.method(fs, "copyFileSync", (sourcePath, targetPath) => {
    if (path.basename(sourcePath) === "win-config.json") {
      throw new Error("Simulated copy failure");
    }
    return originalCopyFile(sourcePath, targetPath);
  });

  assert.throws(() => dataLocation.migrateDataDirectory(targetDirectory), /Simulated copy failure/);
  copy.mock.restore();
  assert.equal(dataLocation.getDataDirectory(), path.resolve(sourceDirectory));
  assert.equal(fs.existsSync(path.join(sourceDirectory, "todo-store.json")), true);
  assert.equal(fs.existsSync(path.join(sourceDirectory, "win-config.json")), true);
  assert.equal(fs.readdirSync(targetDirectory).length, 0);
  assert.equal(fs.existsSync(path.join(appDataDirectory, "MyTodo-data-location.json")), false);
});