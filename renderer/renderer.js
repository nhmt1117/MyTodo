const recurrence = window.todoRecurrence;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let appConfig = {};
let todoList = [];
let activePage = "home";
let activeFilter = "today";
let sortType = "date-asc";
let searchText = "";
let currentDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = recurrence.formatLocalDate(new Date());
let selectedPriority = "mid";
let selectedTaskType = "normal";
let selectedReminderMode = "auto";
let selectedCustomReminderOffsets = [4320, 1440, 0];
let detailItem = null;
let deleteTargetId = null;
let refreshPending = false;
let updateState = null;
let lastUpdatePhase = "";
let backTopTarget = null;

const priorityNames = { high: "高", mid: "中", low: "低" };
const priorityOrder = { high: 0, mid: 1, low: 2 };
const reminderModeNames = {
  auto: "自动推荐",
  gentle: "轻提醒",
  standard: "标准提醒",
  strong: "强提醒",
  custom: "自定义",
};
const reminderOffsetLabels = {
  10080: "提前 7 天",
  4320: "提前 3 天",
  1440: "提前 1 天",
  120: "提前 2 小时",
  0: "截止时",
};
const cycleNames = { daily: "每日", weekly: "每周", monthly: "每月" };

function reminderBellHtml(extraClass = "") {
  const className = ["reminder-icon", extraClass].filter(Boolean).join(" ");
  return '<svg class="' + className + '" viewBox="0 0 24 24" role="img" aria-label="已开启提醒"><title>已开启提醒</title><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33Z"/></svg>';
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayString() {
  return recurrence.formatLocalDate(new Date());
}

function addDays(dateValue, amount) {
  const date = typeof dateValue === "string"
    ? recurrence.parseLocalDate(dateValue)
    : new Date(dateValue);
  if (!date || Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(amount || 0));
  return date;
}

function formatChineseDate(dateValue, includeWeekday) {
  const date = typeof dateValue === "string"
    ? recurrence.parseLocalDate(dateValue)
    : new Date(dateValue);
  if (!date || Number.isNaN(date.getTime())) return "未设置";
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const base = (date.getMonth() + 1) + "月" + date.getDate() + "日";
  return includeWeekday ? base + " " + weekdays[date.getDay()] : base;
}

function formatHomeGroupDate(dateValue) {
  const date = recurrence.parseLocalDate(dateValue);
  if (!date) return "未设置日期";
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  const today = todayString();
  const tomorrow = recurrence.formatLocalDate(addDays(today, 1));
  if (dateValue === today) return "今天 " + weekday;
  if (dateValue === tomorrow) return "明天 " + weekday;
  return formatChineseDate(date, false) + " " + weekday;
}

function formatShortDateTime(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return pad(value.getMonth() + 1) + "/" + pad(value.getDate()) + " " +
    pad(value.getHours()) + ":" + pad(value.getMinutes());
}

function getOccurrenceDateValue(item, from) {
  if (!item) return "";
  if (!item.isCycle) return item.date || "";
  const occurrence = recurrence.getNextOccurrenceDate(item, from || new Date());
  return occurrence ? recurrence.formatLocalDate(occurrence) : "";
}

function getDueAt(item, dateValue) {
  const date = dateValue || getOccurrenceDateValue(item);
  return recurrence.createLocalDateTime(date, item.dueTime || item.remindTime || "09:00");
}

function classifyTask(item, now) {
  const reference = now || new Date();
  if (item.archived) return { type: "archived", date: item.date || "", dueAt: getDueAt(item, item.date) };
  const dateValue = getOccurrenceDateValue(item, reference);
  const dueAt = getDueAt(item, dateValue);
  const today = recurrence.formatLocalDate(reference);
  const weekEnd = recurrence.formatLocalDate(addDays(today, 7));
  let overdue = false;
  if (dueAt && dueAt < reference) overdue = !item.isCycle || dateValue === today;
  return {
    type: overdue ? "overdue" : dateValue === today ? "today" :
      dateValue > today && dateValue <= weekEnd ? "week" : "later",
    date: dateValue,
    dueAt,
  };
}

function itemMatchesSearch(item) {
  if (!searchText) return true;
  const haystack = (String(item.text || "") + "\n" + String(item.desc || "")).toLowerCase();
  return haystack.includes(searchText.toLowerCase());
}

function sortTasks(items) {
  return [...items].sort((left, right) => {
    const leftInfo = classifyTask(left);
    const rightInfo = classifyTask(right);
    if (sortType === "prio-high") {
      const priorityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
      if (priorityDifference) return priorityDifference;
    }
    const leftTime = leftInfo.dueAt ? leftInfo.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = rightInfo.dueAt ? rightInfo.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (sortType === "date-desc") return rightTime - leftTime || right.id - left.id;
    return leftTime - rightTime || priorityOrder[left.priority] - priorityOrder[right.priority] || left.id - right.id;
  });
}

function formatTaskTime(item, info) {
  const dateValue = info.date;
  const time = item.dueTime || item.remindTime || "09:00";
  if (!dateValue) return "未设置日期";
  const today = todayString();
  const tomorrow = recurrence.formatLocalDate(addDays(today, 1));
  let label = formatChineseDate(dateValue, false);
  if (dateValue === today) label = "今天";
  if (dateValue === tomorrow) label = "明天";
  if (item.isCycle) label += " · " + (cycleNames[item.cycleType] || "循环");
  return label + " " + time;
}

function getReminderScheduleForItem(item, from) {
  if (!item || !item.remind || item.muteRemind) return [];
  const dateValue = getOccurrenceDateValue(item, from);
  return dateValue ? recurrence.getReminderSchedule(item, dateValue) : [];
}

function getReminderSummary(item) {
  if (!item.remind) return "不提醒";
  if (item.muteRemind) return "已关闭该任务提醒";
  const schedule = getReminderScheduleForItem(item);
  if (!schedule.length) return "未生成提醒节点";
  const mode = item.reminderMode || "auto";
  const effectiveMode = recurrence.getEffectiveReminderMode(item);
  const modeText = mode === "auto"
    ? "自动推荐（" + reminderModeNames[effectiveMode] + "）"
    : reminderModeNames[mode];
  return modeText + "：" + schedule.map((entry) => entry.reason).join("、");
}

function setPage(pageName) {
  activePage = pageName;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === pageName));
  $$(".nav-item[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageName);
  });
  closeDropMenu();
  if (pageName === "home") renderHome();
  if (pageName === "calendar") renderCalendar();
  const scrollTarget = document.querySelector("#" + pageName + " .page-scroll, #" + pageName + " .agenda-list");
  setBackTopTarget(scrollTarget);
}

