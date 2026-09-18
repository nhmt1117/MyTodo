const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("Windows release uses the HTML installer shell", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["build:win"], "node scripts/build-windows.js");
  assert.equal(pkg.build.nsis.artifactName, "MyTodo-Backend-Setup-${version}.${ext}");

  const project = fs.readFileSync(path.join(root, "installer-shell", "MyTodo.InstallerShell.csproj"), "utf8");
  assert.match(project, /Microsoft\.Web\.WebView2/);
  assert.match(project, /PublishSingleFile>true/);
});

test("installer shell keeps installation locking and payload validation", () => {
  const engine = fs.readFileSync(path.join(root, "installer-shell", "InstallerEngine.cs"), "utf8");
  const form = fs.readFileSync(path.join(root, "installer-shell", "InstallerForm.cs"), "utf8");
  const payload = fs.readFileSync(path.join(root, "installer-shell", "PayloadArchive.cs"), "utf8");
  const html = fs.readFileSync(path.join(root, "installer-shell", "wwwroot", "installer.html"), "utf8");
  const nsis = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf8");

  assert.match(engine, /MyTodo-installing-\{Environment\.ProcessId\}\.lock/);
  assert.match(engine, /PreventMyTodoLaunchesAsync/);
  assert.match(engine, /process\.Kill\(entireProcessTree: true\)/);
  assert.match(engine, /WaitForInstalledVersionAsync/);
  assert.match(engine, /EnsureUninstallRegistration\(\)/);
  assert.match(engine, /InstallLocation[\s\S]*?InstallDate[\s\S]*?UninstallString/);
  assert.match(engine, /SHChangeNotify[\s\S]*?SendMessageTimeout/);
  assert.match(form, /Opacity = 0d;[\s\S]*?RevealInstaller\(\)/);
  assert.match(payload, /MYTODO-PAYLOAD-1/);
  assert.match(html, /记下要做的，留住想要的。/);
  assert.match(html, /data-screen="update-progress"/);
  assert.match(nsis, /CreateShortCut "\$newStartMenuLink"[\s\S]*?MyTodoTaskbarV2\.ico/);
  assert.match(nsis, /CreateShortCut "\$newDesktopLink"[\s\S]*?MyTodoTaskbarV2\.ico/);
  assert.match(nsis, /WinShell::SetLnkAUMI "\$newStartMenuLink" "\$\{APP_ID\}"/);
  assert.match(nsis, /Shell32::SHChangeNotify/);
});
