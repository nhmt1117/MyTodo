const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const asar = require("@electron/asar");

const root = path.join(__dirname, "..");
const pkg = require("../package.json");
const output = path.join(root, pkg.build.directories.output);
const archive = path.join(output, "win-unpacked", "resources", "app.asar");
const expectedFiles = [
  "main.js", "preload.js", "index.html", "float.html", "reminder.html", "wordlist.json",
  "MyTodo.ico", "README.md", "LICENSE",
  "CHANGELOG.md", "V1_RELEASE_CHECKLIST.md", "V1_RELEASE_TEST_REPORT.md",
];

function addDirectory(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) addDirectory(relative);
    else expectedFiles.push(relative);
  }
}

addDirectory("src");
addDirectory("renderer");
for (const file of expectedFiles) {
  assert.deepEqual(asar.extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(root, file)),
    `Packaged file differs from source: ${file}`);
}

const allowed = new Set([...expectedFiles, "package.json"]);
for (const entry of asar.listPackage(archive)) {
  const file = entry.replace(/\\/g, "/").replace(/^\//, "");
  if (asar.statFile(archive, path.normalize(file)).files) continue;
  assert.ok(allowed.has(file), `Unexpected packaged file: ${file}`);
}
const packaged = JSON.parse(asar.extractFile(archive, "package.json"));
for (const key of ["name", "version", "author", "license", "main"]) {
  assert.deepEqual(packaged[key], pkg[key], `Packaged metadata mismatch: ${key}`);
}

const artifacts = [`${pkg.build.productName} Setup ${pkg.version}.exe`];
const checksums = artifacts.map((file) => {
  const content = fs.readFileSync(path.join(output, file));
  assert.ok(content.length > 1024 * 1024, `Installer is unexpectedly small: ${file}`);
  assert.equal(content.subarray(0, 2).toString(), "MZ", "Installer is not a Windows executable");
  return `${createHash("sha256").update(content).digest("hex")}  ${file}`;
});
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(`Verified ${expectedFiles.length} packaged source files and release metadata.`);
console.log(checksums.join("\n"));
