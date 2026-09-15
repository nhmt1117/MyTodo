const { getDataFilePath } = require("./dataLocation");
const {
  formatLocalDate,
  normalizeReminderMode,
  normalizeReminderOffsets,
  normalizeTime,
  parseLocalDate,
} = require("../shared/recurrence");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

let todoData = [];
let nextId = 1;
let todoStorageStatus = { state: "pending", message: "任务数据尚未加载", readOnly: false };

const priorityValues = new Set(["low", "mid", "high"]);
const cycleTypeValues = new Set(["", "daily", "weekly", "monthly"]);
const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;
const REMINDER_HISTORY_LIMIT = 200;

function getTodoFilePath() {
  return getDataFilePath("todo-store.json");
}

function isTodoStoreRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Array.isArray(value.list);
}

function assertTodoStorageWritable() {
  if (!todoStorageStatus.readOnly) return;
  throw new Error("任务数据文件无法读取，当前处于只读保护状态。请先打开数据目录备份或修复文件，然后重启 MyTodo");
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

function normalizeSentReminderKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(toText).filter(Boolean))].slice(-REMINDER_HISTORY_LIMIT);
}

function normalizeTodoItem(item = {}, now = new Date()) {
  const source = item && typeof item === "object" ? item : {};
  const isCycle = !!source.isCycle;
  const fallbackTimestamp = now.toISOString();
  const createdAt = normalizeTimestamp(source.createdAt, fallbackTimestamp);
  const createdDate = formatLocalDate(new Date(createdAt));
  const sourceDate = normalizeDate(source.date);
  const dueTime = normalizeTime(source.dueTime || source.remindTime);

  return {
    id: Number(source.id),
    text: limitText(source.text, TITLE_MAX_LENGTH).trim(),
    desc: limitText(source.desc, DESCRIPTION_MAX_LENGTH),
    date: sourceDate || (isCycle ? createdDate : ""),
    dueTime,
    remindTime: dueTime,
    priority: normalizePriority(source.priority),
    remind: !!source.remind,
    reminderMode: normalizeReminderMode(source.reminderMode),
    customReminderOffsets: normalizeReminderOffsets(source.customReminderOffsets),
    muteRemind: !!source.muteRemind,
    isCycle,
    cycleType: isCycle ? normalizeCycleType(source.cycleType) : "",
    archived: !!source.archived,
    createdAt,
    updatedAt: normalizeTimestamp(source.updatedAt, createdAt),
    lastReminderKey: toText(source.lastReminderKey),
    sentReminderKeys: normalizeSentReminderKeys(source.sentReminderKeys),
    snoozedReminderKey: toText(source.snoozedReminderKey),
    snoozedUntil: normalizeOptionalTimestamp(source.snoozedUntil),
  };
}

function cloneTodo(item) {
  return {
    ...item,
    customReminderOffsets: [...item.customReminderOffsets],
    sentReminderKeys: [...item.sentReminderKeys],
  };
}

function getNextIdFromList(list) {
  const maxExistingId = list.reduce((maxId, item) => {
    const id = Number(item.id);
    return Number.isFinite(id) ? Math.max(maxId, id) : maxId;
  }, 0);
  return maxExistingId + 1;
}

function loadTodoFile() {
  const result = readJsonWithBackup(
    getTodoFilePath(),
    { list: [], maxId: 1 },
    isTodoStoreRecord,
  );
  const obj = result.value && typeof result.value === "object" ? result.value : {};
  const list = Array.isArray(obj.list) ? obj.list : [];

  todoData = list
    .map((item) => normalizeTodoItem(item))
    .filter((item) => Number.isFinite(item.id) && item.text);
  nextId = Number.isFinite(Number(obj.maxId)) ? Number(obj.maxId) : getNextIdFromList(todoData);
  nextId = Math.max(nextId, getNextIdFromList(todoData));

  if (result.source === "backup") {
    todoStorageStatus = {
      state: "recovered",
      message: "任务数据已从自动备份恢复",
      readOnly: false,
    };
    console.warn("任务文件损坏，已从备份恢复", result.primaryError);
    saveTodoFile();
  } else if (result.primaryError) {
    todoStorageStatus = {
      state: "error",
      message: "任务文件及自动备份均无法读取，已进入只读保护",
      readOnly: true,
    };
    console.error("任务文件及备份均无法读取，已进入只读保护", result.primaryError);
  } else if (result.source === "primary") {
    todoStorageStatus = { state: "ok", message: "任务数据正常", readOnly: false };
    saveTodoFile();
  } else {
    todoStorageStatus = { state: "ok", message: "任务数据正常", readOnly: false };
  }

  return getTodoList();
}

function saveTodoFile() {
  assertTodoStorageWritable();
  writeJsonAtomic(getTodoFilePath(), {
    schemaVersion: 2,
    list: todoData,
    maxId: nextId,
  }, isTodoStoreRecord);
}

function getTodoList() {
  return todoData.map(cloneTodo);
}

