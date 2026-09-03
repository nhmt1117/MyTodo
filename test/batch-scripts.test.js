const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Windows batch scripts preserve CRLF line endings", () => {
  for (const script of ["install.bat", "start.bat", "build.bat"]) {
    const content = fs.readFileSync(path.join(__dirname, "..", script), "utf8");
    assert.ok(content.includes("\r\n"), `${script} must use CRLF`);
    assert.doesNotMatch(content, /(?<!\r)\n/, `${script} contains bare LF`);
  }
});

function runScript(t, script, exitCode = 0, failCall = "") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo batch "));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, "npm-calls.txt");
  fs.mkdirSync(path.join(directory, "node_modules"));
  fs.writeFileSync(path.join(directory, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(directory, "npm.cmd"), [
    "@echo off",
    "echo %*>>\"%MYTODO_NPM_LOG%\"",
    'if "%*"=="%MYTODO_NPM_FAIL_CALL%" exit /b 1',
    "exit /b %MYTODO_NPM_EXIT%",
    "",
  ].join("\r\n"));
  fs.copyFileSync(path.join(__dirname, "..", script), path.join(directory, script));
  const result = spawnSync("cmd.exe", ["/d", "/c", `"${path.join(directory, script)}"`], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      MYTODO_NO_PAUSE: "1",
      MYTODO_NPM_LOG: log,
      MYTODO_NPM_EXIT: String(exitCode),
      MYTODO_NPM_FAIL_CALL: failCall,
    },
    encoding: "utf8",
    windowsVerbatimArguments: true,
    timeout: 10000,
    windowsHide: true,
  });
  return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
}

test("Windows scripts work outside their directory and return after npm", { skip: process.platform !== "win32" }, (t) => {
  const install = runScript(t, "install.bat");
  assert.equal(install.status, 0, install.stderr + install.stdout);
  assert.match(install.calls, /^ci --no-audit --progress --foreground-scripts --loglevel=http --timing/m);
  assert.match(install.calls, /run check:electron/);
  assert.match(install.stdout, /\[完成\]/);
  const build = runScript(t, "build.bat");
  assert.equal(build.status, 0, build.stderr + build.stdout);
  assert.match(build.calls, /run check/);
  assert.match(build.calls, /run build:win/);
  assert.match(build.calls, /run verify:release/);
  const start = runScript(t, "start.bat");
  assert.equal(start.status, 0, start.stderr + start.stdout);
  assert.match(start.calls, /start --/);
});

test("Windows scripts propagate npm failure", { skip: process.platform !== "win32" }, (t) => {
  for (const script of ["install.bat", "start.bat", "build.bat"]) {
    const result = runScript(t, script, 1);
    assert.equal(result.status, 1, `${script}: ${result.stderr + result.stdout}`);
    assert.ok(result.calls.trim(), `${script} must actually invoke npm`);
    if (script === "build.bat") assert.doesNotMatch(result.calls, /run build:win/);
  }
});

test("Windows install script rejects Electron verification failures", { skip: process.platform !== "win32" }, (t) => {
  const install = runScript(t, "install.bat", 0, "run check:electron");
  assert.equal(install.status, 1, install.stderr + install.stdout);
  assert.match(install.calls, /^ci /m);
  assert.match(install.calls, /run check:electron/);
});

test("Windows build script rejects packaging and artifact verification failures", { skip: process.platform !== "win32" }, (t) => {
  for (const stage of ["run build:win", "run verify:release"]) {
    const result = runScript(t, "build.bat", 0, stage);
    assert.equal(result.status, 1, `${stage}: ${result.stderr + result.stdout}`);
    assert.ok(result.calls.includes(stage), `Must invoke ${stage}`);
    if (stage === "run build:win") assert.doesNotMatch(result.calls, /run verify:release/);
  }
});
