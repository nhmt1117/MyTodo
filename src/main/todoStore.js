const { getDataFilePath } = require("./dataLocation");

const { formatLocalDate, normalizeTime, parseLocalDate } = require("../shared/recurrence");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

let todoData = [];
let nextId = 1;

const priorityValues = new Set(["low", "mid", "high"]);
const cycleTypeValues = new Set(["", "daily", "weekly", "monthly"]);
const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;

function getTodoFilePath() {
  return getDataFilePath("todo-store.json");
}

function toText(value) {
  return String(value ?? "");
}

function limitText(value, maxLength) {
  return Array.from(toText(value)).slice(0, maxLength).join("");
}

function normalizePriority(value) {
  return priorityValues.has(value) ? value : "mid";
}

function normalizeCycleType(value) {
  return cycleTypeValues.has(value) ? value : "";
}

function normalizeDate(value) {
  const text = toText(value);
  return parseLocalDate(text) ? text : "";
}

function normalizeTimestamp(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeOptionalTimestamp(value) {
  if (!toText(value)) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeTodoItem(item = {}, now = new Date()) {
  const source = item && typeof item === "object" ? item : {};
  const isCycle = !!source.isCycle;
  const fallbackTimestamp = now.toISOString();
  const createdAt = normalizeTimestamp(source.createdAt, fallbackTimestamp);
  const createdDate = formatLocalDate(new Date(createdAt));
  const sourceDate = normalizeDate(source.date);

  return {
    id: Number(source.id),
    text: toText(source.text).trim(),
    desc: toText(source.desc),
    date: sourceDate || (isCycle ? createdDate : ""),
    priority: normalizePriority(source.priority),
    remind: !!source.remind,
    remindTime: normalizeTime(source.remindTime),
    muteRemind: !!source.muteRemind,
    isCycle,
    cycleType: isCycle ? normalizeCycleType(source.cycleType) : "",
    archived: !!source.archived,
    createdAt,
    updatedAt: normalizeTimestamp(source.updatedAt, createdAt),
    lastReminderKey: toText(source.lastReminderKey),
    snoozedReminderKey: toText(source.snoozedReminderKey),
    snoozedUntil: normalizeOptionalTimestamp(source.snoozedUntil),
  };
}

function cloneTodo(item) {
  return { ...item };
}

function getNextIdFromList(list) {
  const maxExistingId = list.reduce((maxId, item) => {
    const id = Number(item.id);
    return Number.isFinite(id) ? Math.max(maxId, id) : maxId;
  }, 0);
  return maxExistingId + 1;
}

function loadTodoFile() {
  const result = readJsonWithBackup(getTodoFilePath(), { list: [], maxId: 1 });
  const obj = result.value && typeof result.value === "object" ? result.value : {};
  const list = Array.isArray(obj.list) ? obj.list : [];

  todoData = list
    .map((item) => normalizeTodoItem(item))
    .filter((item) => Number.isFinite(item.id) && item.text);
  nextId = Number.isFinite(Number(obj.maxId)) ? Number(obj.maxId) : getNextIdFromList(todoData);
  nextId = Math.max(nextId, getNextIdFromList(todoData));

  if (result.source === "backup") {
    console.warn("任务文件损坏，已从备份恢复", result.primaryError);
    saveTodoFile();
  } else if (result.primaryError) {
    console.error("任务文件及备份均无法读取，已使用空列表", result.primaryError);
  } else if (result.source === "primary") {
    saveTodoFile();
  }

  return getTodoList();
}

function saveTodoFile() {
  writeJsonAtomic(getTodoFilePath(), {
    list: todoData,
    maxId: nextId,
  });
}

function getTodoList() {
  return todoData.map(cloneTodo);
}

function addTodoItem(payload = {}) {
  const text = limitText(payload.text, TITLE_MAX_LENGTH).trim();
  if (!text) return null;

  const now = new Date();
  const newItem = normalizeTodoItem(
    {
      ...payload,
      text,
      desc: limitText(payload.desc, DESCRIPTION_MAX_LENGTH),
      id: nextId,
      muteRemind: false,
      archived: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastReminderKey: "",
      snoozedReminderKey: "",
      snoozedUntil: "",
    },
    now,
  );

  if (newItem.isCycle && !newItem.cycleType) return null;

  nextId += 1;
  todoData.push(newItem);
  saveTodoFile();
  return cloneTodo(newItem);
}

function buildTodoPatch(payload = {}) {
  const patch = {};

  if ("text" in payload) patch.text = limitText(payload.text, TITLE_MAX_LENGTH).trim();
  if ("desc" in payload) patch.desc = limitText(payload.desc, DESCRIPTION_MAX_LENGTH);
  if ("date" in payload) patch.date = normalizeDate(payload.date);
  if ("priority" in payload) patch.priority = normalizePriority(payload.priority);
  if ("remind" in payload) patch.remind = !!payload.remind;
  if ("remindTime" in payload) patch.remindTime = normalizeTime(payload.remindTime);
  if ("muteRemind" in payload) patch.muteRemind = !!payload.muteRemind;
  if ("isCycle" in payload) patch.isCycle = !!payload.isCycle;
  if ("cycleType" in payload) patch.cycleType = normalizeCycleType(payload.cycleType);
  if ("archived" in payload) patch.archived = !!payload.archived;

  return patch;
}

function updateTodo(payload = {}) {
  const id = Number(payload.id);
  const idx = todoData.findIndex((item) => item.id === id);
  if (idx === -1) return undefined;

  const patch = buildTodoPatch(payload);
  if ("text" in patch && !patch.text) return cloneTodo(todoData[idx]);

  const reminderChanged = ["date", "remind", "remindTime", "cycleType"].some(
    (field) => field in patch && patch[field] !== todoData[idx][field],
  );
  todoData[idx] = {
    ...todoData[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
    lastReminderKey: reminderChanged ? "" : todoData[idx].lastReminderKey,
    snoozedReminderKey: reminderChanged ? "" : todoData[idx].snoozedReminderKey,
    snoozedUntil: reminderChanged ? "" : todoData[idx].snoozedUntil,
  };
  saveTodoFile();
  return cloneTodo(todoData[idx]);
}

function setArchived(id, archived) {
  const target = todoData.find((item) => item.id === Number(id));
  if (target) {
    target.archived = !!archived;
    if (target.archived) {
      target.snoozedReminderKey = "";
      target.snoozedUntil = "";
    }
    target.updatedAt = new Date().toISOString();
    saveTodoFile();
  }
  return target ? cloneTodo(target) : undefined;
}

function muteTodoRemind(id) {
  const target = todoData.find((item) => item.id === Number(id));
  if (target) {
    target.muteRemind = true;
    target.snoozedReminderKey = "";
    target.snoozedUntil = "";
    target.updatedAt = new Date().toISOString();
    saveTodoFile();
  }
  return target ? cloneTodo(target) : undefined;
}

function addToToday(id) {
  const target = todoData.find((item) => item.id === Number(id));
  if (target) {
    target.muteRemind = false;
    target.updatedAt = new Date().toISOString();
    saveTodoFile();
  }
  return target ? cloneTodo(target) : undefined;
}

function snoozeTodoReminder(id, key, minutes = 5, now = new Date()) {
  const target = todoData.find((item) => item.id === Number(id));
  const reminderKey = toText(key);
  const delayMinutes = Number(minutes);
  const baseTime = new Date(now);
  if (
    !target ||
    !reminderKey ||
    !Number.isFinite(delayMinutes) ||
    delayMinutes <= 0 ||
    Number.isNaN(baseTime.getTime())
  ) {
    return undefined;
  }

  target.lastReminderKey = reminderKey;
  target.snoozedReminderKey = reminderKey;
  target.snoozedUntil = new Date(baseTime.getTime() + delayMinutes * 60 * 1000).toISOString();
  target.updatedAt = baseTime.toISOString();
  saveTodoFile();
  return cloneTodo(target);
}

function deleteTodo(id) {
  const previousLength = todoData.length;
  todoData = todoData.filter((item) => item.id !== Number(id));
  if (todoData.length !== previousLength) saveTodoFile();
  return todoData.length !== previousLength;
}

function markRemindersSent(entries = []) {
  let changed = false;
  for (const entry of entries) {
    const target = todoData.find((item) => item.id === Number(entry.id));
    const reminderKey = toText(entry.key);
    if (!target || !reminderKey) continue;

    let targetChanged = false;
    if (target.lastReminderKey !== reminderKey) {
      target.lastReminderKey = reminderKey;
      targetChanged = true;
    }
    if (target.snoozedReminderKey || target.snoozedUntil) {
      target.snoozedReminderKey = "";
      target.snoozedUntil = "";
      targetChanged = true;
    }
    if (targetChanged) {
      target.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveTodoFile();
  return changed;
}

module.exports = {
  addToToday,
  addTodoItem,
  deleteTodo,
  getTodoList,
  loadTodoFile,
  markRemindersSent,
  muteTodoRemind,
  saveTodoFile,
  setArchived,
  snoozeTodoReminder,
  updateTodo,
};