function getTodoStorageStatus() {
  return { ...todoStorageStatus };
}

function addTodoItem(payload = {}) {
  assertTodoStorageWritable();
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
      sentReminderKeys: [],
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
  if ("dueTime" in payload || "remindTime" in payload) {
    patch.dueTime = normalizeTime(payload.dueTime || payload.remindTime);
    patch.remindTime = patch.dueTime;
  }
  if ("priority" in payload) patch.priority = normalizePriority(payload.priority);
  if ("remind" in payload) patch.remind = !!payload.remind;
  if ("reminderMode" in payload) patch.reminderMode = normalizeReminderMode(payload.reminderMode);
  if ("customReminderOffsets" in payload) {
    patch.customReminderOffsets = normalizeReminderOffsets(payload.customReminderOffsets);
  }
  if ("muteRemind" in payload) patch.muteRemind = !!payload.muteRemind;
  if ("isCycle" in payload) patch.isCycle = !!payload.isCycle;
  if ("cycleType" in payload) patch.cycleType = normalizeCycleType(payload.cycleType);
  if ("archived" in payload) patch.archived = !!payload.archived;

  return patch;
}

function hasPatchChanged(item, patch, field) {
  if (!(field in patch)) return false;
  if (Array.isArray(patch[field])) {
    return JSON.stringify(patch[field]) !== JSON.stringify(item[field]);
  }
  return patch[field] !== item[field];
}

function updateTodo(payload = {}) {
  assertTodoStorageWritable();
  const id = Number(payload.id);
  const idx = todoData.findIndex((item) => item.id === id);
  if (idx === -1) return undefined;

  const patch = buildTodoPatch(payload);
  if ("text" in patch && !patch.text) return cloneTodo(todoData[idx]);

  const reminderChanged = [
    "date",
    "dueTime",
    "remind",
    "reminderMode",
    "customReminderOffsets",
    "cycleType",
    "isCycle",
  ].some((field) => hasPatchChanged(todoData[idx], patch, field));
  todoData[idx] = {
    ...todoData[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
    lastReminderKey: reminderChanged ? "" : todoData[idx].lastReminderKey,
    sentReminderKeys: reminderChanged ? [] : todoData[idx].sentReminderKeys,
    snoozedReminderKey: reminderChanged ? "" : todoData[idx].snoozedReminderKey,
    snoozedUntil: reminderChanged ? "" : todoData[idx].snoozedUntil,
  };
  saveTodoFile();
  return cloneTodo(todoData[idx]);
}

function setArchived(id, archived) {
  const target = todoData.find((item) => item.id === Number(id));
  if (target) {
    assertTodoStorageWritable();
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
    assertTodoStorageWritable();
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
    assertTodoStorageWritable();
    target.muteRemind = false;
    target.updatedAt = new Date().toISOString();
    saveTodoFile();
  }
  return target ? cloneTodo(target) : undefined;
}

function snoozeTodoReminder(id, key, minutes = 15, now = new Date()) {
  const target = todoData.find((item) => item.id === Number(id));
  const reminderKey = toText(key);
  const delayMinutes = Number(minutes);
  const baseTime = new Date(now);
  if (
    !target ||
    !reminderKey ||
    !Number.isFinite(delayMinutes) ||
    delayMinutes <= 0 ||
    delayMinutes > 48 * 60 ||
    Number.isNaN(baseTime.getTime())
  ) {
    return undefined;
  }

  assertTodoStorageWritable();

  if (!target.sentReminderKeys.includes(reminderKey)) {
    target.sentReminderKeys = [...target.sentReminderKeys, reminderKey].slice(-REMINDER_HISTORY_LIMIT);
  }
  target.lastReminderKey = reminderKey;
  target.snoozedReminderKey = reminderKey;
  target.snoozedUntil = new Date(baseTime.getTime() + delayMinutes * 60 * 1000).toISOString();
  target.updatedAt = baseTime.toISOString();
  saveTodoFile();
  return cloneTodo(target);
}

function deleteTodo(id) {
  assertTodoStorageWritable();
  const previousLength = todoData.length;
  todoData = todoData.filter((item) => item.id !== Number(id));
  if (todoData.length !== previousLength) saveTodoFile();
  return todoData.length !== previousLength;
}

function markRemindersSent(entries = []) {
  if (entries.length) assertTodoStorageWritable();
  let changed = false;
  for (const entry of entries) {
    const target = todoData.find((item) => item.id === Number(entry.id));
    const reminderKey = toText(entry.key);
    if (!target || !reminderKey) continue;

    let targetChanged = false;
    if (!target.sentReminderKeys.includes(reminderKey)) {
      target.sentReminderKeys = [...target.sentReminderKeys, reminderKey].slice(-REMINDER_HISTORY_LIMIT);
      targetChanged = true;
    }
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
  getTodoStorageStatus,
  loadTodoFile,
  markRemindersSent,
  muteTodoRemind,
  saveTodoFile,
  setArchived,
  snoozeTodoReminder,
  updateTodo,
};
