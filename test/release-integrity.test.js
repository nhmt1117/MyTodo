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
  assert.equal(pkg.version, "2.0.10");
  assert.equal(pkg.author, "nhmt");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.build.appId, "com.nhmt.mytodo");
  assert.equal(pkg.build.productName, "MyTodo");
  assert.equal(pkg.build.electronDist, "node_modules/electron/dist");
  assert.deepEqual(pkg.build.extraResources, [
    { from: "MyTodo.ico", to: "MyTodo.ico" },
    { from: "MyTodo.ico", to: "MyTodoTaskbarV2.ico" },
  ]);
  assert.deepEqual(pkg.build.publish, {
    provider: "generic",
    url: "https://github.com/nhmt1117/MyTodo/releases/latest/download",
  });
  assert.equal(pkg.dependencies["electron-updater"], "^6.8.9");
  for (const file of ["LICENSE", "README.md", "CHANGELOG.md", "V2_RELEASE_CHECKLIST.md", "V2_RELEASE_TEST_REPORT.md"]) {
    assert.ok(pkg.build.files.includes(file), file + " must be packaged");
  }
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 nhmt/);
  assert.equal((packageText.match(/"verify:release"\s*:/g) || []).length, 1);
});

test("production sources contain no test-only interface", () => {
  for (const file of [
    "index.html", "reminder.html", "preload.js", "renderer/renderer.js",
    "renderer/reminder.js", "renderer/styles.css", "renderer/reminder.css",
    "src/main/ipc.js", "src/main/updateManager.js",
  ]) {
    assert.doesNotMatch(read(file), /TEST-ONLY|reset-test-data|fill-demo-data/);
  }
});

test("HTML uses modular scripts, styles and a restrictive content policy", () => {
  for (const file of ["index.html", "float.html", "reminder.html"]) {
    assert.doesNotMatch(read(file), /<style[\s>]/i);
  }
  const index = read("index.html");
  const float = read("float.html");
  const reminder = read("reminder.html");
  assert.match(index, /Content-Security-Policy/);
  assert.match(float, /Content-Security-Policy/);
  assert.match(reminder, /Content-Security-Policy/);
  assert.doesNotMatch(index + float + reminder, /onclick=/);
  assert.match(index, /src="\.\/src\/shared\/recurrence\.js"/);
  assert.match(index, /src="\.\/renderer\/renderer\.js"/);
  assert.match(float, /src="\.\/renderer\/float\.js"/);
  assert.match(reminder, /src="\.\/renderer\/reminder\.js"/);
});

