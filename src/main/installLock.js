const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const INSTALL_LOCK_PATTERN = /^MyTodo-installing-(\d+)\.lock$/i;

function isProcessRunning(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function isInstallationInProgress(options = {}) {
  const directory = options.directory || os.tmpdir();
  const kill = options.kill || process.kill;
  let entries;

  try {
    entries = fs.readdirSync(directory);
  } catch {
    return false;
  }

  let active = false;
  for (const entry of entries) {
    const match = INSTALL_LOCK_PATTERN.exec(entry);
    if (!match) continue;

    const lockPath = path.join(directory, entry);
    const pid = Number.parseInt(match[1], 10);
    if (Number.isInteger(pid) && pid > 0 && isProcessRunning(pid, kill)) {
      active = true;
      continue;
    }

    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // A stale lock that cannot be removed must not permanently block startup.
    }
  }

  return active;
}

module.exports = {
  INSTALL_LOCK_PATTERN,
  isInstallationInProgress,
  isProcessRunning,
};