function updateSummary() {
  const active = todoList.filter((item) => !item.archived);
  const infos = active.map((item) => ({ item, info: classifyTask(item) }));
  $("#overdueCount").textContent = String(infos.filter((entry) => entry.info.type === "overdue").length);
  $("#todayCount").textContent = String(infos.filter((entry) => entry.info.date === todayString()).length);
  $("#weekCount").textContent = String(infos.filter((entry) => entry.info.type === "week").length);
}

function getHomeGroups() {
  const matching = todoList.filter(itemMatchesSearch);
  const active = matching.filter((item) => !item.archived);
  const archived = matching.filter((item) => item.archived);
  if (activeFilter === "archived") return [{ title: "已归档", items: sortTasks(archived) }];
  if (activeFilter === "all") return [{ title: "全部未完成", items: sortTasks(active) }];

  const withInfo = active.map((item) => ({ item, info: classifyTask(item) }));
  const overdueGroup = {
    title: "已逾期",
    items: sortTasks(withInfo.filter((entry) => entry.info.type === "overdue").map((entry) => entry.item)),
  };
  if (activeFilter === "week") {
    const tasksByDate = new Map();
    withInfo
      .filter((entry) => entry.info.type === "today" || entry.info.type === "week")
      .forEach((entry) => {
        const dateItems = tasksByDate.get(entry.info.date) || [];
        dateItems.push(entry.item);
        tasksByDate.set(entry.info.date, dateItems);
      });
    const dateGroups = [...tasksByDate.entries()]
      .sort(([left], [right]) => {
        return sortType === "date-desc" ? right.localeCompare(left) : left.localeCompare(right);
      })
      .map(([date, items]) => ({ title: formatHomeGroupDate(date), items: sortTasks(items) }));
    return [overdueGroup, ...dateGroups];
  }
  return [
    overdueGroup,
    { title: "今天", items: sortTasks(withInfo.filter((entry) => entry.info.type === "today").map((entry) => entry.item)) },
  ];
}

function taskRowHtml(item) {
  const info = classifyTask(item);
  const description = String(item.desc || "").trim();
  return '<article class="task-row ' + (item.archived ? "archived" : "") + '" data-id="' + item.id + '">' +
    '<button type="button" class="task-check" data-action="toggle" title="' +
      (item.archived ? "恢复任务" : "完成任务") + '" aria-label="' +
      (item.archived ? "恢复任务" : "完成任务") + '"></button>' +
    '<div class="task-main">' +
      '<div class="task-title-line"><span class="task-title">' + escapeHtml(item.text) + '</span>' +
      (item.isCycle ? '<span class="type-badge">循环</span>' : "") +
      (item.remind && !item.muteRemind ? reminderBellHtml() : "") +
      '</div>' +
      '<div class="task-description">' + escapeHtml(description || "无备注") + '</div>' +
    '</div>' +
    '<div class="task-meta">' +
      '<span class="meta-time ' + (info.type === "overdue" ? "is-overdue" : "") + '">' + escapeHtml(formatTaskTime(item, info)) + '</span>' +
      '<span class="priority-badge ' + item.priority + '">' + priorityNames[item.priority] + '</span>' +
    '</div>' +
    '<button type="button" class="more-button" data-action="menu" title="更多操作" aria-label="更多操作"></button>' +
  '</article>';
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function completeTaskWithAnimation(row, item) {
  if (row.classList.contains("is-completing")) return;
  const button = row.querySelector('[data-action="toggle"]');
  button.disabled = true;
  row.classList.add("is-completing");

  try {
    const [updated] = await Promise.all([
      window.electronAPI.archiveTodo(item.id),
      wait(360),
    ]);
    if (!updated) throw new Error("任务不存在或已被删除");
    row.classList.add("is-leaving");
    await wait(280);
    await refreshTodoData();
  } catch (error) {
    row.classList.remove("is-completing", "is-leaving");
    button.disabled = false;
    showToast("操作失败：" + (error.message || "请稍后重试"));
  }
}

function bindTaskRows(container) {
  container.querySelectorAll(".task-row").forEach((row) => {
    const item = todoList.find((entry) => entry.id === Number(row.dataset.id));
    if (!item) return;
    row.addEventListener("click", () => showDetailModal(item));
    row.querySelector('[data-action="toggle"]').addEventListener("click", async (event) => {
      event.stopPropagation();
      if (item.archived) await toggleArchived(item);
      else await completeTaskWithAnimation(row, item);
    });
    row.querySelector('[data-action="menu"]').addEventListener("click", (event) => {
      event.stopPropagation();
      showTaskMenu(event.currentTarget, item);
    });
  });
}

function renderHome() {
  updateSummary();
  const heading = $("#home .page-heading h1");
  const titles = { today: "今天", week: "未来 7 天", all: "全部待办", archived: "已归档" };
  heading.textContent = titles[activeFilter];
  $("#homeSubtitle").textContent = formatChineseDate(new Date(), true) + " · " +
    todoList.filter((item) => !item.archived).length + " 项未完成";
  $$("#taskFilters .filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === activeFilter);
  });
  const groups = getHomeGroups().filter((group) => group.items.length);
  const container = $("#taskGroups");
  container.innerHTML = groups.map((group) => {
    return '<section class="task-group"><header class="task-group-head"><h2>' +
      escapeHtml(group.title) + '</h2><span class="task-group-count">' +
      group.items.length + ' 项</span></header><div class="task-list">' +
      group.items.map(taskRowHtml).join("") + '</div></section>';
  }).join("");
  $("#homeEmpty").classList.toggle("hidden", groups.length > 0);
  bindTaskRows(container);
}

