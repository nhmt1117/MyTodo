const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  INSTALL_OPTIONS_FILE,
  consumeInstallerOptions,
} = require("../src/main/installOptions");

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-install-options-"));
}

test("installer auto-start choice is consumed exactly once", () => {
  const directory = createTempDirectory();
  const filePath = path.join(directory, INSTALL_OPTIONS_FILE);
  try {
    fs.writeFileSync(filePath, JSON.stringify({ autoStart: true }), "utf8");

    assert.deepEqual(consumeInstallerOptions({ resourcesPath: directory }), { autoStart: true });
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(consumeInstallerOptions({ resourcesPath: directory }), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid installer options are discarded without changing settings", () => {
  const directory = createTempDirectory();
  const filePath = path.join(directory, INSTALL_OPTIONS_FILE);
  const warnings = [];
  try {
    fs.writeFileSync(filePath, JSON.stringify({ autoStart: "yes" }), "utf8");

    assert.equal(consumeInstallerOptions({
      resourcesPath: directory,
      logger: { warn: (...values) => warnings.push(values) },
    }), null);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(warnings.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
