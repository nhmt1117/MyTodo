const { randomUUID } = require("node:crypto");
const { getDataFilePath } = require("./dataLocation");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");

const OUTBOX_SCHEMA_VERSION = 1;
const operationValues = new Set(["upsert", "delete"]);

let outbox = [];
let loaded = false;
let outboxStatus = { state: "pending", message: "同步发件箱尚未加载", readOnly: false };

function getOutboxFilePath() {
  return getDataFilePath("sync-outbox.json");
}

function isOutboxRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Array.isArray(value.items);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeMutation(item) {
  if (!item || typeof item !== "object" || !isUuid(item.entityId)) return null;
  const operation = operationValues.has(item.operation) ? item.operation : "upsert";
  const mutationId = isUuid(item.mutationId) ? String(item.mutationId).toLowerCase() : randomUUID();
  const baseRevision = Number(item.baseRevision);
  const attemptCount = Number(item.attemptCount);
  const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
    ? item.payload
    : {};
  return {
    mutationId,
    entityType: "todo",
    entityId: String(item.entityId).toLowerCase(),
    operation,
    baseRevision: Number.isInteger(baseRevision) && baseRevision >= 0 ? baseRevision : 0,
    ...(operation === "upsert" ? { payload } : {}),
    createdAt: normalizeTimestamp(item.createdAt),
    attemptCount: Number.isInteger(attemptCount) && attemptCount >= 0 ? attemptCount : 0,
    lastAttemptAt: item.lastAttemptAt ? normalizeTimestamp(item.lastAttemptAt, "") : "",
    lastError: String(item.lastError || ""),
    blockedReason: String(item.blockedReason || ""),
    serverEntity: item.serverEntity && typeof item.serverEntity === "object"
      ? item.serverEntity
      : null,
  };
}

function cloneMutation(item) {
  return {
    ...item,
    ...(item.payload ? { payload: JSON.parse(JSON.stringify(item.payload)) } : {}),
    ...(item.serverEntity
      ? { serverEntity: JSON.parse(JSON.stringify(item.serverEntity)) }
      : {}),
  };
}

function assertWritable() {
  if (!outboxStatus.readOnly) return;
  throw new Error("同步发件箱无法读取，当前处于只读保护状态");
}

function ensureLoaded() {
  if (!loaded) loadSyncOutbox();
}

function saveSyncOutbox() {
  ensureLoaded();
  assertWritable();
  writeJsonAtomic(getOutboxFilePath(), {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    items: outbox,
  }, isOutboxRecord);
}

function loadSyncOutbox() {
  const result = readJsonWithBackup(
    getOutboxFilePath(),
    { schemaVersion: OUTBOX_SCHEMA_VERSION, items: [] },
    isOutboxRecord,
  );
  outbox = result.value.items.map(normalizeMutation).filter(Boolean);
  loaded = true;

  if (result.source === "backup") {
    outboxStatus = {
      state: "recovered",
      message: "同步发件箱已从自动备份恢复",
      readOnly: false,
    };
    saveSyncOutbox();
  } else if (result.primaryError) {
    outboxStatus = {
      state: "error",
      message: "同步发件箱及自动备份均无法读取",
      readOnly: true,
    };
  } else {
    outboxStatus = { state: "ok", message: "同步发件箱正常", readOnly: false };
    if (result.source === "primary") saveSyncOutbox();
  }
  return getPendingMutations();
}

function enqueueTodoUpsert(todo) {
  ensureLoaded();
  assertWritable();
  if (!todo || !isUuid(todo.uuid)) throw new Error("待办缺少有效 UUID");

  const entityId = String(todo.uuid).toLowerCase();
  const existingIndex = outbox.findIndex(
    (item) => item.entityId === entityId && item.attemptCount === 0 && !item.blockedReason,
  );
  const mutation = normalizeMutation({
    mutationId: existingIndex >= 0 ? outbox[existingIndex].mutationId : randomUUID(),
    entityId,
    operation: "upsert",
    baseRevision: todo.cloudRevision,
    payload: todo.payload,
    createdAt: existingIndex >= 0 ? outbox[existingIndex].createdAt : new Date().toISOString(),
  });
  if (existingIndex >= 0) outbox[existingIndex] = mutation;
  else outbox.push(mutation);
  saveSyncOutbox();
  return cloneMutation(mutation);
}