function tasksOnDate(dateValue) {
  return todoList.filter((item) => {
    if (item.archived) return false;
    if (item.isCycle) return recurrence.occursOnDate(item, dateValue);
    return item.date === dateValue;
  }).sort((left, right) => {
    const timeDifference = String(left.dueTime || "").localeCompare(String(right.dueTime || ""));
    return timeDifference || priorityOrder[left.priority] - priorityOrder[right.priority];
  });
}

function renderAgenda() {
  const selectedDate = recurrence.parseLocalDate(selectedCalendarDate);
  const items = tasksOnDate(selectedCalendarDate);
  $("#agendaTitle").textContent = formatChineseDate(selectedDate, true);
  $("#agendaCount").textContent = items.length ? items.length + " 项任务" : "没有安排";
  const list = $("#dayTaskList");
  if (!items.length) {
    list.innerHTML = '<div class="agenda-empty">这一天还没有任务</div>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const reminderBell = item.remind && !item.muteRemind ? reminderBellHtml("agenda-reminder-icon") : "";
    return '<button type="button" class="agenda-item ' + item.priority + '" data-id="' + item.id + '">' +
      '<span class="agenda-title-line"><strong>' + escapeHtml(item.text) +
      '</strong><span class="agenda-reminder-slot">' + reminderBell + '</span></span><span class="agenda-meta">' +
      escapeHtml((item.dueTime || item.remindTime || "09:00") +
        (item.isCycle ? " · " + (cycleNames[item.cycleType] || "循环") : "")) +
      '</span></button>';
  }).join("");
  list.querySelectorAll(".agenda-item").forEach((button) => {
    button.addEventListener("click", () => {
      const item = todoList.find((entry) => entry.id === Number(button.dataset.id));
      if (item) showDetailModal(item);
    });
  });
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  $("#monthTitle").textContent = year + " 年 " + (month + 1) + " 月";
  $("#calendarSubtitle").textContent = todoList.filter((item) => !item.archived).length + " 项任务的时间分布";
  const weekDays = appConfig.weekStartMon
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["日", "一", "二", "三", "四", "五", "六"];
  $("#weekRow").innerHTML = weekDays.map((day) => "<span>周" + day + "</span>").join("");

  const first = new Date(year, month, 1);
  const weekStart = appConfig.weekStartMon ? 1 : 0;
  const offset = (first.getDay() - weekStart + 7) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const dateValue = recurrence.formatLocalDate(date);
    const items = tasksOnDate(dateValue);
    const visible = items.slice(0, 2);
    const classes = [
      "calendar-day",
      date.getMonth() === month ? "" : "outside",
      dateValue === selectedCalendarDate ? "selected" : "",
      dateValue === todayString() ? "today" : "",
    ].filter(Boolean).join(" ");
    cells.push('<button type="button" class="' + classes + '" data-date="' + dateValue + '">' +
      '<span class="day-number">' + date.getDate() + '</span><span class="day-items">' +
      visible.map((item) => '<span class="calendar-task ' + item.priority + '">' +
        escapeHtml(item.text) + '</span>').join("") +
      (items.length > visible.length ? '<span class="calendar-more">+' + (items.length - visible.length) + ' 项</span>' : "") +
      '</span></button>');
  }
  $("#calendarBody").innerHTML = cells.join("");
  $("#calendarBody").querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCalendarDate = button.dataset.date;
      const selected = recurrence.parseLocalDate(selectedCalendarDate);
      if (selected.getMonth() !== currentDate.getMonth() || selected.getFullYear() !== currentDate.getFullYear()) {
        currentDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
      }
      renderCalendar();
    });
  });
  renderAgenda();
}

function closeDropMenu() {
  $("#globalDropMask").classList.add("hidden");
  $("#globalDrop").classList.add("hidden");
  $("#globalDrop").innerHTML = "";
}

function showTaskMenu(anchor, item) {
  const actions = item.archived
    ? [
        { label: "恢复任务", run: () => toggleArchived(item) },
        { label: "删除任务", danger: true, run: () => askDelete(item.id) },
      ]
    : [
        { label: "编辑任务", run: () => openTaskModal(item) },
        { label: item.isCycle ? "停止循环" : "完成任务", run: () => toggleArchived(item) },
        ...(item.remind && !item.muteRemind
          ? [{ label: "关闭该任务提醒", run: () => muteReminder(item) }]
          : []),
        { label: "删除任务", danger: true, run: () => askDelete(item.id) },
      ];
  const menu = $("#globalDrop");
  menu.innerHTML = actions.map((action, index) => {
    return '<button type="button" class="drop-item ' + (action.danger ? "danger" : "") +
      '" data-index="' + index + '">' + escapeHtml(action.label) + '</button>';
  }).join("");
  menu.classList.remove("hidden");
  $("#globalDropMask").classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(14, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 14));
  let top = rect.bottom + 5;
  if (top + menu.offsetHeight > window.innerHeight - 14) top = rect.top - menu.offsetHeight - 5;
  menu.style.left = left + "px";
  menu.style.top = Math.max(14, top) + "px";
  menu.querySelectorAll(".drop-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = actions[Number(button.dataset.index)];
      closeDropMenu();
      if (action) await action.run();
    });
  });
}

