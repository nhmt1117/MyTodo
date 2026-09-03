const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("release metadata is complete and consistent", () => {
  const packageText = read("package.json");
  const pkg = JSON.parse(packageText);
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.author, "nhmt");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.build.appId, "com.nhmt.mytodo");
  assert.equal(pkg.build.productName, "MyTodo");
  assert.ok(pkg.build.files.includes("LICENSE"));
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 nhmt/);
  assert.equal((packageText.match(/"verify:release"\s*:/g) || []).length, 1);
});

test("production sources contain no TEST-ONLY interface", () => {
  const files = ["index.html", "preload.js", "renderer/renderer.js", "renderer/styles.css", "src/main/ipc.js"];
  for (const file of files) assert.doesNotMatch(read(file), /TEST-ONLY|reset-test-data|fill-demo-data/);
});

test("HTML loads modular scripts and styles without inline blocks", () => {
  const index = read("index.html");
  const float = read("float.html");
  assert.doesNotMatch(index, /<style[\s>]/i);
  assert.doesNotMatch(float, /<style[\s>]/i);
  assert.match(index, /src="\.\/src\/shared\/recurrence\.js"/);
  assert.match(index, /src="\.\/renderer\/renderer\.js"/);
  assert.match(float, /src="\.\/renderer\/float\.js"/);
});

test("task deletion requires an explicit renderer confirmation", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  assert.match(index, /id="deleteModal"/);
  assert.match(index, /id="deleteConfirmBtn"/);
  assert.match(renderer, /function showDeleteModal\(itemId\)/);
  assert.match(renderer, /else if\(op === 'del'\)\{\s*showDeleteModal\(tid\)/);
  assert.match(renderer, /async function submitDelete\(\)[\s\S]*?electronAPI\.deleteTodo\(taskId\)/);
});

test("main window uses rounded corners and the application icon", () => {
  const styles = read("renderer/styles.css");
  const windows = read("src/main/windows.js");
  assert.match(styles, /body\{[\s\S]*?background:#e2e8f0;/);
  assert.match(styles, /#app-root\{[\s\S]*?border-radius:20px;/);
  assert.match(windows, /const APP_ICON_PATH = path\.join\(APP_ROOT, "MyTodo\.ico"\);/);
  assert.match(windows, /new Tray\(APP_ICON_PATH\)/);
  assert.match(windows, /icon: APP_ICON_PATH/);
  assert.match(windows, /mainWindow\.setIcon\(APP_ICON_PATH\)/);
});
test("Windows icon contains the common 16 through 256 pixel sizes", () => {
  const icon = fs.readFileSync(path.join(root, "MyTodo.ico"));
  const count = icon.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const size = icon[offset] || 256;
    const imageOffset = icon.readUInt32LE(offset + 12);
    const imageSize = icon.readUInt32LE(offset + 8);
    const image = icon.subarray(imageOffset, imageOffset + imageSize);
    entries.push({ size, image, bitCount: icon.readUInt16LE(offset + 6) });
  }
  assert.deepEqual(entries.map((entry) => entry.size), [16, 32, 48, 64, 128, 256]);
  for (const entry of entries) {
    assert.deepEqual(entry.image.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(entry.image.readUInt32BE(16), entry.size);
    assert.equal(entry.image.readUInt32BE(20), entry.size);
    assert.equal(entry.image[24], 8);
    assert.equal(entry.image[25], 6);
    assert.equal(entry.bitCount, 32);
  }
});
