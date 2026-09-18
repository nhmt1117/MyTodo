const { randomUUID } = require("node:crypto");
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
let todoMutationListener = null;

const priorityValues = new Set(["low", "mid", "high"]);
const cycleTypeValues = new Set(["", "daily", "weekly", "monthly"]);
const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;
const REMINDER_HISTORY_LIMIT = 200;
const syncStateValues = new Set(["local", "pending", "synced", "conflict"]);

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

function normalizeUuid(value) {
  const uuid = toText(value).trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    .test(uuid)
    ? uuid
    : randomUUID();
}

function normalizeCloudRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
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
  const cloudRevision = normalizeCloudRevision(source.cloudRevision);

  return {
    id: Number(source.id),
    uuid: normalizeUuid(source.uuid),
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
    deletedAt: normalizeOptionalTimestamp(source.deletedAt),
    cloudRevision,
    syncState: syncStateValues.has(source.syncState)
      ? source.syncState
      : cloudRevision > 0 ? "synced" : "local",
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

function emitTodoMutation(operation, item) {
  if (typeof todoMutationListener !== "function" || !item) return;
  try {
    todoMutationListener(operation, cloneTodo(item));
  } catch (error) {
    console.error("记录待办同步变更失败，本地修改已保留", error);
  }
}

function setTodoMutationListener(listener) {
  todoMutationListener = typeof listener === "function" ? listener : null;
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
    schemaVersion: 3,
    list: todoData,
    maxId: nextId,
  }, isTodoStoreRecord);
}

function getTodoList() {
  return todoData.filter((item) => !item.deletedAt).map(cloneTodo);
}

function getTodoSyncSnapshot() {
  return todoData.map(cloneTodo);
}

function getTodoStorageStatus() {
  return { ...todoStorageStatus };
}

function restoreTodoList(items = [], now = new Date()) {
  if (!Array.isArray(items)) throw new Error("备份中的任务列表无效");
  const restoredAt = new Date(now);
  if (Number.isNaN(restoredAt.getTime())) throw new Error("恢复时间无效");

  const previousData = todoData.map(cloneTodo);
  const previousNextId = nextId;
  const previousStatus = { ...todoStorageStatus };
  const existingByUuid = new Map(previousData.map((item) => [item.uuid, item]));
  const usedUuids = new Set();
  const usedIds = new Set();
  const restored = [];
  const restoredTimestamp = restoredAt.toISOString();

  for (const source of items) {
    const item = normalizeTodoItem(source, restoredAt);
    if (!item.text) throw new Error("备份中包含无效任务");
    while (usedUuids.has(item.uuid)) item.uuid = randomUUID();
    usedUuids.add(item.uuid);

    let id = Number(item.id);
    if (!Number.isInteger(id) || id < 1 || usedIds.has(id)) {
      id = 1;
      while (usedIds.has(id)) id += 1;
    }
    item.id = id;
    usedIds.add(id);

    const current = existingByUuid.get(item.uuid);
    item.cloudRevision = Math.max(item.cloudRevision, current?.cloudRevision || 0);
    item.syncState = item.cloudRevision > 0 ? "pending" : "local";
    item.deletedAt = "";
    item.updatedAt = restoredTimestamp;
    restored.push(item);
  }

  const deletedForSync = previousData
    .filter((item) => !item.deletedAt && item.cloudRevision > 0 && !usedUuids.has(item.uuid))
    .map((item) => ({
      ...item,
      deletedAt: restoredTimestamp,
      updatedAt: restoredTimestamp,
      syncState: "pending",
    }));
  const existingTombstones = previousData.filter((item) => item.deletedAt && !usedUuids.has(item.uuid));

  todoData = [...restored, ...deletedForSync, ...existingTombstones];
  nextId = getNextIdFromList(todoData);
  todoStorageStatus = { state: "ok", message: "任务数据正常", readOnly: false };
  try {
    saveTodoFile();
  } catch (error) {
    todoData = previousData;
    nextId = previousNextId;
    todoStorageStatus = previousStatus;
    throw error;
  }

  restored.forEach((item) => emitTodoMutation("upsert", item));
  deletedForSync.forEach((item) => emitTodoMutation("delete", item));
  return getTodoList();
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
      uuid: randomUUID(),
      muteRemind: false,
      archived: false,
      deletedAt: "",
      cloudRevision: 0,
      syncState: "local",
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
  emitTodoMutation("upsert", newItem);
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
  if (idx === -1 || todoData[idx].deletedAt) return undefined;

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
    syncState: todoData[idx].cloudRevision > 0 ? "pending" : "local",
    lastReminderKey: reminderChanged ? "" : todoData[idx].lastReminderKey,
    sentReminderKeys: reminderChanged ? [] : todoData[idx].sentReminderKeys,
    snoozedReminderKey: reminderChanged ? "" : todoData[idx].snoozedReminderKey,
    snoozedUntil: reminderChanged ? "" : todoData[idx].snoozedUntil,
  };
  saveTodoFile();
  emitTodoMutation("upsert", todoData[idx]);
  return cloneTodo(todoData[idx]);
}