async function toggleArchived(item) {
  try {
    if (item.archived) await window.electronAPI.unarchiveTodo(item.id);
    else await window.electronAPI.archiveTodo(item.id);
    await refreshTodoData();
  } catch (error) {
    showToast("操作失败：" + (error.message || "请稍后重试"));
  }
}

async function muteReminder(item) {
  try {
    await window.electronAPI.muteTodoRemind(item.id);
    await refreshTodoData();
    showToast("已关闭该任务提醒");
  } catch (error) {
    showToast("操作失败：" + (error.message || "请稍后重试"));
  }
}

function setSegmentValue(containerSelector, value) {
  $$(containerSelector + " .segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === value);
  });
}

function getCustomOffsets() {
  return [...selectedCustomReminderOffsets];
}

function setCustomOffsets(offsets) {
  selectedCustomReminderOffsets = [...new Set(
    (Array.isArray(offsets) ? offsets : []).map(Number).filter(Number.isFinite),
  )].sort((left, right) => right - left);
}

function renderReminderOffsetButtons(offsets, interactive, displayEntries = []) {
  const selected = new Set(Array.isArray(offsets) ? offsets.map(Number) : []);
  const entriesByOffset = new Map(displayEntries.map((entry) => [Number(entry.offsetMinutes), entry]));
  $$("#reminderOffsets .reminder-offset").forEach((button) => {
    const offset = Number(button.dataset.offset);
    const isSelected = selected.has(offset);
    const entry = entriesByOffset.get(offset);
    const dateTime = entry ? formatShortDateTime(entry.reminderAt) : "未设时间";
    const label = reminderOffsetLabels[offset] || "";
    button.classList.toggle("selected", isSelected);
    button.disabled = !interactive;
    button.setAttribute("aria-pressed", String(isSelected));
    button.setAttribute("aria-label", dateTime + " " + label);
    button.innerHTML = '<span class="reminder-offset-time">' + escapeHtml(dateTime) +
      '</span><span class="reminder-offset-label">' + escapeHtml(label) + "</span>";
  });
}

function updateTaskTypeUi() {
  const isCycle = selectedTaskType === "cycle";
  $("#cycleTypeRow").classList.toggle("hidden", !isCycle);
  $("#taskDateLabel").textContent = isCycle ? "首次日期" : "截止日期";
  updateReminderPreview();
}

function updateReminderPreview() {
  const enabled = $("#taskReminderEnabled").checked;
  const reminderConfig = $("#taskReminderConfig");
  reminderConfig.classList.toggle("hidden", !enabled);
  if (!enabled) return;
  const effectiveMode = recurrence.getEffectiveReminderMode({
    priority: selectedPriority,
    reminderMode: selectedReminderMode,
  });
  const priorityLabel = priorityNames[selectedPriority];
  $("#reminderDefaultText").textContent = selectedReminderMode === "auto"
    ? priorityLabel + "优先级默认使用" + reminderModeNames[effectiveMode]
    : "当前使用" + reminderModeNames[selectedReminderMode];
  const isCustomMode = selectedReminderMode === "custom";

  const dateValue = $("#taskDate").value;
  const draft = {
    date: dateValue,
    dueTime: $("#taskDueTime").value || "09:00",
    remindTime: $("#taskDueTime").value || "09:00",
    priority: selectedPriority,
    reminderMode: selectedReminderMode,
    customReminderOffsets: getCustomOffsets(),
    isCycle: selectedTaskType === "cycle",
    cycleType: $("#taskCycleType").value,
  };
  let occurrenceDate = dateValue;
  if (draft.isCycle && dateValue) {
    const next = recurrence.getNextOccurrenceDate(draft, new Date());
    occurrenceDate = next ? recurrence.formatLocalDate(next) : dateValue;
  }
  const displayEntries = occurrenceDate
    ? recurrence.getReminderSchedule({
      ...draft,
      isCycle: false,
      reminderMode: "custom",
      customReminderOffsets: Object.keys(reminderOffsetLabels).map(Number),
    }, occurrenceDate)
    : [];
  renderReminderOffsetButtons(recurrence.getReminderOffsets(draft), isCustomMode, displayEntries);
}

function getLastCreatedTask() {
  return [...todoList].sort((left, right) => {
    const leftCreatedAt = new Date(left.createdAt).getTime() || 0;
    const rightCreatedAt = new Date(right.createdAt).getTime() || 0;
    return rightCreatedAt - leftCreatedAt || Number(right.id) - Number(left.id);
  })[0] || null;
}

function fillTaskEditor(item, datePreset) {
  const source = item || null;
  $("#taskTitle").value = source ? source.text : "";
  $("#taskDescription").value = source ? source.desc || "" : "";
  $("#taskDate").value = source ? source.date || todayString() : datePreset || todayString();
  $("#taskDueTime").value = source ? source.dueTime || source.remindTime || "09:00" : "18:00";
  selectedPriority = source ? source.priority : "mid";
  selectedTaskType = source && source.isCycle ? "cycle" : "normal";
  selectedReminderMode = source ? source.reminderMode || "auto" : "auto";
  $("#taskCycleType").value = source && source.cycleType ? source.cycleType : "daily";
  $("#taskReminderEnabled").checked = source ? !!source.remind && !source.muteRemind : true;
  setCustomOffsets(source ? source.customReminderOffsets : [4320, 1440, 0]);
  setSegmentValue("#taskPriority", selectedPriority);
  setSegmentValue("#taskType", selectedTaskType);
  setSegmentValue("#taskReminderMode", selectedReminderMode);
  updateTaskTypeUi();
}

