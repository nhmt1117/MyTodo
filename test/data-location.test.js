const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadDataLocation(userDataDirectory, appDataDirectory, options = {}) {
  const modulePath = require.resolve("../src/main/dataLocation");
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          isPackaged: !!options.isPackaged,
          getPath: (name) => {
            if (name === "userData") return userDataDirectory;
            if (name === "appData") return appDataDirectory;
            if (name === "exe") return options.executablePath || process.execPath;
            throw new Error(`Unexpected Electron path: ${name}`);
          },
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

test("user-data-dir ignores the global data location record", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-data-isolation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDataDirectory = path.join(root, "isolated-user-data");
  const appDataDirectory = path.join(root, "global-app-data");
  const globalCustomDirectory = path.join(root, "global-custom-data");
  fs.mkdirSync(appDataDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(appDataDirectory, "MyTodo-data-location.json"),
    JSON.stringify({ directory: globalCustomDirectory }),
    "utf8",
  );
  const originalArgv = process.argv;
  process.argv = [...process.argv, `--user-data-dir=${userDataDirectory}`];
  t.after(() => { process.argv = originalArgv; });

  const dataLocation = loadDataLocation(userDataDirectory, appDataDirectory);
  assert.equal(dataLocation.initializeDataDirectory().directory, path.resolve(userDataDirectory));
  assert.equal(fs.existsSync(path.join(userDataDirectory, "MyTodo-data-location.json")), false);
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
test("packaged builds use a sibling MyTodoData directory and migrate legacy data", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-packaged-data-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDataDirectory = path.join(root, "app-data");
  const legacyDirectory = path.join(appDataDirectory, "MyTodo");
  const executablePath = path.join(root, "user", "MyTodo", "MyTodo.exe");
  const expectedDirectory = path.join(root, "user", "MyTodoData");
  fs.mkdirSync(legacyDirectory, { recursive: true });
  fs.writeFileSync(path.join(legacyDirectory, "todo-store.json"), '{"list":[{"id":1}]}', "utf8");
  fs.writeFileSync(path.join(legacyDirectory, "win-config.json"), '{"width":620}', "utf8");

  const dataLocation = loadDataLocation(legacyDirectory, appDataDirectory, {
    isPackaged: true,
    executablePath,
  });
  assert.equal(dataLocation.getPackagedDataDirectory(executablePath), expectedDirectory);
  const location = dataLocation.initializeDataDirectory();

  assert.deepEqual(location, {
    directory: path.resolve(expectedDirectory),
    defaultDirectory: path.resolve(expectedDirectory),
    isCustom: false,
  });
  assert.equal(fs.existsSync(path.join(legacyDirectory, "todo-store.json")), false);
  assert.equal(fs.existsSync(path.join(legacyDirectory, "win-config.json")), false);
  assert.equal(fs.existsSync(path.join(expectedDirectory, "todo-store.json")), true);
  assert.equal(fs.existsSync(path.join(expectedDirectory, "win-config.json")), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(appDataDirectory, "MyTodo-data-location.json"), "utf8")),
    { directory: path.resolve(expectedDirectory) },
  );
});
test("packaged builds retain legacy data when automatic migration fails", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-packaged-data-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDataDirectory = path.join(root, "app-data");
  const legacyDirectory = path.join(appDataDirectory, "MyTodo");
  const executablePath = path.join(root, "user", "MyTodo", "MyTodo.exe");
  const expectedDirectory = path.join(root, "user", "MyTodoData");
  fs.mkdirSync(legacyDirectory, { recursive: true });
  fs.writeFileSync(path.join(legacyDirectory, "todo-store.json"), '{"list":[{"id":1}]}', "utf8");

  const dataLocation = loadDataLocation(legacyDirectory, appDataDirectory, {
    isPackaged: true,
    executablePath,
  });
  const error = t.mock.method(console, "error", () => {});
  const copy = t.mock.method(fs, "copyFileSync", () => {
    throw new Error("Simulated copy failure");
  });
  const location = dataLocation.initializeDataDirectory();
  copy.mock.restore();
  error.mock.restore();

  assert.deepEqual(location, {
    directory: path.resolve(legacyDirectory),
    defaultDirectory: path.resolve(expectedDirectory),
    isCustom: true,
  });
  assert.equal(fs.existsSync(path.join(legacyDirectory, "todo-store.json")), true);
  assert.equal(fs.existsSync(path.join(expectedDirectory, "todo-store.json")), false);
  assert.equal(fs.existsSync(path.join(appDataDirectory, "MyTodo-data-location.json")), false);
});

test("broken data location records report an explicit fallback", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-location-damaged-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDataDirectory = path.join(root, "user-data");
  const appDataDirectory = path.join(root, "app-data");
  fs.mkdirSync(appDataDirectory, { recursive: true });
  fs.writeFileSync(path.join(appDataDirectory, "MyTodo-data-location.json"), "{broken", "utf8");
  fs.writeFileSync(path.join(appDataDirectory, "MyTodo-data-location.json.bak"), "[]", "utf8");
  t.mock.method(console, "error", () => {});

  const dataLocation = loadDataLocation(userDataDirectory, appDataDirectory);
  assert.equal(dataLocation.initializeDataDirectory().directory, path.resolve(userDataDirectory));
  assert.deepEqual(dataLocation.getDataLocationStatus(), {
    state: "error",
    message: "数据位置记录无法读取，已临时使用默认位置",
  });
});
