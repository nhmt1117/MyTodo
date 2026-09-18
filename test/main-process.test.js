const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("application startup is blocked while an installer owns the installation lock", () => {
  const mainPath = require.resolve("../main");
  delete require.cache[mainPath];
  let lockRequestCount = 0;
  let quitCount = 0;
  const app = {
    setAppUserModelId: () => {},
    requestSingleInstanceLock: () => {
      lockRequestCount += 1;
      return true;
    },
    quit: () => {
      quitCount += 1;
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app,
        dialog: {
          showErrorBox: () => {
            assert.fail("the installation lock must not leave a modal MyTodo process running");
          },
        },
      };
    }
    if (request === "./src/main/installLock") {
      return { isInstallationInProgress: () => true };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    require(mainPath);
    assert.equal(lockRequestCount, 0);
    assert.equal(quitCount, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[mainPath];
  }
});

test("a second application launch restores the existing main window", async () => {
  const mainPath = require.resolve("../main");
  delete require.cache[mainPath];
  const listeners = new Map();
  let showCount = 0;
  let installerConfig = null;
  let preparedQuitCount = 0;
  let stoppedSyncCount = 0;
  const app = {
    setAppUserModelId: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: (name, listener) => listeners.set(name, listener),
    quit: () => {},
  };
  const modules = {
    "./src/main/config": {
      applyAutoStartSetting: () => {},
      loadGlobalConfig: () => ({ autoCheckUpdates: false }),
      setGlobalConfig: (value) => {
        installerConfig = value;
        return { autoCheckUpdates: false, ...value };
      },
    },
    "./src/main/dataLocation": { initializeDataDirectory: () => {} },
    "./src/main/installOptions": { consumeInstallerOptions: () => ({ autoStart: true }) },
    "./src/main/installLock": { isInstallationInProgress: () => false },
    "./src/main/ipc": { registerIpcHandlers: () => {} },
    "./src/main/logger": { initializeLogger: () => {} },
    "./src/main/reminderScheduler": {
      startReminderScheduler: () => {},
      stopReminderScheduler: () => {},
    },
    "./src/main/todoStore": {
      loadTodoFile: () => {},
      setTodoMutationListener: () => {},
    },
    "./src/main/syncAccount": { loadSyncAccount: () => {} },
    "./src/main/syncManager": {
      captureTodoMutation: () => {},
      startSyncManager: () => {},
      stopSyncManager: () => { stoppedSyncCount += 1; },
    },
    "./src/main/syncOutbox": { loadSyncOutbox: () => {} },
    "./src/main/updateManager": {
      startUpdateManager: () => {},
      stopUpdateManager: () => {},
    },
    "./src/main/supportTools": { showStartupStorageNotice: async () => {} },
    "./src/main/windows": {
      createMainWindow: () => {},
      createTray: () => {},
      notifyUpdateStatus: () => {},
      notifySyncStatus: () => {},
      notifyTodoDataChanged: () => {},
      prepareForApplicationQuit: () => { preparedQuitCount += 1; },
      prepareReminderWindow: async () => {},
      showMainWindow: () => { showCount += 1; },
      showReminder: () => true,
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { app, dialog: { showErrorBox: () => {} } };
    if (Object.prototype.hasOwnProperty.call(modules, request)) return modules[request];
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    require(mainPath);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(installerConfig, { autoStart: true });
    assert.equal(typeof listeners.get("second-instance"), "function");
    listeners.get("second-instance")();
    assert.equal(showCount, 1);
    listeners.get("before-quit")();
    assert.equal(preparedQuitCount, 1);
    assert.equal(stoppedSyncCount, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[mainPath];
  }
});
