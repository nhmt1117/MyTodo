const fs = require("node:fs");
const path = require("node:path");

const INSTALL_OPTIONS_FILE = "mytodo-install-options.json";

function consumeInstallerOptions(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const logger = options.logger || console;
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  if (!resourcesPath) return null;

  const filePath = path.join(resourcesPath, INSTALL_OPTIONS_FILE);
  if (!fileSystem.existsSync(filePath)) return null;

  try {
    const value = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || typeof value.autoStart !== "boolean") {
      throw new Error("Invalid installer options");
    }
    return { autoStart: value.autoStart };
  } catch (error) {
    logger.warn("Failed to read installer options", error);
    return null;
  } finally {
    try {
      fileSystem.rmSync(filePath, { force: true });
    } catch (error) {
      logger.warn("Failed to remove installer options", error);
    }
  }
}

module.exports = {
  INSTALL_OPTIONS_FILE,
  consumeInstallerOptions,
};
