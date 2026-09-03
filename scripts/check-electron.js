const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

try {
  const executable = require("electron");
  if (!fs.existsSync(executable)) throw new Error("Electron executable is missing");
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  const version = require("electron/package.json").version;
  if (result.error || result.status !== 0 || result.stdout.trim() !== `v${version}`) {
    throw result.error || new Error(result.stderr || "Electron version check failed");
  }
  console.log(`Electron ${version} executable verified`);
} catch (error) {
  console.error(`Electron installation is incomplete: ${error.message}`);
  console.error("Use the committed package-lock.json and run npm ci again.");
  process.exitCode = 1;
}