test("2.0 uses one task editor and separates calendar from editing", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  const styles = read("renderer/styles.css");
  assert.equal((index.match(/id="taskModal"/g) || []).length, 1);
  assert.match(index, /id="taskTitle" maxlength="80"/);
  assert.match(index, /id="taskDescription" maxlength="500"/);
  assert.match(index, /id="taskReminderMode"/);
  assert.match(index, /id="reminderOffsets"[\s\S]*?data-offset="10080"[\s\S]*?data-offset="4320"[\s\S]*?data-offset="1440"[\s\S]*?data-offset="120"[\s\S]*?data-offset="0"/);
  assert.doesNotMatch(index, /id="taskRecommendation"|id="taskReminderCount"/);
  assert.doesNotMatch(index, /id="taskSchedule"/);
  assert.match(index, /id="calendarBody"/);
  assert.match(index, /id="dayTaskList"/);
  assert.doesNotMatch(index, /id="eTitle"|id="nTitle"|id="cTitle"/);
  assert.match(renderer, /function openTaskModal\(item, datePreset\)/);
  assert.match(renderer, /function updateReminderPreview\(\)/);
  assert.match(renderer, /function getCustomOffsets\(\)[\s\S]*?selectedCustomReminderOffsets/);
  assert.match(renderer, /function renderReminderOffsetButtons\(offsets, interactive, displayEntries = \[\]\)[\s\S]*?button\.disabled = !interactive[\s\S]*?reminder-offset-time/);
  assert.match(renderer, /#reminderOffsets"\)\.addEventListener\("click"[\s\S]*?selectedReminderMode !== "custom"/);
  assert.match(styles, /\.reminder-offset\.selected\{[\s\S]*?background:#e4e5ff/);
  assert.match(styles, /\.reminder-offset:disabled\{opacity:1;cursor:default}/);
  assert.match(styles, /\.reminder-modes \.segment\.active:hover\{color:#3730a3;background:#e4e5ff}/);
  assert.match(renderer, /customReminderOffsets: Object\.keys\(reminderOffsetLabels\)\.map\(Number\)[\s\S]*?renderReminderOffsetButtons\(recurrence\.getReminderOffsets\(draft\), isCustomMode, displayEntries\)/);
  assert.match(styles, /\.reminder-offset-time\{[\s\S]*?font-variant-numeric:tabular-nums/);
  assert.match(renderer, /function tasksOnDate\(dateValue\)/);
  assert.match(renderer, /window\.electronAPI\.getTodoList\(\)/);
  assert.doesNotMatch(renderer, /calendarTodoCache|showLoading/);
  assert.match(renderer, /function reminderBellHtml\(extraClass = ""\)[\s\S]*?aria-label="已开启提醒"/);
  assert.doesNotMatch(renderer, /reminder-dot/);
  assert.match(renderer, /class="agenda-reminder-slot"[\s\S]*?reminderBell/);
  assert.match(styles, /\.agenda-title-line\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) 18px/);
  assert.match(styles, /\.agenda-item strong\{[\s\S]*?text-overflow:ellipsis/);
  assert.match(index, /id="copyLastTask">复制上次创建<\/button>/);
  assert.match(renderer, /function getLastCreatedTask\(\)[\s\S]*?function copyLastCreatedTask\(\)/);
  assert.match(index, /id="backTopBtn"[\s\S]*?aria-label="回到顶部"/);
  assert.match(renderer, /function bindBackToTop\(\)[\s\S]*?scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.match(styles, /\.back-top-button\{[\s\S]*?position:fixed;[\s\S]*?border-radius:50%/);
  assert.match(renderer, /async function completeTaskWithAnimation\(row, item\)[\s\S]*?is-completing[\s\S]*?is-leaving/);
  assert.match(renderer, /function formatHomeGroupDate\(dateValue\)[\s\S]*?"今天 "[\s\S]*?"明天 "/);
  assert.match(renderer, /const tasksByDate = new Map\(\)[\s\S]*?formatHomeGroupDate\(date\)/);
  });

test("custom reminder window supports variable snooze, completion and summaries", () => {
  const main = read("main.js");
  const scheduler = read("src/main/reminderScheduler.js");
  const windows = read("src/main/windows.js");
  const ipc = read("src/main/ipc.js");
  const preload = read("preload.js");
  const reminderRenderer = read("renderer/reminder.js");
  const reminderHtml = read("reminder.html");
  const reminderCss = read("renderer/reminder.css");
  assert.doesNotMatch(scheduler, /\bNotification\b/);
  assert.match(scheduler, /const CHECK_INTERVAL_MS = 30 \* 1000/);
  assert.match(scheduler, /const LOOKAHEAD_MS = 60 \* 1000/);
  assert.match(scheduler, /const PRECISION_INTERVAL_MS = 1000/);
  assert.match(scheduler, /function queueUpcomingReminders\([\s\S]*?getUpcomingReminderEntries/);
  assert.match(main, /await prepareReminderWindow\(\);[\s\S]*?startReminderScheduler\(\{ showReminder \}\)/);
  assert.match(windows, /function createReminderWindow\(\)[\s\S]*?alwaysOnTop: true,[\s\S]*?skipTaskbar: true,[\s\S]*?hasShadow: true/);
  assert.match(windows, /const config = getGlobalConfig\(\);[\s\S]*?soundEnabled: config\.notificationSound !== false/);
  assert.match(windows, /"top-center": \{ width: 640, height: 190 \}/);
  assert.match(windows, /autoplayPolicy: "no-user-gesture-required"/);
  assert.match(windows, /displayId: \+\+reminderDisplaySequence/);
  assert.match(windows, /setIgnoreMouseEvents\(true\)[\s\S]*?targetWindow\.hide\(\)[\s\S]*?targetWindow\.isVisible\(\)[\s\S]*?targetWindow\.destroy\(\)/);
  assert.match(windows, /if \(reminderQueue\.length\) showNextReminder\(\);[\s\S]*?else hideReminderWindow\(\)/);
  assert.match(windows, /\["dismiss", "open", "snooze", "skip", "complete"\]/);
  assert.match(windows, /handledReminder\.kind === "summary"/);
  assert.match(ipc, /snoozeTodoReminder\(reminder\.id, reminder\.key, snoozeMinutes\)/);
  assert.match(ipc, /setArchived\(reminder\.id, true\)/);
  assert.match(preload, /onReminderDisplay:[\s\S]*?ipcRenderer\.on\("reminder-display"/);
  assert.match(preload, /onTodoDataChanged:[\s\S]*?ipcRenderer\.on\("todo-data-changed"/);
  assert.match(reminderHtml, /data-minutes="15"[\s\S]*?data-minutes="60"[\s\S]*?data-minutes="tomorrow"[\s\S]*?data-action="skip"/);
  assert.match(reminderHtml, /id="primaryActionButton"/);
  assert.match(reminderHtml, /src="\.\/assets\/mytodo-icon-source\.png"/);
  assert.match(reminderHtml, /id="notificationSound" src="\.\/assets\/soft-bell-ding\.mp3"/);
  assert.ok(fs.statSync(path.join(root, "assets", "soft-bell-ding.mp3")).size > 0);
  assert.match(reminderRenderer, /function playNotificationSound\(payload\)[\s\S]*?notificationSound\.play\(\)/);
  assert.match(reminderRenderer, /const AUTO_CLOSE_SECONDS = 15/);
  assert.match(reminderRenderer, /const ACTION_RESPONSE_TIMEOUT_MS = 2500/);
  assert.match(reminderRenderer, /function isSameReminderDisplay\(left, right\)[\s\S]*?displayId/);
  assert.match(reminderRenderer, /Promise\.race\([\s\S]*?ACTION_RESPONSE_TIMEOUT_MS/);
  assert.match(reminderRenderer, /if \(response\.accepted\) currentReminder = null;[\s\S]*?setActionPending\(false\)/);
  assert.match(reminderRenderer, /分钟后（" \+ autoCloseSeconds \+ " 秒）/);
  assert.match(reminderRenderer, /submitAction\("snooze", \{ minutes: DEFAULT_SNOOZE_MINUTES \}\)/);
  assert.match(reminderRenderer, /submitAction\("skip"\)/);
  assert.match(reminderCss, /body\{padding:0;[\s\S]*?background:#f4f7fa;/);
  assert.doesNotMatch(reminderCss, /\.reminder-root\{[^}]*box-shadow:/);
  assert.match(reminderCss, /\.reminder-root\[data-placement="top-center"\] \.reminder-content\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(reminderCss, /\.reminder-root\[data-kind="summary"\] #taskDescription\{[\s\S]*?white-space:pre-line/);
  assert.match(reminderCss, /\.snooze-menu\{[\s\S]*?background:#f8fafc;/);
  assert.match(reminderRenderer, /kind === "summary" \? "open" : "complete"/);
  assert.match(reminderRenderer, /root\.addEventListener\("click"[\s\S]*?submitAction\("open"\)/);
});

test("task deletion requires an explicit confirmation dialog", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  assert.match(index, /id="detailModal"[\s\S]*?id="deleteFromDetail"/);
  assert.match(index, /id="deleteModal"/);
  assert.match(index, /id="confirmDelete"/);
  assert.match(renderer, /function askDelete\(id\)/);
  assert.match(renderer, /"#deleteFromDetail"[\s\S]*?askDelete\(detailItem\.id\)/);
  assert.match(renderer, /async function confirmDelete\(\)[\s\S]*?electronAPI\.deleteTodo\(deleteTargetId\)/);
});

test("unfinished floating-word entry stays out of the 2.0 navigation", () => {
  const index = read("index.html");
  assert.doesNotMatch(index, /openFloat|toggleFloatWin|单词悬浮/);
  assert.equal((index.match(/data-page="setting"/g) || []).length, 1);
  assert.match(index, /class="nav-item bottom-nav-item" data-page="setting"/);
});

test("calendar interactions reuse in-memory tasks without an async reload", () => {
  const renderer = read("renderer/renderer.js");
  const renderCalendarSource = /function renderCalendar\(\) \{[\s\S]*?\n\}/.exec(renderer)?.[0] || "";
  assert.match(renderCalendarSource, /tasksOnDate\(dateValue\)/);
  assert.doesNotMatch(renderCalendarSource, /getTodoList|await /);
  assert.match(renderer, /button\.addEventListener\("click", \(\) => \{[\s\S]*?selectedCalendarDate = button\.dataset\.date;[\s\S]*?renderCalendar\(\)/);
});

test("main window preserves rounded opaque content and native controls", () => {
  const index = read("index.html");
  const styles = read("renderer/styles.css");
  const renderer = read("renderer/renderer.js");
  const windows = read("src/main/windows.js");
  assert.match(index, /id="maximizeRestoreButton"/);
  assert.match(index, /class="app-brand"[\s\S]*?<span>MyTodo<\/span>/);
  assert.doesNotMatch(index, /MyTodo 个人待办/);
  assert.doesNotMatch(index, /onclick=/);
  assert.match(index, /id="minimizeButton"[\s\S]*?id="maximizeRestoreButton"[\s\S]*?id="closeMainWindowButton"/);
  assert.match(renderer, /minimizeButton[\s\S]*?winMinimize\(\)/);
  assert.match(renderer, /closeMainWindowButton[\s\S]*?winClose\(\)/);
  assert.match(styles, /body\{[\s\S]*?padding:0;[\s\S]*?background:transparent;/);
  assert.match(styles, /#app-root\{[\s\S]*?border:1px solid rgba\(100,116,139,\.3\);[\s\S]*?border-radius:10px;[\s\S]*?background:#e7edf2;/);
  assert.match(styles, /\.btn\.primary\{[^}]*background:#4f46e5;/);
  assert.match(styles, /\.nav-item\.active\{color:#4f46e5;background:#d8d8ff\}/);
  assert.match(styles, /body\.window-maximized\{padding:0\}/);
  assert.match(renderer, /async function toggleMainWindowMaximize\(\)[\s\S]*?electronAPI\.toggleMainWindowMaximize\(\)/);
  assert.match(windows, /minWidth: 860,[\s\S]*?minHeight: 680/);
  assert.match(windows, /transparent: true,[\s\S]*?backgroundColor: "#00000000"/);
  assert.match(windows, /frame: false,[\s\S]*?hasShadow: true,[\s\S]*?resizable: true/);
  assert.match(windows, /const APP_ICON_PATH = getAppIconPath\(\);/);
  assert.match(windows, /const APP_USER_MODEL_ID = "com\.nhmt\.mytodo";/);
  assert.match(windows, /function applyTaskbarDetails\(targetWindow\)[\s\S]*?appId: APP_USER_MODEL_ID,[\s\S]*?appIconPath: APP_TASKBAR_ICON_PATH,[\s\S]*?appIconIndex: 0,[\s\S]*?relaunchCommand:[\s\S]*?relaunchDisplayName: "MyTodo"/);
  assert.match(windows, /new Tray\(APP_ICON_PATH\)/);
});

test("overlays follow the application corners and detail labels align", () => {
  const styles = read("renderer/styles.css");
  assert.match(styles, /\.modal-mask\{[\s\S]*?inset:0;[\s\S]*?border-radius:10px;/);
  assert.match(styles, /\.modal-box\{[\s\S]*?border-radius:14px;[\s\S]*?background:rgba\(255,255,255,\.32\);[\s\S]*?backdrop-filter:blur\(14px\);/);
  assert.match(styles, /\.modal-header\{[\s\S]*?border-bottom:0;/);
  assert.match(styles, /\.modal-footer\{[\s\S]*?border-top:0;[\s\S]*?background:transparent;/);
  assert.match(styles, /\.drop-mask\{[\s\S]*?inset:0;[\s\S]*?border-radius:10px;/);
  assert.match(styles, /\.modal-box\{[\s\S]*?padding:22px;[\s\S]*?background:rgba\(255,255,255,\.32\);[\s\S]*?backdrop-filter:blur\(14px\);/);
  assert.match(styles, /\.modal-header\{[\s\S]*?margin-bottom:16px;[\s\S]*?padding:0;/);
  assert.match(styles, /\.modal-scroll\{[\s\S]*?padding:0 6px 0 0/);
  assert.match(styles, /\.drop-menu\{[\s\S]*?border-radius:14px;[\s\S]*?background:rgba\(255,255,255,\.26\);[\s\S]*?backdrop-filter:blur\(14px\);/);
  assert.match(styles, /\.detail-modal\{width:min\(520px,calc\(100vw - 100px\)\);/);
  assert.match(styles, /\.detail-row\{[\s\S]*?grid-template-columns:76px minmax\(0,1fr\);/);
  assert.match(styles, /\.detail-label\{color:#7b8795;text-align:right\}/);
  assert.match(styles, /\.page-scroll,\.agenda-list,\.modal-scroll,\.detail-content,\.form-row textarea\{scrollbar-gutter:stable\}/);
  assert.match(styles, /\.task-check\{[\s\S]*?width:32px;[\s\S]*?height:32px;/);
  assert.match(styles, /\.task-row\.is-leaving\{[\s\S]*?max-height:0;[\s\S]*?translateX\(42px\)/);
});

test("Windows installer update flow uses GitHub release assets and direct upgrade installation", () => {
  const pkg = JSON.parse(read("package.json"));
  const main = read("main.js");
  const manager = read("src/main/updateManager.js");
  const ipc = read("src/main/ipc.js");
  const preload = read("preload.js");
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  const workflow = read(".github/workflows/release-windows.yml");
  assert.equal(pkg.build.win.target, "nsis");
  assert.equal(pkg.build.nsis.artifactName, "MyTodo-Backend-Setup-${version}.${ext}");
  assert.equal(pkg.scripts["build:win"], "node scripts/build-windows.js");
  assert.match(main, /startUpdateManager\([\s\S]*?notifyStatus: notifyUpdateStatus/);
  assert.match(main, /stopUpdateManager\(\)/);
  assert.match(manager, /platform !== "win32"/);
  assert.match(manager, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(manager, /updater\.autoDownload = false/);
  assert.match(manager, /updater\.autoInstallOnAppQuit = false/);
  assert.match(manager, /installAfterDownload = true[\s\S]*?updater\.downloadUpdate\(\)/);
  assert.match(manager, /on\("update-downloaded"[\s\S]*?startDownloadedInstallation\(\)/);
  assert.match(manager, /phase: "installing"/);
  assert.match(manager, /quitAndInstall\(false, true\)/);
  assert.match(ipc, /ipcMain\.handle\("check-for-updates"/);
  assert.match(ipc, /ipcMain\.handle\("download-update"/);
  assert.doesNotMatch(ipc, /ipcMain\.handle\("install-update"/);
  assert.match(preload, /onUpdateStatus:[\s\S]*?ipcRenderer\.on\("update-status"/);
  assert.match(index, /id="autoCheckUpdatesCheck"/);
  assert.match(index, /id="updateProgress"/);
  assert.match(index, /id="updateProgressDetail"/);
  assert.match(index, /id="updateActionButton"/);
  assert.match(index, /id="updateAvailableModal"/);
  assert.match(index, /id="updateLaterButton"/);
  assert.match(index, /id="updateNowButton"/);
  assert.match(renderer, /function renderUpdateState\(nextState, announce\)/);
  assert.match(renderer, /function showUpdateAvailableModal\(state\)/);
  assert.match(renderer, /phase === "available"[\s\S]*?showUpdateAvailableModal\(updateState\)/);
  assert.match(renderer, /function formatUpdateRate\(bytesPerSecond\)/);
  assert.match(renderer, /正在下载 " \+ Math\.round\(percent\) \+ "%"/);
  assert.match(renderer, /window\.electronAPI\.downloadUpdate\(\)/);
  assert.match(renderer, /buttonText = "下载并安装 " \+ version/);
  assert.doesNotMatch(renderer, /重启并安装/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /tags:[\s\S]*?- "\*"/);
  assert.match(workflow, /\$tagVersion = "\$\{\{ github\.ref_name \}\}" -replace '\^v', ''/);
  assert.match(workflow, /if \(\$version -ne \$tagVersion\)/);
  assert.match(workflow, /\$asset = "dist\/MyTodo-Setup-\$version\.exe"/);
  assert.match(workflow, /\$assets = @\(\$asset, "\$asset\.blockmap", "dist\/latest\.yml"\)/);
  assert.match(workflow, /gh release upload \$tag \$assets --clobber/);
  assert.match(workflow, /gh release create[\s\S]*?--notes-file/);
  assert.match(workflow, /Get-Content -LiteralPath "CHANGELOG\.md" -Raw/);
  assert.match(workflow, /CHANGELOG\.md does not contain release notes for \$version/);
  assert.doesNotMatch(workflow, /修复从早期版本升级后/);
  assert.doesNotMatch(workflow, /--draft/);
  assert.doesNotMatch(workflow, /runs-on: (?:ubuntu|macos)/);
});

test("Windows installer confirms reinstall and upgrade, blocks downgrade, and syncs auto-start", () => {
  const pkg = JSON.parse(read("package.json"));
  const installer = read("build/installer.nsh");
  const engine = read("installer-shell/InstallerEngine.cs");
  const form = read("installer-shell/InstallerForm.cs");
  const html = read("installer-shell/wwwroot/installer.html");
  const buildScript = read("scripts/build-windows.js");
  const main = read("main.js");
  const config = read("src/main/config.js");
  const installOptions = read("src/main/installOptions.js");
  const windows = read("src/main/windows.js");

  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.include, "build/installer.nsh");
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false);
  assert.match(engine, /CompareVersions[\s\S]*?InstallerMode\.Same[\s\S]*?InstallerMode\.Downgrade[\s\S]*?InstallerMode\.Upgrade/);
  assert.match(engine, /EnsureMyTodoDirectory[\s\S]*?Path\.GetFileName[\s\S]*?Path\.Combine\(fullPath, ProductName\)/);
  assert.match(engine, /IsMyTodoRunning\(\)[\s\S]*?Process\.GetProcessesByName\(ProductName\)/);
  assert.match(engine, /CreateInstallLock\(\)[\s\S]*?PreventMyTodoLaunchesAsync/);
  assert.match(engine, /PreventMyTodoLaunchesAsync[\s\S]*?process\.Kill\(entireProcessTree: true\)/);
  assert.match(engine, /ArgumentList\.Add\("\/S"\)[\s\S]*?--updated[\s\S]*?\/D=/);
  assert.match(engine, /WaitForInstalledVersionAsync[\s\S]*?DisplayVersion[\s\S]*?File\.Exists\(executable\)/);
  assert.match(engine, /CurrentVersion\\Run[\s\S]*?--hidden/);
  assert.match(form, /FormBorderStyle = FormBorderStyle\.None/);
  assert.match(form, /NormalWidth = 580[\s\S]*?NormalHeight = 360[\s\S]*?CompactWidth = 520[\s\S]*?CompactHeight = 230/);
  assert.match(form, /MinimumSize = Size;[\s\S]*?MaximumSize = Size;/);
  assert.match(form, /DwmSetWindowAttribute\(Handle, 33[\s\S]*?DwmSetWindowAttribute\(Handle, 34/);
  assert.match(form, /InstallerMode\.Fresh => "welcome"[\s\S]*?InstallerMode\.Upgrade => "upgrade"[\s\S]*?InstallerMode\.Same => "same"[\s\S]*?InstallerMode\.Downgrade => "downgrade"/);
  assert.match(form, /_screen = _inAppUpdate \? "update-progress" : "progress"/);
  assert.match(html, /欢迎使用 MyTodo[\s\S]*?记下要做的，留住想要的。/);
  assert.match(html, /已安装相同版本[\s\S]*?无需重新安装/);
  assert.match(html, /无法安装较旧版本[\s\S]*?不支持降级安装/);
  assert.match(html, /MyTodo 正在运行[\s\S]*?安装尚未开始/);
  assert.match(html, /data-screen="update-progress"[\s\S]*?data-screen="update-finish"/);
  assert.match(buildScript, /MyTodo-Backend-Setup-/);
  assert.match(buildScript, /MYTODO-PAYLOAD-1/);
  assert.match(buildScript, /productName}-Setup-/);
  assert.match(main, /isInstallationInProgress\(\)[\s\S]*?if \(installationInProgress\) \{[\s\S]*?app\.quit\(\)/);
  assert.match(installer, /!macro customInstallMode[\s\S]*?isForceMachineInstall "0"[\s\S]*?isForceCurrentInstall "1"/);
  assert.match(installer, /!macro customUnInstall[\s\S]*?DeleteRegValue/);
  assert.match(main, /consumeInstallerOptions\(\)[\s\S]*?setGlobalConfig\(installerOptions\)/);
  assert.match(main, /createMainWindow\(\{ showOnReady: !process\.argv\.includes\("--hidden"\) \}\)/);
  assert.match(config, /setLoginItemSettings\([\s\S]*?args: \["--hidden"\]/);
  assert.match(installOptions, /typeof value\.autoStart !== "boolean"[\s\S]*?rmSync/);
  assert.match(windows, /const showOnReady = options\.showOnReady !== false[\s\S]*?if \(showOnReady\) mainWindow\.show\(\)/);
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

test("desktop release protects one local instance and exposes recovery tools", () => {
  const main = read("main.js");
  const preload = read("preload.js");
  const ipc = read("src/main/ipc.js");
  const support = read("src/main/supportTools.js");
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  const windows = read("src/main/windows.js");
  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance"[\s\S]*?showMainWindow\(\)/);
  assert.match(main, /app\.on\("before-quit"[\s\S]*?stopReminderScheduler\(\)[\s\S]*?stopUpdateManager\(\)[\s\S]*?prepareForApplicationQuit\(\)/);
  assert.match(main, /showStartupStorageNotice\(\)/);
  assert.match(windows, /function destroyTray\(\)[\s\S]*?tray\.destroy\(\)/);
  assert.match(windows, /function prepareForApplicationQuit\(\)[\s\S]*?destroyTray\(\)[\s\S]*?destroyManagedWindows\(\)[\s\S]*?app\.exit\(0\)/);
  assert.match(windows, /function quitApplication\(\)[\s\S]*?prepareForApplicationQuit\(\)[\s\S]*?app\.quit\(\)/);
  assert.match(windows, /function requestCloseMainWindow\(\)[\s\S]*?close-confirmation-requested/);
  assert.match(windows, /function resolveCloseMainWindow\(action, dontAskAgain = false\)[\s\S]*?closeWithoutPromptAction[\s\S]*?config: updatedConfig/);
  assert.match(windows, /function cancelCloseMainWindow\(\)[\s\S]*?closePromptPending = false/);
  assert.match(windows, /APP_TASKBAR_ICON_PATH = app\.isPackaged && process\.resourcesPath[\s\S]*?MyTodoTaskbarV2\.ico/);
  assert.match(windows, /appIconPath: APP_TASKBAR_ICON_PATH/);
  assert.match(windows, /tray\.on\("click"[\s\S]*?showMainWindow\(\)/);
  assert.match(windows, /function getAppIconPath\(\)[\s\S]*?process\.resourcesPath[\s\S]*?MyTodo\.ico/);
  assert.match(ipc, /ipcMain\.on\("win-close", windows\.requestCloseMainWindow\)/);
  assert.match(ipc, /ipcMain\.handle\("resolve-close-confirmation"[\s\S]*?resolveCloseMainWindow/);
  assert.match(ipc, /ipcMain\.handle\("cancel-close-confirmation"[\s\S]*?cancelCloseMainWindow/);
  assert.match(index, /id="openDataLocationBtn"/);
  assert.match(index, /id="exportDataBackupBtn"/);
  assert.match(index, /id="restoreDataBackupBtn"/);
  assert.match(index, /id="restoreDataModal"[\s\S]*?id="confirmRestoreData"/);
  assert.doesNotMatch(index, /id="openLogDirectoryBtn"|<strong>运行日志<\/strong>/);
  assert.match(index, /class="about-version-line"[\s\S]*?id="appVersion"[\s\S]*?id="updateActionButton"/);
  assert.match(index, /\.\/assets\/mytodo-icon-source\.png/);
  assert.doesNotMatch(index, /id="updateStatusText"|id="reminderServiceStatus"|提醒服务/);
  assert.match(index, /id="closeToTrayPromptCheck"/);
  assert.match(index, /id="closeAppModal"[\s\S]*?id="closeAppDontAsk"[\s\S]*?id="closeToTrayButton"[\s\S]*?id="quitAppButton"/);
  assert.match(index, /id="notificationSoundCheck"/);
  assert.match(preload, /getStorageStatus:[\s\S]*?exportDataBackup:[\s\S]*?selectDataBackup:[\s\S]*?restoreDataBackup:[\s\S]*?openLogDirectory:/);
  assert.match(preload, /resolveCloseConfirmation:[\s\S]*?cancelCloseConfirmation:[\s\S]*?onCloseConfirmationRequested:/);
  assert.match(ipc, /get-reminder-service-status/);
  assert.match(ipc, /open-data-directory[\s\S]*?export-data-backup[\s\S]*?select-data-backup[\s\S]*?restore-data-backup[\s\S]*?open-log-directory/);
  assert.match(support, /function getStorageStatus\(\)/);
  assert.match(support, /function getPreRestoreBackupFileName[\s\S]*?MyTodo-Before-Restore-/);
  assert.match(support, /function restoreDataBackup\(filePath\)[\s\S]*?getPreRestoreBackupFileName\(\)/);
  assert.match(renderer, /closeToTrayPromptCheck[\s\S]*?saveConfigPatch\(\{ closeToTrayPrompt:/);
  assert.match(renderer, /function showCloseAppModal\(\)[\s\S]*?closeAppModal/);
  assert.match(renderer, /function cancelCloseAppModal\(\)[\s\S]*?cancelCloseConfirmation/);
  assert.match(renderer, /resolveCloseConfirmation\(action, dontAskAgain\)[\s\S]*?appConfig = result\.config[\s\S]*?applyConfigToSettings\(\)/);
  assert.match(renderer, /event\.key === "Escape"[\s\S]*?cancelCloseAppModal\(\)[\s\S]*?electronAPI\.winClose\(\)/);
  assert.match(renderer, /function chooseDataBackupForRestore\(\)[\s\S]*?selectDataBackup\(\)/);
  assert.match(renderer, /function confirmRestoreData\(\)[\s\S]*?restoreDataBackup\(pendingRestoreBackup\.filePath\)/);
  assert.match(main, /powerMonitor[\s\S]*?"resume"[\s\S]*?"unlock-screen"[\s\S]*?refreshReminderSchedule/);
  assert.match(windows, /render-process-gone[\s\S]*?recoverReminderRenderer/);
  assert.match(windows, /function recoverMainRenderer[\s\S]*?reloadIgnoringCache/);
});

test("desktop retains hidden multi-device groundwork for later development", () => {
  const packageJson = JSON.parse(read("package.json"));
  const index = read("index.html");
  const preload = read("preload.js");
  const ipc = read("src/main/ipc.js");
  const manager = read("src/main/syncManager.js");
  const renderer = read("renderer/renderer.js");

  assert.equal(packageJson.dependencies.qrcode, "^1.5.4");
  assert.match(index, /<!-- 多端同步尚未面向本地版用户开放。[\s\S]*?data-setting="syncSetting"[\s\S]*?-->/);
  assert.match(index, /<!-- 多端同步设置保留用于后续开发[\s\S]*?id="recoverSyncButton"[\s\S]*?id="pairPhoneButton"[\s\S]*?id="syncDeviceList"[\s\S]*?-->/);
  assert.match(index, /id="syncRecoverModal"[\s\S]*?id="syncPairingModal"[\s\S]*?id="syncConflictModal"/);
  assert.match(preload, /recoverSyncAccount:[\s\S]*?createPairingSession:[\s\S]*?listSyncDevices:[\s\S]*?resolveSyncConflict:/);
  assert.match(ipc, /recover-sync-account[\s\S]*?create-pairing-session[\s\S]*?list-sync-devices[\s\S]*?resolve-sync-conflict/);
  assert.match(manager, /async function recoverSyncAccount[\s\S]*?async function createPairingSession/);
  assert.match(manager, /function getSyncConflicts[\s\S]*?async function resolveSyncConflict/);
  assert.match(renderer, /async function pollPairingStatus[\s\S]*?async function resolveActiveConflict/);
});

test("development reminders are hidden and blocked in packaged builds", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  const preload = read("preload.js");
  const ipc = read("src/main/ipc.js");
  const windows = read("src/main/windows.js");
  assert.match(index, /class="btn secondary hidden" id="triggerTestReminderButton"/);
  assert.match(renderer, /triggerTestReminderButton[\s\S]*?classList\.toggle\("hidden", !!appInfo\.isPackaged\)/);
  assert.match(preload, /triggerDevelopmentReminder:[\s\S]*?invoke\("trigger-development-reminder"\)/);
  assert.match(ipc, /handle\("trigger-development-reminder"[\s\S]*?if \(app\.isPackaged\) return false/);
  assert.match(windows, /developmentTest: !!candidate\.developmentTest/);
});
