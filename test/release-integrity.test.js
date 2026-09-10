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
  const files = [
    "index.html",
    "reminder.html",
    "preload.js",
    "renderer/renderer.js",
    "renderer/reminder.js",
    "renderer/styles.css",
    "renderer/reminder.css",
    "src/main/ipc.js",
  ];
  for (const file of files) assert.doesNotMatch(read(file), /TEST-ONLY|reset-test-data|fill-demo-data/);
});

test("HTML loads modular scripts and styles without inline blocks", () => {
  const index = read("index.html");
  const float = read("float.html");
  const reminder = read("reminder.html");
  assert.doesNotMatch(index, /<style[\s>]/i);
  assert.doesNotMatch(float, /<style[\s>]/i);
  assert.doesNotMatch(reminder, /<style[\s>]/i);
  assert.match(index, /src="\.\/src\/shared\/recurrence\.js"/);
  assert.match(index, /src="\.\/renderer\/renderer\.js"/);
  assert.match(float, /src="\.\/renderer\/float\.js"/);
  assert.match(reminder, /src="\.\/renderer\/reminder\.js"/);
});


test("custom reminder window replaces native system notifications", () => {
  const pkg = JSON.parse(read("package.json"));
  const main = read("main.js");
  const scheduler = read("src/main/reminderScheduler.js");
  const windows = read("src/main/windows.js");
  const ipc = read("src/main/ipc.js");
  const preload = read("preload.js");
  const store = read("src/main/todoStore.js");
  const mainRenderer = read("renderer/renderer.js");
  const reminderRenderer = read("renderer/reminder.js");
  const reminderHtml = read("reminder.html");
  const reminderCss = read("renderer/reminder.css");
  assert.ok(pkg.build.files.includes("reminder.html"));
  assert.match(pkg.scripts.check, /node --check renderer\/reminder\.js/);
  assert.doesNotMatch(scheduler, /\bNotification\b/);
  assert.match(main, /await prepareReminderWindow\(\);[\s\S]*?startReminderScheduler\(\{ showReminder \}\)/);
  assert.match(windows, /function createReminderWindow\(\)[\s\S]*?alwaysOnTop: true,[\s\S]*?skipTaskbar: true/);
  assert.match(windows, /function showReminder\(candidate\)[\s\S]*?isDuplicate[\s\S]*?reminderQueue\.push/);
  assert.match(ipc, /ipcMain\.handle\("reminder-action"[\s\S]*?snoozeTodoReminder\(reminder\.id, reminder\.key, 5\)/);
  assert.match(preload, /onReminderDisplay:[\s\S]*?ipcRenderer\.on\("reminder-display"/);
  assert.match(preload, /onOpenTodoDetail:[\s\S]*?ipcRenderer\.on\("open-todo-detail"/);
  assert.match(store, /function snoozeTodoReminder\(id, key, minutes = 5/);
  assert.match(reminderHtml, /id="snoozeButton"[\s\S]*?>5 分钟后提醒<\/button>/);
  assert.match(reminderHtml, /id="taskTitle"[\s\S]*?id="taskDescription"[\s\S]*?截止时间[\s\S]*?id="deadlineTime"/);
  assert.doesNotMatch(reminderHtml, /id="taskType"|id="reminderTime"/);
  assert.doesNotMatch(reminderRenderer, /普通待办|循环任务|今天/);
  assert.doesNotMatch(reminderHtml, /<span>任务提醒<\/span>/);
  assert.doesNotMatch(reminderCss, /border-(?:top|bottom):1px solid #e2e8f0/);
  assert.doesNotMatch(reminderHtml, /id="openAppButton"/);
  assert.match(reminderRenderer, /root\.addEventListener\("click"[\s\S]*?closest\("button"\)[\s\S]*?submitAction\("open"\)/);
  assert.match(mainRenderer, /onOpenTodoDetail\(openTodoDetailById\)/);
  assert.match(windows, /function showTodoDetailInMainWindow\(todoId\)[\s\S]*?webContents\.send\("open-todo-detail", id\)/);
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

test("unfinished floating-word entry remains commented out", () => {
  const index = read("index.html");
  const renderedIndex = index.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(index, /<!-- 单词悬浮入口暂时停用[\s\S]*?onclick="openFloat\(\)"[\s\S]*?-->/);
  assert.doesNotMatch(renderedIndex, /onclick="openFloat\(\)"/);
});
test("settings navigation occupies the lower sidebar slot", () => {
  const index = read("index.html");
  const styles = read("renderer/styles.css");
  assert.equal((index.match(/data-page="setting"/g) || []).length, 1);
  assert.match(index, /class="nav-item bottom-nav-item" data-page="setting" title="设置"/);
  assert.match(styles, /aside\{[\s\S]*?justify-content:space-between;/);
  assert.match(styles, /\.bottom-nav-item\{background:/);
});
test("calendar selection avoids rebuilding the month when task data is unchanged", () => {
  const renderer = read("renderer/renderer.js");
  assert.match(renderer, /let calendarDirty = true/);
  assert.match(renderer, /const navItems = \$\$\('\.nav-item'\)/);
  assert.match(renderer, /\$\$\("#calendarBody \.calendar-day\.active-day"\)\.forEach/);
  assert.match(renderer, /function selectCalendarDate\(dateStr\)\{[\s\S]*?updateCalendarSelection\(\)[\s\S]*?renderDayTaskPanel\(dateStr,calendarTodoCache\)/);
  assert.doesNotMatch(renderer, /dayDom\.onclick = async \(\) =>\{[\s\S]*?renderCalendar\(\)/);
});

test("task editors state the actual reminder schedule", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  for (const id of ["eReminderRule", "nReminderRule", "cReminderRule"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  for (const id of ["eTitle", "nTitle", "cTitle"]) {
    assert.match(index, new RegExp(`id="${id}" maxlength="80"`));
  }
  for (const id of ["eDesc", "nDesc"]) {
    assert.match(index, new RegExp(`id="${id}" maxlength="500"`));
  }
  for (const id of ["eTitleError", "nTitleError", "cTitleError"]) {
    assert.match(index, new RegExp(`id="${id}" aria-live="polite"`));
  }
  assert.match(renderer, /function showTitleError\(inputId\)[\s\S]*?input\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(renderer, /return alert\("请填写任务标题"\)/);
  assert.match(renderer, /function getReminderRule\(item\)/);
  assert.match(renderer, /不会提前一天或每天重复/);
  assert.match(renderer, /每周同一星期/);
});
test("main window provides maximize and restore controls", () => {
  const index = read("index.html");
  const renderer = read("renderer/renderer.js");
  const preload = read("preload.js");
  const ipc = read("src/main/ipc.js");
  const windows = read("src/main/windows.js");
  assert.match(index, /id="maximizeRestoreButton"/);
  assert.match(renderer, /async function toggleMainWindowMaximize\(\)[\s\S]*?electronAPI\.toggleMainWindowMaximize\(\)/);
  assert.match(preload, /toggleMainWindowMaximize: \(\) => ipcRenderer\.invoke\("win-toggle-maximize"\)/);
  assert.match(ipc, /ipcMain\.handle\("win-toggle-maximize", \(\) => windows\.toggleMainWindowMaximize\(\)\)/);
  assert.match(windows, /function toggleMainWindowMaximize\(\)[\s\S]*?isMaximized\(\)[\s\S]*?unmaximize\(\)[\s\S]*?maximize\(\)/);
});
test("main window uses opaque rounded content and the application icon", () => {
  const styles = read("renderer/styles.css");
  const renderer = read("renderer/renderer.js");
  const windows = read("src/main/windows.js");
  assert.match(styles, /body\{[\s\S]*?padding:10px;[\s\S]*?background:transparent;/);
  assert.match(styles, /#app-root\{[\s\S]*?border-radius:12px;[\s\S]*?background:#e7edf2;[\s\S]*?border:1px solid rgba\(100,116,139,0\.3\);[\s\S]*?box-shadow:0 1px 3px rgba\(15,23,42,0\.07\),0 7px 22px rgba\(15,23,42,0\.11\);/);
  assert.match(styles, /body\.window-maximized\{padding:0\}/);
  assert.match(renderer, /document\.body\.classList\.toggle\("window-maximized", isMaximized\)/);
  assert.match(windows, /transparent: true,[\s\S]*?backgroundColor: "#00000000"/);
  assert.match(windows, /const APP_ICON_PATH = path\.join\(APP_ROOT, "MyTodo\.ico"\);/);
  assert.match(windows, /new Tray\(APP_ICON_PATH\)/);
  assert.match(windows, /icon: APP_ICON_PATH/);
  assert.match(windows, /mainWindow\.setIcon\(APP_ICON_PATH\)/);
});
test("window overlays follow the app corners and leave room around details", () => {
  const index = read("index.html");
  const styles = read("renderer/styles.css");
  const windows = read("src/main/windows.js");
  const detailWidth = Number(/\.detail-modal\{[\s\S]*?width:(\d+)px;/.exec(styles)?.[1]);
  const minimumWidth = Number(/minWidth: (\d+),/.exec(windows)?.[1]);
  assert.match(styles, /\.modal-mask\{[\s\S]*?border-radius:12px;overflow:hidden;/);
  assert.match(styles, /\.drop-mask\{[\s\S]*?border-radius:12px;[\s\S]*?overflow:hidden;/);
  assert.ok(minimumWidth > detailWidth);
  assert.match(styles, /\.detail-row\{[\s\S]*?grid-template-columns:78px minmax\(0,1fr\);/);
  assert.match(styles, /\.detail-label\{[\s\S]*?text-align:right;/);
  assert.match(index, /class="detail-content"/);
  assert.match(styles, /\.detail-modal\{[\s\S]*?max-height:calc\(100vh - 48px\);/);
  assert.match(styles, /\.detail-content\{[\s\S]*?overflow-y:auto;/);
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
