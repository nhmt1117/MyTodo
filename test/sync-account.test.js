const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadAccount(directory) {
  const accountPath = require.resolve("../src/main/syncAccount");
  const dataLocationPath = require.resolve("../src/main/dataLocation");
  delete require.cache[accountPath];
  delete require.cache[dataLocationPath];
  const electron = {
    app: {
      getPath: () => directory,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from("protected:" + value, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(accountPath);
  } finally {
    Module._load = originalLoad;
  }
}

test("sync credentials are encrypted and survive reload", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-sync-account-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let account = loadAccount(directory);
  account.loadSyncAccount();
  account.registerSyncAccount({
    serverUrl: "http://localhost:3100",
    userId: "976561b7-a599-4b2d-b753-7e9325042881",
    deviceId: "f8978649-403b-4105-8121-b4d42ac743f7",
    deviceName: "Test PC",
    refreshToken: "refresh-secret-value",
    recoveryKey: "recovery-secret-value",
    initialUploadConfirmed: true,
  });

  const raw = fs.readFileSync(path.join(directory, "sync-account.json"), "utf8");
  assert.doesNotMatch(raw, /refresh-secret-value/);
  assert.doesNotMatch(raw, /recovery-secret-value/);
  assert.match(raw, /refreshTokenEncrypted/);

  account = loadAccount(directory);
  assert.equal(account.loadSyncAccount().enabled, true);
  assert.equal(account.getSyncCredentials().refreshToken, "refresh-secret-value");
  assert.equal(account.getRecoveryKey(), "recovery-secret-value");
  assert.equal(account.getSyncAccount().serverUrl, "http://localhost:3100/api/v1");
});

test("sync account refuses registration without explicit upload confirmation", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-sync-confirm-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const account = loadAccount(directory);
  account.loadSyncAccount();
  assert.throws(() => account.registerSyncAccount({
    userId: "976561b7-a599-4b2d-b753-7e9325042881",
    deviceId: "f8978649-403b-4105-8121-b4d42ac743f7",
    refreshToken: "refresh",
    recoveryKey: "recovery",
  }), /确认上传/);
  assert.equal(account.getSyncAccount().enabled, false);
});