function setArchived(id, archived) {
  const target = todoData.find((item) => item.id === Number(id) && !item.deletedAt);
  if (target) {
    assertTodoStorageWritable();
    target.archived = !!archived;
    if (target.archived) {
      target.snoozedReminderKey = "";
      target.snoozedUntil = "";
    }
    target.updatedAt = new Date().toISOString();
    target.syncState = target.cloudRevision > 0 ? "pending" : "local";
    saveTodoFile();
    emitTodoMutation("upsert", target);
  }
  return target ? cloneTodo(target) : undefined;
}

function muteTodoRemind(id) {
  const target = todoData.find((item) => item.id === Number(id) && !item.deletedAt);
  if (target) {
    assertTodoStorageWritable();
    target.muteRemind = true;
    target.snoozedReminderKey = "";
    target.snoozedUntil = "";
    target.updatedAt = new Date().toISOString();
    target.syncState = target.cloudRevision > 0 ? "pending" : "local";
    saveTodoFile();
    emitTodoMutation("upsert", target);
  }
  return target ? cloneTodo(target) : undefined;
}

function addToToday(id) {
  const target = todoData.find((item) => item.id === Number(id) && !item.deletedAt);
  if (target) {
    assertTodoStorageWritable();
    target.muteRemind = false;
    target.updatedAt = new Date().toISOString();
    target.syncState = target.cloudRevision > 0 ? "pending" : "local";
    saveTodoFile();
    emitTodoMutation("upsert", target);
  }
  return target ? cloneTodo(target) : undefined;
}

function snoozeTodoReminder(id, key, minutes = 15, now = new Date()) {
  const target = todoData.find((item) => item.id === Number(id) && !item.deletedAt);
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
  target.syncState = target.cloudRevision > 0 ? "pending" : "local";
  saveTodoFile();
  emitTodoMutation("upsert", target);
  return cloneTodo(target);
}

function deleteTodo(id) {
  assertTodoStorageWritable();
  const index = todoData.findIndex((item) => item.id === Number(id) && !item.deletedAt);
  if (index === -1) return false;
  const deletedItem = todoData[index];
  if (todoData[index].cloudRevision > 0) {
    todoData[index].deletedAt = new Date().toISOString();
    todoData[index].updatedAt = todoData[index].deletedAt;
    todoData[index].syncState = "pending";
  } else {
    todoData.splice(index, 1);
  }
  saveTodoFile();
  emitTodoMutation("delete", deletedItem);
  return true;
}

function cloudDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "09:00" };
  return {
    date: formatLocalDate(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function cloudCycleType(payload) {
  if (!payload?.isRecurring) return "";
  const rule = payload.recurrenceRule && typeof payload.recurrenceRule === "object"
    ? payload.recurrenceRule
    : {};
  return normalizeCycleType(rule.type || rule.frequency || rule.cycleType) || "daily";
}

function applyCloudTodo(entityId, payload = {}, revision = 0, operation = "upsert") {
  assertTodoStorageWritable();
  const uuid = normalizeUuid(entityId);
  const index = todoData.findIndex((item) => item.uuid === uuid);
  const cloudRevision = normalizeCloudRevision(revision || payload.revision);
  const isDeleted = operation === "delete" || !!payload.deletedAt;

  if (isDeleted) {
    if (index === -1) return null;
    todoData[index].deletedAt = normalizeOptionalTimestamp(payload.deletedAt) || new Date().toISOString();
    todoData[index].cloudRevision = cloudRevision;
    todoData[index].syncState = "synced";
    saveTodoFile();
    return cloneTodo(todoData[index]);
  }

  const due = cloudDateParts(payload.dueAt);
  const existing = index >= 0 ? todoData[index] : null;
  const isCycle = !!payload.isRecurring;
  const nextItem = normalizeTodoItem({
    ...(existing || {}),
    id: existing ? existing.id : nextId,
    uuid,
    text: payload.title,
    desc: payload.description,
    date: due.date,
    dueTime: due.time,
    priority: payload.priority,
    remind: !!payload.reminderEnabled,
    reminderMode: payload.reminderMode,
    customReminderOffsets: payload.customReminderOffsets,
    muteRemind: !!payload.muteRemind,
    isCycle,
    cycleType: cloudCycleType(payload),
    archived: !!(payload.completedAt || payload.archivedAt),
    deletedAt: "",
    cloudRevision,
    syncState: "synced",
    createdAt: payload.createdAt || existing?.createdAt,
    updatedAt: payload.updatedAt || existing?.updatedAt,
    snoozedUntil: payload.snoozedUntil || "",
  });

  if (index >= 0) todoData[index] = nextItem;
  else {
    todoData.push(nextItem);
    nextId += 1;
  }
  saveTodoFile();
  return cloneTodo(nextItem);
}

function setTodoCloudState(entityId, revision, syncState = "synced") {
  const target = todoData.find((item) => item.uuid === String(entityId || "").toLowerCase());
  if (!target) return null;
  assertTodoStorageWritable();
  target.cloudRevision = normalizeCloudRevision(revision);
  target.syncState = syncStateValues.has(syncState) ? syncState : "synced";
  saveTodoFile();
  return cloneTodo(target);
}

function prepareTodoConflictResolution(entityId, revision, patch = {}, options = {}) {
  const target = todoData.find((item) => item.uuid === String(entityId || "").toLowerCase());
  if (!target) return null;
  assertTodoStorageWritable();

  if (Object.prototype.hasOwnProperty.call(patch, "text")) {
    const text = limitText(patch.text, TITLE_MAX_LENGTH).trim();
    if (text) target.text = text;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "desc")) {
    target.desc = limitText(patch.desc, DESCRIPTION_MAX_LENGTH);
  }

  if (options.recreate === true) {
    target.uuid = randomUUID();
    target.deletedAt = "";
    target.cloudRevision = 0;
    target.syncState = "local";
  } else {
    target.cloudRevision = normalizeCloudRevision(revision);
    target.syncState = "pending";
  }
  target.updatedAt = new Date().toISOString();
  saveTodoFile();
  return cloneTodo(target);
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
  applyCloudTodo,
  deleteTodo,
  getTodoList,
  getTodoSyncSnapshot,
  getTodoStorageStatus,
  loadTodoFile,
  markRemindersSent,
  muteTodoRemind,
  prepareTodoConflictResolution,
  restoreTodoList,
  saveTodoFile,
  setArchived,
  setTodoCloudState,
  setTodoMutationListener,
  snoozeTodoReminder,
  updateTodo,
};
