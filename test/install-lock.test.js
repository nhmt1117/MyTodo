const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { isInstallationInProgress } = require("../src/main/installLock");

function makeTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-install-lock-"));
}

test("an active installer lock blocks application startup", (t) => {
  const directory = makeTempDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "MyTodo-installing-1234.lock"), "1234");

  assert.equal(isInstallationInProgress({
    directory,
    kill: (pid) => {
      assert.equal(pid, 1234);
    },
  }), true);
});

test("stale installer locks are removed without blocking startup", (t) => {
  const directory = makeTempDirectory();
  const lockPath = path.join(directory, "MyTodo-installing-4321.lock");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(lockPath, "4321");

  assert.equal(isInstallationInProgress({
    directory,
    kill: () => {
      const error = new Error("missing");
      error.code = "ESRCH";
      throw error;
    },
  }), false);
  assert.equal(fs.existsSync(lockPath), false);
});
