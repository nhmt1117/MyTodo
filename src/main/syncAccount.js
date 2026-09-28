const os = require("node:os");
const { safeStorage } = require("electron");
const { getDataFilePath } = require("./dataLocation");
const { readJsonWithBackup, writeJsonAtomic } = require("./storage");
const { normalizeLimits } = require("../shared/membershipLimits");

const ACCOUNT_SCHEMA_VERSION = 4;
const DEFAULT_SERVER_URL = "http://127.0.0.1:3100/api/v1";

let account = createEmptyAccount();
let loaded = false;
let accountStatus = { state: "pending", message: "同步账户尚未加载", readOnly: false };

function createEmptyAccount() {
  return {
    schemaVersion: ACCOUNT_SCHEMA_VERSION,
    enabled: false,
    serverUrl: normalizeServerUrl(process.env.MYTODO_SYNC_SERVER_URL || DEFAULT_SERVER_URL),
    userId: "",
    deviceId: "",
    deviceName: getDefaultDeviceName(),
    accountType: "RECOVERY_KEY",
    email: "",
    emailVerified: false,
    displayName: "",
    avatarPreset: "indigo",
    membership: null,
    refreshTokenEncrypted: "",
    recoveryKeyEncrypted: "",
    cursor: "0",
    initialUploadConfirmed: false,
    registeredAt: "",
  };
}

function getDefaultDeviceName() {
  const hostname = String(os.hostname() || "Windows 电脑").trim();
  return Array.from(hostname).slice(0, 80).join("") || "Windows 电脑";
}

