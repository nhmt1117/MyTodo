const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readJsonWithBackup, writeJsonAtomic } = require("../src/main/storage");

test("atomic JSON writes keep a known-good backup", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-storage-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, "todo-store.json");

  writeJsonAtomic(filePath, { version: 1 });
  writeJsonAtomic(filePath, { version: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { version: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, "utf8")), { version: 1 });
});

test("reader restores data from backup when the primary JSON is damaged", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-recovery-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, "win-config.json");

  writeJsonAtomic(filePath, { width: 620 });
  writeJsonAtomic(filePath, { width: 800 });
  fs.writeFileSync(filePath, "{broken", "utf8");

  const result = readJsonWithBackup(filePath, { width: 0 });
  assert.equal(result.source, "backup");
  assert.deepEqual(result.value, { width: 620 });
});

test("reader recovers from backup when the primary is missing", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-missing-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, "todo-store.json");
  fs.writeFileSync(`${filePath}.bak`, JSON.stringify({ list: [1] }));
  assert.equal(readJsonWithBackup(filePath, {}).source, "backup");
});

test("failed replacement preserves the primary and cleans up the temporary file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-write-failure-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, "todo-store.json");
  writeJsonAtomic(filePath, { version: 1 });
  const rename = t.mock.method(fs, "renameSync", () => {
    throw Object.assign(new Error("Locked file"), { code: "EACCES" });
  });
  assert.throws(() => writeJsonAtomic(filePath, { version: 2 }), /Locked file/);
  rename.mock.restore();
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { version: 1 });
  assert.equal(fs.readdirSync(tempDir).some(name => name.endsWith(".tmp")), false);
});