function openTaskModal(item, datePreset) {
  const editing = !!item;
  const previous = getLastCreatedTask();
  $("#taskModalTitle").textContent = editing ? "编辑待办" : "新建待办";
  $("#taskId").value = editing ? String(item.id) : "";
  fillTaskEditor(item, datePreset);
  $("#copyLastTask").classList.toggle("hidden", editing);
  $("#copyLastTask").disabled = !previous;
  $("#copyLastTask").title = previous ? "复制上次创建任务的全部内容" : "还没有可复制的任务";
  clearTitleError();
  $("#taskModal").classList.remove("hidden");
  setTimeout(() => $("#taskTitle").focus(), 0);
}

function copyLastCreatedTask() {
  if ($("#taskId").value) return;
  const previous = getLastCreatedTask();
  if (!previous) {
    showToast("还没有可复制的任务");
    return;
  }
  fillTaskEditor(previous);
  clearTitleError();
  $("#taskTitle").focus();
  $("#taskTitle").select();
  showToast("已复制上次创建的任务");
}

function closeTaskModal() {
  $("#taskModal").classList.add("hidden");
  clearTitleError();
}

function showTitleError(message) {
  $("#taskTitleError").textContent = message;
  $("#taskTitleError").classList.remove("hidden");
  $("#taskTitle").classList.add("field-invalid");
  $("#taskTitle").focus();
}

function clearTitleError() {
  $("#taskTitleError").textContent = "";
  $("#taskTitleError").classList.add("hidden");
  $("#taskTitle").classList.remove("field-invalid");
}

async function saveTask() {
  const title = $("#taskTitle").value.trim();
  if (!title) {
    showTitleError("请填写任务标题");
    return;
  }
  const dateValue = $("#taskDate").value;
  if (!dateValue || !recurrence.parseLocalDate(dateValue)) {
    showToast("请选择有效日期");
    $("#taskDate").focus();
    return;
  }
  const editingId = Number($("#taskId").value);
  const payload = {
    text: title,
    desc: $("#taskDescription").value,
    date: dateValue,
    dueTime: $("#taskDueTime").value || "09:00",
    remindTime: $("#taskDueTime").value || "09:00",
    priority: selectedPriority,
    remind: $("#taskReminderEnabled").checked,
    reminderMode: selectedReminderMode,
    customReminderOffsets: getCustomOffsets(),
    isCycle: selectedTaskType === "cycle",
    cycleType: selectedTaskType === "cycle" ? $("#taskCycleType").value : "",
    muteRemind: false,
  };
  try {
    $("#saveTask").disabled = true;
    const result = editingId
      ? await window.electronAPI.updateTodo({ ...payload, id: editingId })
      : await window.electronAPI.addTodoItem(payload);
    if (!result) {
      showToast("任务未能保存，请检查填写内容");
      return;
    }
    closeTaskModal();
    await refreshTodoData();
    showToast(editingId ? "任务已更新" : "任务已创建");
  } catch (error) {
    showToast("保存失败：" + (error.message || "请稍后重试"));
  } finally {
    $("#saveTask").disabled = false;
  }
}

function showDetailModal(item) {
  detailItem = item;
  const info = classifyTask(item);
  $("#detailTitle").textContent = item.text;
  $("#detailDescription").textContent = String(item.desc || "").trim() || "无备注";
  $("#detailDateLabel").textContent = item.isCycle ? "下次发生" : "截止时间";
  $("#detailDeadline").textContent = info.date
    ? formatChineseDate(info.date, true) + " " + (item.dueTime || item.remindTime || "09:00")
    : "未设置";
  $("#detailPriority").innerHTML = '<span class="priority-badge ' + item.priority + '">' +
    priorityNames[item.priority] + '</span>';
  $("#detailType").textContent = item.isCycle
    ? (cycleNames[item.cycleType] || "循环") + "循环"
    : "普通待办";
  $("#detailReminder").textContent = getReminderSummary(item);
  $("#detailModal").classList.remove("hidden");
}

function closeDetailModal() {
  $("#detailModal").classList.add("hidden");
}

function askDelete(id) {
  deleteTargetId = Number(id);
  $("#deleteModal").classList.remove("hidden");
}

function closeDeleteModal() {
  deleteTargetId = null;
  $("#deleteModal").classList.add("hidden");
}

function showCloseAppModal() {
  $("#closeAppDontAsk").checked = false;
  $("#closeAppModal").classList.remove("hidden");
  $("#closeToTrayButton").focus();
}

async function resolveCloseAppModal(action) {
  if ($("#closeAppModal").classList.contains("hidden")) return;
  const dontAskAgain = $("#closeAppDontAsk").checked;
  $("#closeAppModal").classList.add("hidden");
  const result = await window.electronAPI.resolveCloseConfirmation(action, dontAskAgain);
  if (result && result.config) {
    appConfig = result.config;
    applyConfigToSettings();
  }
}

async function cancelCloseAppModal() {
  if ($("#closeAppModal").classList.contains("hidden")) return;
  $("#closeAppModal").classList.add("hidden");
  await window.electronAPI.cancelCloseConfirmation();
}

async function confirmDelete() {
  if (!Number.isFinite(deleteTargetId)) return;
  try {
    await window.electronAPI.deleteTodo(deleteTargetId);
    closeDeleteModal();
    closeDetailModal();
    await refreshTodoData();
    showToast("任务已删除");
  } catch (error) {
    showToast("删除失败：" + (error.message || "请稍后重试"));
  }
}

