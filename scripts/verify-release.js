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
  "README.md", "LICENSE",
  "CHANGELOG.md", "V1_RELEASE_CHECKLIST.md", "V1_RELEASE_TEST_REPORT.md",
  "V2_RELEASE_CHECKLIST.md", "V2_RELEASE_TEST_REPORT.md",
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
addDirectory("assets");
for (const file of expectedFiles) {
  assert.deepEqual(asar.extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(root, file)),
    `Packaged file differs from source: ${file}`);
}

const allowed = new Set([...expectedFiles, "package.json"]);
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const lockPackages = Object.entries(packageLock.packages || {});
const dependencyNameFromPath = (packagePath) => {
  const parts = packagePath.replace(/\\/g, "/").split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 0 || !parts[index + 1]) return "";
  return parts[index + 1].startsWith("@")
    ? `${parts[index + 1]}/${parts[index + 2] || ""}`
    : parts[index + 1];
};
const allowedDependencyNames = new Set(Object.keys(pkg.dependencies || {}));
let dependencyCount = -1;
while (dependencyCount !== allowedDependencyNames.size) {
  dependencyCount = allowedDependencyNames.size;
  for (const [packagePath, metadata] of lockPackages) {
    if (metadata.dev === true || !allowedDependencyNames.has(dependencyNameFromPath(packagePath))) continue;
    for (const name of Object.keys(metadata.dependencies || {})) allowedDependencyNames.add(name);
  }
}
function packagedDependencyNames(file) {
  const parts = file.split("/");
  const names = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "node_modules" || !parts[index + 1]) continue;
    if (parts[index + 1].startsWith("@") && parts[index + 2]) {
      names.push(`${parts[index + 1]}/${parts[index + 2]}`);
      index += 2;
    } else {
      names.push(parts[index + 1]);
      index += 1;
    }
  }
  return names;
}
let updaterRuntimeFound = false;
for (const entry of asar.listPackage(archive)) {
  const file = entry.replace(/\\/g, "/").replace(/^\//, "");
  if (asar.statFile(archive, path.normalize(file)).files) continue;
  if (file.startsWith("node_modules/")) {
    const dependencyNames = packagedDependencyNames(file);
    assert.ok(dependencyNames.length > 0, `Invalid packaged dependency path: ${file}`);
    for (const name of dependencyNames) {
      assert.ok(allowedDependencyNames.has(name), `Unexpected packaged dependency: ${file}`);
    }
    if (file.startsWith("node_modules/electron-updater/")) updaterRuntimeFound = true;
    continue;
  }
  assert.ok(allowed.has(file), `Unexpected packaged file: ${file}`);
}
assert.ok(updaterRuntimeFound, "electron-updater runtime is missing from app.asar");
const packaged = JSON.parse(asar.extractFile(archive, "package.json"));
for (const key of ["name", "version", "author", "license", "main"]) {
  assert.deepEqual(packaged[key], pkg[key], `Packaged metadata mismatch: ${key}`);
}

const installerName = `${pkg.build.productName}-Setup-${pkg.version}.exe`;
const updateArtifacts = [installerName, `${installerName}.blockmap`, "latest.yml"];
for (const file of updateArtifacts) {
  assert.ok(fs.existsSync(path.join(output, file)), `Missing update artifact: ${file}`);
}
const updateInfo = fs.readFileSync(path.join(output, "latest.yml"), "utf8");
assert.match(updateInfo, new RegExp(`version:\\s*${pkg.version.replace(/\./g, "\\.")}`));
assert.ok(updateInfo.includes(installerName), "latest.yml does not reference the installer");
assert.match(updateInfo, /sha512:\s*\S+/);
const packagedUpdateConfig = fs.readFileSync(path.join(output, "win-unpacked", "resources", "app-update.yml"), "utf8");
assert.match(packagedUpdateConfig, /provider:\s*generic/);
assert.match(packagedUpdateConfig, /url:\s*https:\/\/github\.com\/nhmt1117\/MyTodo\/releases\/latest\/download/);
assert.deepEqual(
  fs.readFileSync(path.join(output, "win-unpacked", "resources", "MyTodo.ico")),
  fs.readFileSync(path.join(root, "MyTodo.ico")),
  "Runtime icon resource differs from the source icon",
);

const artifacts = [installerName];
const checksums = artifacts.map((file) => {
  const content = fs.readFileSync(path.join(output, file));
  assert.ok(content.length > 1024 * 1024, `Installer is unexpectedly small: ${file}`);
  assert.equal(content.subarray(0, 2).toString(), "MZ", "Installer is not a Windows executable");
  return `${createHash("sha256").update(content).digest("hex")}  ${file}`;
});
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(`Verified ${expectedFiles.length} packaged source files and release metadata.`);
console.log(checksums.join("\n"));
