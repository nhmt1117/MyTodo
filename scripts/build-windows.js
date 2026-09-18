const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const output = path.join(root, pkg.build.directories.output);
const backendName = `MyTodo-Backend-Setup-${pkg.version}.exe`;
const installerName = `${pkg.build.productName}-Setup-${pkg.version}.exe`;
const backendPath = path.join(output, backendName);
const installerPath = path.join(output, installerName);
const blockmapPath = `${installerPath}.blockmap`;
const shellOutput = path.join(output, "installer-shell");
const shellPath = path.join(shellOutput, "MyTodo.InstallerShell.exe");
const payloadMagic = Buffer.from("MYTODO-PAYLOAD-1", "ascii");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

async function appendFile(source, destination) {
  await pipeline(
    fs.createReadStream(source),
    fs.createWriteStream(destination, { flags: "a" }),
  );
}

async function build() {
  fs.mkdirSync(output, { recursive: true });
  for (const file of [installerPath, blockmapPath, path.join(output, "latest.yml")]) {
    fs.rmSync(file, { force: true });
  }
  fs.rmSync(shellOutput, { recursive: true, force: true });

  run(process.execPath, [
    path.join(root, "node_modules", "electron-builder", "cli.js"),
    "--win",
    "nsis",
  ]);

  if (!fs.existsSync(backendPath)) {
    throw new Error(`Missing backend installer: ${backendPath}`);
  }

  run("dotnet", [
    "publish",
    path.join(root, "installer-shell", "MyTodo.InstallerShell.csproj"),
    "--configuration",
    "Release",
    "--runtime",
    "win-x64",
    "--self-contained",
    "true",
    `-p:MyTodoVersion=${pkg.version}`,
    "--output",
    shellOutput,
  ]);

  if (!fs.existsSync(shellPath)) {
    throw new Error(`Missing installer shell: ${shellPath}`);
  }

  fs.copyFileSync(shellPath, installerPath);
  await appendFile(backendPath, installerPath);
  const footer = Buffer.allocUnsafe(8 + payloadMagic.length);
  footer.writeBigInt64LE(BigInt(fs.statSync(backendPath).size), 0);
  payloadMagic.copy(footer, 8);
  fs.appendFileSync(installerPath, footer);

  const updateInfo = await buildBlockMap(installerPath, "gzip", blockmapPath);
  const releaseDate = new Date().toISOString();
  const latest = [
    `version: ${pkg.version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${updateInfo.sha512}`,
    `    size: ${updateInfo.size}`,
    `path: ${installerName}`,
    `sha512: ${updateInfo.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(output, "latest.yml"), latest);

  fs.rmSync(backendPath, { force: true });
  fs.rmSync(`${backendPath}.blockmap`, { force: true });
  fs.rmSync(shellOutput, { recursive: true, force: true });

  console.log(`Built HTML installer: ${installerPath}`);
  console.log(`Installer size: ${(updateInfo.size / (1024 * 1024)).toFixed(1)} MB`);
}

build().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