function showToast(message) {
  const previous = $(".toast");
  if (previous) previous.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = String(message || "");
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

function setBackTopTarget(target) {
  backTopTarget = target || null;
  $("#backTopBtn").classList.toggle("show", !!backTopTarget && backTopTarget.scrollTop > 120);
}

function bindBackToTop() {
  $$(".page-scroll, .agenda-list").forEach((target) => {
    target.addEventListener("scroll", () => {
      if (!target.closest(".page.active")) return;
      setBackTopTarget(target);
    });
  });
  $("#backTopBtn").addEventListener("click", () => {
    if (backTopTarget) backTopTarget.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function triggerDevelopmentReminder() {
  const button = $("#triggerTestReminderButton");
  try {
    button.disabled = true;
    const shown = await window.electronAPI.triggerDevelopmentReminder();
    showToast(shown ? "已触发测试提醒" : "测试提醒暂时无法显示");
  } catch (error) {
    showToast("触发失败：" + (error.message || "请稍后重试"));
  } finally {
    button.disabled = false;
  }
}

async function saveConfigPatch(patch) {
  try {
    appConfig = await window.electronAPI.setGlobalConfig(patch);
  } catch (error) {
    showToast("设置保存失败：" + (error.message || "请稍后重试"));
  }
}

function applyConfigToSettings() {
  $("#weekStartSel").value = String(appConfig.weekStartMon !== false);
  $("#autoStartCheck").checked = !!appConfig.autoStart;
  $("#closeToTrayPromptCheck").checked = appConfig.closeToTrayPrompt !== false;
  $("#autoCheckUpdatesCheck").checked = appConfig.autoCheckUpdates !== false;
  $("#notificationSoundCheck").checked = appConfig.notificationSound !== false;
  $("#weeklySummaryCheck").checked = appConfig.weeklySummary !== false;
  $("#dailySummaryCheck").checked = appConfig.dailySummary !== false;
  $("#dailySummaryTime").value = appConfig.dailySummaryTime || "09:00";
  $("#quietHoursCheck").checked = appConfig.quietHoursEnabled !== false;
  $("#quietStart").value = appConfig.quietStart || "22:00";
  $("#quietEnd").value = appConfig.quietEnd || "08:00";
}

function renderDataLocation(location) {
  const input = $("#dataLocationPath");
  input.value = location && location.directory ? location.directory : "";
  input.title = input.value;
  $("#dataLocationSummary").textContent = location && location.isCustom
    ? "正在使用自定义本地文件夹"
    : "默认保存在应用旁的 MyTodoData 文件夹";
}

function renderStorageStatus(status) {
  const target = $("#dataHealthText");
  if (!status || typeof status !== "object") {
    target.textContent = "暂时无法读取数据状态";
    target.dataset.tone = "error";
    return;
  }

  const messages = Object.values(status.components || {})
    .filter((entry) => entry && entry.state !== "ok")
    .map((entry) => entry.message)
    .filter(Boolean);
  target.textContent = status.state === "ok"
    ? "本地数据正常，已启用原子写入与自动备份"
    : messages.join("；");
  target.title = messages.join("\n");
  target.dataset.tone = status.state || "error";
}

function renderUpdateState(nextState, announce) {
  if (!nextState || typeof nextState !== "object") return;
  updateState = { ...nextState };
  const phase = updateState.phase || "idle";
  const version = updateState.availableVersion ? "v" + updateState.availableVersion : "";
  const button = $("#updateActionButton");
  const progress = $("#updateProgress");
  const progressBar = $("#updateProgressBar");
  const percent = Math.max(0, Math.min(100, Number(updateState.percent) || 0));
  let action = "check";
  let buttonText = "检查更新";
  let disabled = false;

  if (phase === "unsupported") {
    disabled = true;
  } else if (phase === "checking") {
    buttonText = "正在检查";
    disabled = true;
  } else if (phase === "available") {
    action = "download";
    buttonText = "下载 " + version;
  } else if (phase === "downloading") {
    buttonText = "正在下载";
    disabled = true;
  } else if (phase === "downloaded") {
    action = "install";
    buttonText = "重启并安装";
  } else if (phase === "error") {
    disabled = updateState.supported === false;
  }

  button.dataset.action = action;
  button.textContent = buttonText;
  button.disabled = disabled;
  button.classList.toggle("primary", action === "download" || action === "install");
  button.classList.toggle("secondary", action === "check");
  progress.classList.toggle("hidden", phase !== "downloading");
  progress.setAttribute("aria-valuenow", String(Math.round(percent)));
  progressBar.style.width = percent + "%";

  if (announce && phase !== lastUpdatePhase) {
    if (phase === "available") showToast("发现 MyTodo " + version + "，可在设置中下载");
    if (phase === "downloaded") showToast(version + " 已下载，可重启完成安装");
    if (phase === "up-to-date" && updateState.manual) showToast("当前已是最新版本");
    if (phase === "error" && updateState.manual) showToast("检查更新失败，请稍后重试");
  }
  lastUpdatePhase = phase;
}

async function handleUpdateAction() {
  const button = $("#updateActionButton");
  const action = button.dataset.action || "check";
  button.disabled = true;
  try {
    if (action === "install") {
      const accepted = await window.electronAPI.installUpdate();
      if (!accepted) showToast("更新尚未准备好，请重新检查");
      return;
    }
    const nextState = action === "download"
      ? await window.electronAPI.downloadUpdate()
      : await window.electronAPI.checkForUpdates();
    renderUpdateState(nextState, false);
  } catch (_error) {
    showToast(action === "download" ? "下载更新失败，请稍后重试" : "检查更新失败，请稍后重试");
  } finally {
    if (updateState) renderUpdateState(updateState, false);
  }
}
async function changeDataLocation() {
  const button = $("#changeDataLocationBtn");
  button.disabled = true;
  try {
    const result = await window.electronAPI.chooseDataLocation();
    if (!result || result.cancelled) return;
    renderDataLocation(result);
    await refreshTodoData();
    renderStorageStatus(await window.electronAPI.getStorageStatus());
    if (result.cleanupPending && result.cleanupPending.length) {
      showToast("数据已迁移，旧位置有文件需要手动清理");
    } else if (!result.unchanged) {
      showToast("数据已迁移到新位置");
    }
  } catch (error) {
    showToast("切换失败：" + (error.message || "请检查目标文件夹"));
  } finally {
    button.disabled = false;
  }
}

async function openSupportDirectory(button, opener, failureMessage) {
  button.disabled = true;
  try {
    await opener();
  } catch (error) {
    showToast(failureMessage + "：" + (error.message || "请稍后重试"));
  } finally {
    button.disabled = false;
  }
}

async function exportDataBackup() {
  const button = $("#exportDataBackupBtn");
  button.disabled = true;
  try {
    const result = await window.electronAPI.exportDataBackup();
    if (result && !result.cancelled) showToast("数据备份已导出");
  } catch (error) {
    showToast("导出失败：" + (error.message || "请检查目标位置"));
  } finally {
    button.disabled = false;
  }
}

async function refreshTodoData() {
  if (refreshPending) return;
  refreshPending = true;
  try {
    const result = await window.electronAPI.getTodoList();
    todoList = Array.isArray(result) ? result : [];
    renderHome();
    if (activePage === "calendar") renderCalendar();
    if (detailItem) {
      const updated = todoList.find((item) => item.id === detailItem.id);
      if (updated && !$("#detailModal").classList.contains("hidden")) showDetailModal(updated);
    }
  } finally {
    refreshPending = false;
  }
}

function bindNavigation() {
  $$(".nav-item[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  $$(".settings-tab").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".settings-tab").forEach((entry) => entry.classList.toggle("active", entry === button));
      $$(".settings-section").forEach((section) => {
        section.classList.toggle("hidden", section.id !== button.dataset.setting);
      });
    });
  });
}

function bindHome() {
  $("#newTaskButton").addEventListener("click", () => openTaskModal());
  $("#calendarNewTask").addEventListener("click", () => openTaskModal(null, selectedCalendarDate));
  $("#triggerTestReminderButton").addEventListener("click", triggerDevelopmentReminder);
  $("#searchButton").addEventListener("click", () => {
    const input = $("#searchInput");
    input.classList.toggle("hidden");
    if (!input.classList.contains("hidden")) input.focus();
    else {
      input.value = "";
      searchText = "";
      renderHome();
    }
  });
  $("#searchInput").addEventListener("input", (event) => {
    searchText = event.target.value.trim();
    renderHome();
  });
  $("#taskFilters").addEventListener("click", (event) => {
    const button = event.target.closest(".filter-button");
    if (!button) return;
    activeFilter = button.dataset.filter;
    renderHome();
  });
  $("#sortSelector").addEventListener("change", (event) => {
    sortType = event.target.value;
    renderHome();
  });
}

function bindTaskModal() {
  $("#closeTaskModal").addEventListener("click", closeTaskModal);
  $("#cancelTask").addEventListener("click", closeTaskModal);
  $("#saveTask").addEventListener("click", saveTask);
  $("#copyLastTask").addEventListener("click", copyLastCreatedTask);
  $("#taskTitle").addEventListener("input", clearTitleError);
  $("#taskModal").addEventListener("mousedown", (event) => {
    if (event.target === $("#taskModal")) closeTaskModal();
  });
  $("#taskPriority").addEventListener("click", (event) => {
    const button = event.target.closest(".segment");
    if (!button) return;
    selectedPriority = button.dataset.value;
    setSegmentValue("#taskPriority", selectedPriority);
    updateReminderPreview();
  });
  $("#taskType").addEventListener("click", (event) => {
    const button = event.target.closest(".segment");
    if (!button) return;
    selectedTaskType = button.dataset.value;
    setSegmentValue("#taskType", selectedTaskType);
    updateTaskTypeUi();
  });
  $("#taskReminderMode").addEventListener("click", (event) => {
    const button = event.target.closest(".segment");
    if (!button) return;
    selectedReminderMode = button.dataset.value;
    if (selectedReminderMode === "custom" && !getCustomOffsets().length) setCustomOffsets([1440, 0]);
    setSegmentValue("#taskReminderMode", selectedReminderMode);
    updateReminderPreview();
  });
  $("#taskReminderEnabled").addEventListener("change", updateReminderPreview);
  $("#taskDate").addEventListener("change", updateReminderPreview);
  $("#taskDueTime").addEventListener("change", updateReminderPreview);
  $("#taskCycleType").addEventListener("change", updateReminderPreview);
  $("#reminderOffsets").addEventListener("click", (event) => {
    if (selectedReminderMode !== "custom") return;
    const button = event.target.closest(".reminder-offset");
    if (!button) return;
    const offset = Number(button.dataset.offset);
    const offsets = new Set(getCustomOffsets());
    if (offsets.has(offset)) offsets.delete(offset);
    else offsets.add(offset);
    setCustomOffsets([...offsets]);
    updateReminderPreview();
  });
}

function bindDetailAndDelete() {
  $("#closeDetailModal").addEventListener("click", closeDetailModal);
  $("#closeDetailButton").addEventListener("click", closeDetailModal);
  $("#detailModal").addEventListener("mousedown", (event) => {
    if (event.target === $("#detailModal")) closeDetailModal();
  });
  $("#editFromDetail").addEventListener("click", () => {
    const item = detailItem;
    closeDetailModal();
    if (item) openTaskModal(item);
  });
  $("#deleteFromDetail").addEventListener("click", () => {
    if (detailItem) askDelete(detailItem.id);
  });
  $("#cancelDelete").addEventListener("click", closeDeleteModal);
  $("#confirmDelete").addEventListener("click", confirmDelete);
  $("#deleteModal").addEventListener("mousedown", (event) => {
    if (event.target === $("#deleteModal")) closeDeleteModal();
  });
  $("#closeToTrayButton").addEventListener("click", () => resolveCloseAppModal("tray"));
  $("#quitAppButton").addEventListener("click", () => resolveCloseAppModal("quit"));
  $("#closeAppModal").addEventListener("mousedown", (event) => {
    if (event.target === $("#closeAppModal")) cancelCloseAppModal();
  });
  $("#globalDropMask").addEventListener("click", closeDropMenu);
}

function bindCalendar() {
  $("#prevMonth").addEventListener("click", () => {
    currentDate = recurrence.shiftMonthToStart(currentDate, -1);
    selectedCalendarDate = recurrence.formatLocalDate(currentDate);
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    currentDate = recurrence.shiftMonthToStart(currentDate, 1);
    selectedCalendarDate = recurrence.formatLocalDate(currentDate);
    renderCalendar();
  });
  $("#calendarToday").addEventListener("click", () => {
    const today = new Date();
    currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedCalendarDate = recurrence.formatLocalDate(today);
    renderCalendar();
  });
}

function bindSettings() {
  $("#autoStartCheck").addEventListener("change", (event) => saveConfigPatch({ autoStart: event.target.checked }));
  $("#closeToTrayPromptCheck").addEventListener("change", (event) => {
    saveConfigPatch({ closeToTrayPrompt: event.target.checked });
  });
  $("#autoCheckUpdatesCheck").addEventListener("change", (event) => {
    saveConfigPatch({ autoCheckUpdates: event.target.checked });
  });
  $("#updateActionButton").addEventListener("click", handleUpdateAction);
  if (typeof window.electronAPI.onUpdateStatus === "function") {
    window.electronAPI.onUpdateStatus((state) => renderUpdateState(state, true));
  }
  $("#notificationSoundCheck").addEventListener("change", (event) => {
    saveConfigPatch({ notificationSound: event.target.checked });
  });
  $("#weekStartSel").addEventListener("change", async (event) => {
    await saveConfigPatch({ weekStartMon: event.target.value === "true" });
    renderCalendar();
  });
  $("#weeklySummaryCheck").addEventListener("change", (event) => saveConfigPatch({ weeklySummary: event.target.checked }));
  $("#dailySummaryCheck").addEventListener("change", (event) => saveConfigPatch({ dailySummary: event.target.checked }));
  $("#dailySummaryTime").addEventListener("change", (event) => saveConfigPatch({ dailySummaryTime: event.target.value }));
  $("#quietHoursCheck").addEventListener("change", (event) => saveConfigPatch({ quietHoursEnabled: event.target.checked }));
  $("#quietStart").addEventListener("change", (event) => saveConfigPatch({ quietStart: event.target.value }));
  $("#quietEnd").addEventListener("change", (event) => saveConfigPatch({ quietEnd: event.target.value }));
  $("#changeDataLocationBtn").addEventListener("click", changeDataLocation);
  $("#openDataLocationBtn").addEventListener("click", (event) => {
    openSupportDirectory(event.currentTarget, window.electronAPI.openDataDirectory, "无法打开数据目录");
  });
  $("#exportDataBackupBtn").addEventListener("click", exportDataBackup);
}

async function toggleMainWindowMaximize() {
  const isMaximized = await window.electronAPI.toggleMainWindowMaximize();
  document.body.classList.toggle("window-maximized", !!isMaximized);
  $("#maximizeRestoreButton").classList.toggle("is-maximized", !!isMaximized);
  $("#maximizeRestoreButton").title = isMaximized ? "还原" : "最大化";
  $("#maximizeRestoreButton").setAttribute("aria-label", isMaximized ? "还原" : "最大化");
}
window.toggleMainWindowMaximize = toggleMainWindowMaximize;

function bindWindowEvents() {
  $("#minimizeButton").addEventListener("click", () => window.electronAPI.winMinimize());
  $("#maximizeRestoreButton").addEventListener("click", toggleMainWindowMaximize);
  $("#closeMainWindowButton").addEventListener("click", () => window.electronAPI.winClose());
  $(".title-bar").addEventListener("dblclick", (event) => {
    if (!event.target.closest(".title-ctrl")) toggleMainWindowMaximize();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!$("#closeAppModal").classList.contains("hidden")) cancelCloseAppModal();
      else window.electronAPI.winClose();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openTaskModal();
    }
  });
  window.addEventListener("focus", () => refreshTodoData());
  if (typeof window.electronAPI.onTodoDataChanged === "function") {
    window.electronAPI.onTodoDataChanged(() => refreshTodoData());
  }
  if (typeof window.electronAPI.onCloseConfirmationRequested === "function") {
    window.electronAPI.onCloseConfirmationRequested(showCloseAppModal);
  }
  if (typeof window.electronAPI.onOpenTodoDetail === "function") {
    window.electronAPI.onOpenTodoDetail(async (todoId) => {
      await refreshTodoData();
      const item = todoList.find((entry) => entry.id === Number(todoId));
      if (item) {
        setPage("home");
        showDetailModal(item);
      }
    });
  }
}

async function initApp() {
  bindNavigation();
  bindHome();
  bindTaskModal();
  bindDetailAndDelete();
  bindCalendar();
  bindSettings();
  bindBackToTop();
  bindWindowEvents();
  const [
    appInfo,
    configResult,
    dataLocation,
    initialUpdateState,
    storageStatus,
  ] = await Promise.all([
    window.electronAPI.getAppInfo(),
    window.electronAPI.getFloatConfig(),
    window.electronAPI.getDataLocation(),
    window.electronAPI.getUpdateState(),
    window.electronAPI.getStorageStatus(),
  ]);
  $("#appVersion").textContent = "v" + appInfo.version;
  $("#triggerTestReminderButton").classList.toggle("hidden", !!appInfo.isPackaged);
  appConfig = configResult && configResult.config ? configResult.config : {};
  applyConfigToSettings();
  renderDataLocation(dataLocation);
  renderStorageStatus(storageStatus);
  renderUpdateState(initialUpdateState, false);
  await refreshTodoData();
  setPage("home");
}

window.addEventListener("DOMContentLoaded", () => {
  initApp().catch((error) => {
    showToast("应用初始化失败：" + (error.message || "未知错误"));
  });
});
