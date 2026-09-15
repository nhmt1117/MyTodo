const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

function loadWindows(options = {}) {
  const modulePath = require.resolve("../src/main/windows");
  delete require.cache[modulePath];
  const createdWindows = [];

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.messages = [];
    }

    send(channel, payload) {
      this.messages.push({ channel, payload });
    }

    isLoadingMainFrame() {
      return false;
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(windowOptions) {
      super();
      this.options = windowOptions;
      this.webContents = new FakeWebContents();
      this.destroyed = false;
      this.visible = windowOptions.show === true;
      this.hideCount = 0;
      this.ignoreMouseEvents = [];
      createdWindows.push(this);
    }

    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setBounds() {}
    setSkipTaskbar() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(value) { this.ignoreMouseEvents.push(value); }
    showInactive() { this.visible = true; }
    loadFile() { return Promise.resolve(); }

    hide() {
      this.hideCount += 1;
      if (!options.keepVisibleAfterHide) this.visible = false;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.emit("closed");
    }
  }

  const electron = {
    app: { isPackaged: false },
    BrowserWindow: FakeBrowserWindow,
    Menu: {},
    Tray: class {},
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
  };
  const config = {
    getGlobalConfig: () => ({ notificationSound: false }),
    normalizeFloatBounds: () => null,
    setFloatBounds: () => {},
    setGlobalConfig: () => ({}),
    setMainWindowBounds: () => {},
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return electron;
    if (request === "./config") return config;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return { windows: require(modulePath), createdWindows };
  } finally {
    Module._load = originalLoad;
  }
}

function reminder(overrides = {}) {
  return {
    id: 1,
    key: "once:2026-09-16:09:00:0",
    kind: "task",
    body: "测试提醒",
    dueDate: "2026-09-16",
    dueTime: "09:00",
    ...overrides,
  };
}

test("a repeated reminder key receives a new display identity", async () => {
  const { windows, createdWindows } = loadWindows();
  await windows.prepareReminderWindow();
  const targetWindow = createdWindows[0];

  assert.equal(windows.showReminder(reminder()), true);
  const firstDisplay = targetWindow.webContents.messages.at(-1).payload;
  assert.equal(firstDisplay.displayId, 1);
  assert.equal(
    windows.handleReminderAction(targetWindow.webContents, "snooze", firstDisplay, {
      snooze: () => true,
    }),
    true,
  );

  assert.equal(windows.showReminder(reminder({ isSnoozed: true })), true);
  const secondDisplay = targetWindow.webContents.messages.at(-1).payload;
  assert.equal(secondDisplay.displayId, 2);
  assert.notEqual(secondDisplay.displayId, firstDisplay.displayId);
  assert.equal(
    windows.handleReminderAction(targetWindow.webContents, "dismiss", firstDisplay),
    false,
  );
  assert.equal(
    windows.handleReminderAction(targetWindow.webContents, "dismiss", secondDisplay),
    true,
  );
});

test("queued reminders switch in place and hide only after the queue drains", async () => {
  const { windows, createdWindows } = loadWindows();
  await windows.prepareReminderWindow();
  const targetWindow = createdWindows[0];

  windows.showReminder(reminder());
  windows.showReminder(reminder({ id: 2, key: "overdue:2026-09-16", body: "下一条" }));
  const firstDisplay = targetWindow.webContents.messages[0].payload;

  assert.equal(
    windows.handleReminderAction(targetWindow.webContents, "dismiss", firstDisplay),
    true,
  );
  assert.equal(targetWindow.hideCount, 0);
  const secondDisplay = targetWindow.webContents.messages.at(-1).payload;
  assert.equal(secondDisplay.id, 2);
  assert.equal(secondDisplay.displayId, 2);

  assert.equal(
    windows.handleReminderAction(targetWindow.webContents, "dismiss", secondDisplay),
    true,
  );
  assert.equal(targetWindow.hideCount, 1);
  assert.equal(targetWindow.ignoreMouseEvents.at(-1), true);
});

test("a reminder window that remains visible after hide is rebuilt", async () => {
  const { windows, createdWindows } = loadWindows({ keepVisibleAfterHide: true });
  await windows.prepareReminderWindow();
  const targetWindow = createdWindows[0];

  windows.showReminder(reminder());
  const display = targetWindow.webContents.messages.at(-1).payload;
  windows.handleReminderAction(targetWindow.webContents, "dismiss", display);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(targetWindow.destroyed, true);
  assert.equal(createdWindows.length, 2);
  assert.equal(createdWindows[1].visible, false);
});
