const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  createUpdaterLogger,
  createUpdateManager,
} = require("../src/main/updateManager");

function createTimerApi() {
  const timeouts = [];
  const intervals = [];
  return {
    timeouts,
    intervals,
    setTimeout(handler, delay) {
      const timer = { handler, delay, unref() {} };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const index = timeouts.indexOf(timer);
      if (index >= 0) timeouts.splice(index, 1);
    },
    setInterval(handler, delay) {
      const timer = { handler, delay, unref() {} };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      const index = intervals.indexOf(timer);
      if (index >= 0) intervals.splice(index, 1);
    },
  };
}

class FakeUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit("checking-for-update");
    this.emit("update-available", { version: "2.0.1" });
  }

  async downloadUpdate() {
    this.emit("download-progress", {
      percent: 42.4,
      bytesPerSecond: 1024 * 1024,
      transferred: 42,
      total: 100,
    });
    this.emit("update-downloaded", { version: "2.0.1" });
  }

  quitAndInstall(isSilent, forceRunAfter) {
    this.installArguments = [isSilent, forceRunAfter];
  }
}

test("Windows installer updates require confirmation through every stage", async () => {
  const updater = new FakeUpdater();
  const timerApi = createTimerApi();
  const notifications = [];
  const manager = createUpdateManager({
    app: { isPackaged: true, getVersion: () => "2.0.0" },
    platform: "win32",
    isPortable: false,
    timerApi,
    loadUpdater: () => updater,
  });

  const initial = manager.start({
    autoCheckEnabled: true,
    notifyStatus: (state) => notifications.push(state),
  });
  assert.equal(initial.supported, true);
  assert.equal(initial.phase, "idle");
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(typeof updater.logger.error, "function");
  assert.equal(timerApi.timeouts[0].delay, AUTO_CHECK_DELAY_MS);
  assert.equal(timerApi.intervals[0].delay, AUTO_CHECK_INTERVAL_MS);

  const available = await manager.checkForUpdates({ manual: true });
  assert.equal(available.phase, "available");
  assert.equal(available.availableVersion, "2.0.1");
  assert.equal(available.manual, true);

  const downloaded = await manager.downloadUpdate();
  assert.equal(downloaded.phase, "downloaded");
  assert.equal(downloaded.percent, 100);
  assert.ok(notifications.some((state) => state.phase === "downloading"));

  assert.equal(manager.installUpdate(), true);
  timerApi.timeouts.at(-1).handler();
  assert.deepEqual(updater.installArguments, [false, true]);
  manager.stop();
});

test("development, portable, and non-Windows builds never load the update client", () => {
  for (const setup of [
    { platform: "win32", isPackaged: false, isPortable: false, reason: "development" },
    { platform: "win32", isPackaged: true, isPortable: true, reason: "portable" },
    { platform: "darwin", isPackaged: true, isPortable: false, reason: "not-windows" },
  ]) {
    let loaded = false;
    const manager = createUpdateManager({
      app: { isPackaged: setup.isPackaged, getVersion: () => "2.0.0" },
      platform: setup.platform,
      isPortable: setup.isPortable,
      loadUpdater: () => {
        loaded = true;
        return new FakeUpdater();
      },
    });
    const state = manager.start();
    assert.equal(state.phase, "unsupported");
    assert.equal(state.unsupportedReason, setup.reason);
    assert.equal(loaded, false);
    manager.stop();
  }
});

test("updater logs keep the error reason without writing full stacks", () => {
  const entries = [];
  const logger = createUpdaterLogger({
    log: (message) => entries.push(["log", message]),
    warn: (message) => entries.push(["warn", message]),
    error: (message) => entries.push(["error", message]),
  });
  const error = new Error("request failed\nwith details");
  error.stack = `request failed\n${"stack ".repeat(500)}`;

  logger.error(error);
  logger.error('Error: Error: update metadata returned 404 Headers: {"authorization":"secret"}');

  assert.deepEqual(entries, [
    ["error", "[updater] request failed with details"],
    ["error", "[updater] Error: update metadata returned 404"],
  ]);
});
