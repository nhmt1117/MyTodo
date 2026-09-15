const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadConfig(directory) {
  const modulePath = require.resolve("../src/main/config");
  delete require.cache[modulePath];
  const loginSettings = [];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          setLoginItemSettings: (value) => loginSettings.push(value),
        },
      };
    }
    if (request === "./dataLocation") {
      return {
        getDataFilePath: (name) => path.join(directory, name),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { config: require(modulePath), loginSettings };
  } finally {
    Module._load = originalLoad;
  }
}

test("global reminder settings normalize and persist", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let loaded = loadConfig(directory);
  const defaults = loaded.config.loadGlobalConfig();
  assert.equal(defaults.width, 1100);
  assert.equal(defaults.height, 760);
  assert.equal(defaults.dailySummary, true);
  assert.equal(defaults.weeklySummary, true);
  assert.equal(defaults.notificationSound, true);
  assert.equal(defaults.quietHoursEnabled, true);
  assert.equal(defaults.dailySummaryTime, "09:00");
  assert.equal(defaults.trayNoticeShown, false);

  const updated = loaded.config.setGlobalConfig({
    width: 400,
    height: 300,
    autoStart: true,
    notificationSound: false,
    dailySummaryTime: "25:00",
    quietStart: "21:30",
    quietEnd: "07:45",
    trayNoticeShown: true,
  });
  assert.equal(updated.width, 860);
  assert.equal(updated.height, 680);
  assert.equal(updated.dailySummaryTime, "09:00");
  assert.equal(updated.notificationSound, false);
  assert.equal(updated.quietStart, "21:30");
  assert.equal(updated.quietEnd, "07:45");
  assert.deepEqual(loaded.loginSettings.at(-1), {
    openAtLogin: true,
    path: process.execPath,
    args: ["--hidden"],
  });

  assert.equal(loaded.config.markSummarySent("daily", "2026-09-13"), true);
  assert.equal(loaded.config.markSummarySent("daily", "2026-09-13"), false);
  assert.equal(loaded.config.markSummarySent("weekly", "2026-09-07"), true);

  loaded = loadConfig(directory);
  const persisted = loaded.config.loadGlobalConfig();
  assert.equal(persisted.autoStart, true);
  assert.equal(persisted.notificationSound, false);
  assert.equal(persisted.lastDailySummaryDate, "2026-09-13");
  assert.equal(persisted.lastWeeklySummaryKey, "2026-09-07");
  assert.equal(persisted.quietStart, "21:30");
  assert.equal(persisted.trayNoticeShown, true);
});