function enqueueTodoDelete(todo) {
  ensureLoaded();
  assertWritable();
  if (!todo || !isUuid(todo.uuid)) throw new Error("待办缺少有效 UUID");
  const entityId = String(todo.uuid).toLowerCase();
  const baseRevision = Number(todo.cloudRevision);

  if (!Number.isInteger(baseRevision) || baseRevision <= 0) {
    const previousLength = outbox.length;
    outbox = outbox.filter((item) => item.entityId !== entityId);
    if (outbox.length !== previousLength) saveSyncOutbox();
    return null;
  }

  const existingIndex = outbox.findIndex(
    (item) => item.entityId === entityId && item.attemptCount === 0 && !item.blockedReason,
  );
  const mutation = normalizeMutation({
    mutationId: existingIndex >= 0 ? outbox[existingIndex].mutationId : randomUUID(),
    entityId,
    operation: "delete",
    baseRevision,
    createdAt: existingIndex >= 0 ? outbox[existingIndex].createdAt : new Date().toISOString(),
  });
  if (existingIndex >= 0) outbox[existingIndex] = mutation;
  else outbox.push(mutation);
  saveSyncOutbox();
  return cloneMutation(mutation);
}

function markMutationAttempt(mutationId, errorMessage = "") {
  ensureLoaded();
  const target = outbox.find((item) => item.mutationId === String(mutationId));
  if (!target) return false;
  assertWritable();
  target.attemptCount += 1;
  target.lastAttemptAt = new Date().toISOString();
  target.lastError = String(errorMessage || "");
  saveSyncOutbox();
  return true;
}

function setMutationError(mutationId, errorMessage = "") {
  ensureLoaded();
  const target = outbox.find((item) => item.mutationId === String(mutationId));
  if (!target) return false;
  assertWritable();
  target.lastError = String(errorMessage || "");
  saveSyncOutbox();
  return true;
}

function markMutationBlocked(mutationId, reason, serverEntity = null) {
  ensureLoaded();
  const target = outbox.find((item) => item.mutationId === String(mutationId));
  if (!target) return false;
  assertWritable();
  target.blockedReason = String(reason || "SYNC_REJECTED");
  target.serverEntity = serverEntity && typeof serverEntity === "object" ? serverEntity : null;
  target.lastError = target.blockedReason;
  saveSyncOutbox();
  return true;
}

function rebaseEntityMutations(entityId, revision) {
  ensureLoaded();
  const normalizedRevision = Number(revision);
  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) return false;
  let changed = false;
  for (const item of outbox) {
    if (item.entityId !== String(entityId).toLowerCase() || item.blockedReason) continue;
    if (item.baseRevision !== normalizedRevision) {
      item.baseRevision = normalizedRevision;
      changed = true;
    }
  }
  if (changed) {
    assertWritable();
    saveSyncOutbox();
  }
  return changed;
}

function hasPendingForEntity(entityId) {
  ensureLoaded();
  const normalizedId = String(entityId || "").toLowerCase();
  return outbox.some((item) => item.entityId === normalizedId && !item.blockedReason);
}

function removeMutation(mutationId) {
  ensureLoaded();
  assertWritable();
  const previousLength = outbox.length;
  outbox = outbox.filter((item) => item.mutationId !== String(mutationId));
  if (outbox.length !== previousLength) saveSyncOutbox();
  return outbox.length !== previousLength;
}

function removeEntityMutations(entityId) {
  ensureLoaded();
  assertWritable();
  const normalizedId = String(entityId || "").toLowerCase();
  const previousLength = outbox.length;
  outbox = outbox.filter((item) => item.entityId !== normalizedId);
  if (outbox.length !== previousLength) saveSyncOutbox();
  return previousLength - outbox.length;
}

function getPendingMutations(limit = 100) {
  ensureLoaded();
  const maximum = Math.max(1, Math.min(100, Math.round(Number(limit) || 100)));
  return outbox.filter((item) => !item.blockedReason).slice(0, maximum).map(cloneMutation);
}

function getBlockedMutations() {
  ensureLoaded();
  return outbox.filter((item) => item.blockedReason).map(cloneMutation);
}

function getSyncOutboxStatus() {
  const blocked = outbox.filter((item) => item.blockedReason);
  return {
    ...outboxStatus,
    pendingCount: outbox.length - blocked.length,
    conflictCount: blocked.filter((item) => item.blockedReason.includes("CONFLICT") ||
      item.blockedReason === "ENTITY_DELETED").length,
    rejectedCount: blocked.filter((item) => !item.blockedReason.includes("CONFLICT") &&
      item.blockedReason !== "ENTITY_DELETED").length,
  };
}

module.exports = {
  enqueueTodoDelete,
  enqueueTodoUpsert,
  getBlockedMutations,
  getPendingMutations,
  getSyncOutboxStatus,
  hasPendingForEntity,
  loadSyncOutbox,
  markMutationBlocked,
  markMutationAttempt,
  rebaseEntityMutations,
  removeEntityMutations,
  removeMutation,
  saveSyncOutbox,
  setMutationError,
};