function normalizeServerUrl(value) {
  const fallback = DEFAULT_SERVER_URL;
  try {
    const url = new URL(String(value || fallback).trim());
    if (!["http:", "https:"].includes(url.protocol)) return fallback;
    url.hash = "";
    url.search = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") pathname = "/api/v1";
    url.pathname = pathname;
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
}

function isAccountRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

function normalizeAccount(value = {}) {
  const source = isAccountRecord(value) ? value : {};
  const enabled = source.enabled === true && isUuid(source.userId) && isUuid(source.deviceId);
  const email = enabled ? String(source.email || "").trim().toLowerCase().slice(0, 254) : "";
  const accountType = enabled && (source.accountType === "EMAIL" || email)
    ? "EMAIL"
    : "RECOVERY_KEY";
  return {
    schemaVersion: ACCOUNT_SCHEMA_VERSION,
    enabled,
    serverUrl: normalizeServerUrl(source.serverUrl),
    userId: enabled ? String(source.userId).toLowerCase() : "",
    deviceId: enabled ? String(source.deviceId).toLowerCase() : "",
    deviceName: Array.from(String(source.deviceName || getDefaultDeviceName())).slice(0, 80).join(""),
    accountType,
    email: accountType === "EMAIL" ? email : "",
    emailVerified: accountType === "EMAIL" && source.emailVerified === true,
    displayName: enabled ? Array.from(String(source.displayName || "").trim()).slice(0, 40).join("") : "",
    avatarPreset: ["indigo", "emerald", "rose", "amber", "slate"].includes(source.avatarPreset)
      ? source.avatarPreset
      : "indigo",
    membership: enabled && source.membership && typeof source.membership === "object"
      ? {
        planCode: String(source.membership.planCode || "free").slice(0, 40),
        planName: String(source.membership.planName || "免费版").slice(0, 80),
        status: String(source.membership.status || "ACTIVE").slice(0, 40),
        confirmedAt: String(source.membership.confirmedAt || ""),
        expiresAt: source.membership.expiresAt ? String(source.membership.expiresAt) : null,
        limits: normalizeLimits(source.membership.limits),
        baseLimits: normalizeLimits(source.membership.baseLimits),
        limitsByPlatform: Object.fromEntries(["WINDOWS", "MACOS", "WEB", "ANDROID", "IOS"].map((platform) => {
          const limit = source.membership.limitsByPlatform?.[platform];
          return [platform, Number.isInteger(limit) && limit > 0 && limit <= 20 ? limit : 1];
        })),
        entitlements: Array.isArray(source.membership.entitlements)
          ? source.membership.entitlements.slice(0, 100).map((entry) => ({
            code: String(entry?.code || "").slice(0, 80),
            enabled: entry?.enabled === true,
          })).filter((entry) => entry.code)
          : [],
      }
      : null,
    refreshTokenEncrypted: enabled ? String(source.refreshTokenEncrypted || "") : "",
    recoveryKeyEncrypted: enabled ? String(source.recoveryKeyEncrypted || "") : "",
    cursor: /^\d+$/.test(String(source.cursor || "")) ? String(source.cursor) : "0",
    initialUploadConfirmed: enabled && source.initialUploadConfirmed === true,
    registeredAt: enabled ? String(source.registeredAt || "") : "",
  };
}

function getAccountFilePath() {
  return getDataFilePath("sync-account.json");
}

function encryptionAvailable() {
  return !!safeStorage && typeof safeStorage.isEncryptionAvailable === "function" &&
    safeStorage.isEncryptionAvailable();
}

function canStoreSyncCredentials() {
  return encryptionAvailable();
}

function encryptSecret(value) {
  if (!encryptionAvailable()) throw new Error("系统安全存储当前不可用，无法安全保存同步凭据");
  return safeStorage.encryptString(String(value || "")).toString("base64");
}

function decryptSecret(value) {
  if (!value) return "";
  if (!encryptionAvailable()) throw new Error("系统安全存储当前不可用，无法读取同步凭据");
  return safeStorage.decryptString(Buffer.from(String(value), "base64"));
}

function clonePublicAccount() {
  return {
    enabled: account.enabled,
    serverUrl: account.serverUrl,
    userId: account.userId,
    deviceId: account.deviceId,
    deviceName: account.deviceName,
    accountType: account.accountType,
    email: account.email,
    emailVerified: account.emailVerified,
    displayName: account.displayName,
    avatarPreset: account.avatarPreset,
    membership: account.membership ? JSON.parse(JSON.stringify(account.membership)) : null,
    cursor: account.cursor,
    initialUploadConfirmed: account.initialUploadConfirmed,
    registeredAt: account.registeredAt,
  };
}

function assertWritable() {
  if (!accountStatus.readOnly) return;
  throw new Error("同步账户文件无法读取，当前处于只读保护状态");
}

function ensureLoaded() {
  if (!loaded) loadSyncAccount();
}

function loadSyncAccount() {
  const result = readJsonWithBackup(getAccountFilePath(), createEmptyAccount(), isAccountRecord);
  account = normalizeAccount(result.value);
  loaded = true;

  if (result.source === "backup") {
    accountStatus = { state: "recovered", message: "同步账户已从自动备份恢复", readOnly: false };
    saveSyncAccount();
  } else if (result.primaryError) {
    accountStatus = {
      state: "error",
      message: "同步账户及自动备份均无法读取",
      readOnly: true,
    };
  } else if (account.enabled && !encryptionAvailable()) {
    accountStatus = {
      state: "locked",
      message: "系统安全存储暂时不可用，同步已暂停",
      readOnly: false,
    };
  } else {
    accountStatus = { state: "ok", message: "同步账户正常", readOnly: false };
    if (result.source === "primary") saveSyncAccount();
  }
  return clonePublicAccount();
}

function saveSyncAccount() {
  ensureLoaded();
  assertWritable();
  writeJsonAtomic(getAccountFilePath(), account, isAccountRecord);
}

function getSyncAccount() {
  ensureLoaded();
  return clonePublicAccount();
}

function getSyncCredentials() {
  ensureLoaded();
  if (!account.enabled) return null;
  return {
    ...clonePublicAccount(),
    refreshToken: decryptSecret(account.refreshTokenEncrypted),
  };
}

function registerSyncAccount(details = {}) {
  ensureLoaded();
  assertWritable();
  if (!details.initialUploadConfirmed) {
    throw new Error("必须先确认上传现有本地待办");
  }
  if (!isUuid(details.userId) || !isUuid(details.deviceId) || !details.refreshToken) {
    throw new Error("同步服务返回的账户信息无效");
  }
  account = normalizeAccount({
    enabled: true,
    serverUrl: details.serverUrl,
    userId: details.userId,
    deviceId: details.deviceId,
    deviceName: details.deviceName,
    accountType: details.accountType,
    email: details.email,
    emailVerified: details.emailVerified,
    displayName: details.displayName,
    avatarPreset: details.avatarPreset,
    refreshTokenEncrypted: encryptSecret(details.refreshToken),
    recoveryKeyEncrypted: encryptSecret(details.recoveryKey),
    cursor: "0",
    initialUploadConfirmed: true,
    registeredAt: new Date().toISOString(),
  });
  saveSyncAccount();
  accountStatus = { state: "ok", message: "同步账户正常", readOnly: false };
  return clonePublicAccount();
}

function updateAccountProfile(details = {}) {
  ensureLoaded();
  assertWritable();
  if (!account.enabled) throw new Error("尚未启用多端同步");
  const email = String(details.email || "").trim().toLowerCase().slice(0, 254);
  account.accountType = email ? "EMAIL" : "RECOVERY_KEY";
  account.email = email;
  account.emailVerified = !!email && details.emailVerified === true;
  if (details.displayName !== undefined) {
    account.displayName = Array.from(String(details.displayName).trim()).slice(0, 40).join("");
  }
  if (["indigo", "emerald", "rose", "amber", "slate"].includes(details.avatarPreset)) {
    account.avatarPreset = details.avatarPreset;
  }
  saveSyncAccount();
  return clonePublicAccount();
}

function updateMembership(details = {}) {
  ensureLoaded();
  assertWritable();
  if (!account.enabled) throw new Error("尚未启用多端同步");
  account.membership = normalizeAccount({
    ...account,
    membership: {
      planCode: details.plan?.code,
      planName: details.plan?.name,
      status: details.status,
      confirmedAt: details.confirmedAt,
      expiresAt: details.expiresAt,
      entitlements: details.entitlements,
      limits: details.limits,
      baseLimits: details.baseLimits,
      limitsByPlatform: details.limitsByPlatform,
    },
  }).membership;
  saveSyncAccount();
  return clonePublicAccount();
}

function clearSyncAccount() {
  ensureLoaded();
  assertWritable();
  const serverUrl = account.serverUrl;
  account = createEmptyAccount();
  account.serverUrl = serverUrl;
  saveSyncAccount();
  accountStatus = { state: "ok", message: "同步账户已退出", readOnly: false };
  return clonePublicAccount();
}

function updateRefreshToken(refreshToken) {
  ensureLoaded();
  assertWritable();
  if (!account.enabled || !refreshToken) return false;
  account.refreshTokenEncrypted = encryptSecret(refreshToken);
  saveSyncAccount();
  return true;
}

function updateSyncCursor(cursor) {
  ensureLoaded();
  assertWritable();
  const value = String(cursor || "");
  if (!/^\d+$/.test(value)) throw new Error("同步游标无效");
  if (account.cursor === value) return false;
  account.cursor = value;
  saveSyncAccount();
  return true;
}

function getRecoveryKey() {
  ensureLoaded();
  return account.enabled ? decryptSecret(account.recoveryKeyEncrypted) : "";
}

function getSyncAccountStatus() {
  ensureLoaded();
  return { ...accountStatus };
}

module.exports = {
  DEFAULT_SERVER_URL,
  canStoreSyncCredentials,
  clearSyncAccount,
  getDefaultDeviceName,
  getRecoveryKey,
  getSyncAccount,
  getSyncAccountStatus,
  getSyncCredentials,
  loadSyncAccount,
  normalizeServerUrl,
  registerSyncAccount,
  saveSyncAccount,
  updateRefreshToken,
  updateAccountProfile,
  updateMembership,
  updateSyncCursor,
};
