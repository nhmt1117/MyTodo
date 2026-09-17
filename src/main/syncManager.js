const defaultAccountStore = require("./syncAccount");
const defaultOutbox = require("./syncOutbox");
const defaultTodoStore = require("./todoStore");

const SUCCESS_INTERVAL_MS = 60_000;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

function localDueAt(todo) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todo?.date || ""));
  if (!match) return null;
  const time = /^(\d{2}):(\d{2})$/.exec(String(todo.dueTime || todo.remindTime || "09:00"));
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    time ? Number(time[1]) : 9,
    time ? Number(time[2]) : 0,
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildTodoSyncPayload(todo = {}) {
  const updatedAt = String(todo.updatedAt || new Date().toISOString());
  return {
    title: String(todo.text || ""),
    description: String(todo.desc || ""),
    dueAt: localDueAt(todo),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    priority: ["low", "mid", "high"].includes(todo.priority) ? todo.priority : "mid",
    isRecurring: !!todo.isCycle,
    recurrenceRule: todo.isCycle
      ? { type: todo.cycleType || "daily", startDate: todo.date || "" }
      : null,
    completedAt: todo.archived ? updatedAt : null,
    archivedAt: todo.archived ? updatedAt : null,
    reminderEnabled: !!todo.remind,
    reminderMode: todo.reminderMode || "auto",
    customReminderOffsets: Array.isArray(todo.customReminderOffsets)
      ? todo.customReminderOffsets
      : [],
    muteRemind: !!todo.muteRemind,
    snoozedUntil: todo.snoozedUntil || null,
  };
}

function errorMessage(error) {
  if (!error) return "同步失败";
  if (error.name === "AbortError") return "连接同步服务超时";
  return String(error.message || error);
}

function createSyncManager(options = {}) {
  const accountStore = options.accountStore || defaultAccountStore;
  const outbox = options.outbox || defaultOutbox;
  const todoStore = options.todoStore || defaultTodoStore;
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const requestTimeoutMs = Number(options.requestTimeoutMs) || REQUEST_TIMEOUT_MS;

  let started = false;
  let timer = null;
  let currentSync = null;
  let refreshPromise = null;
  let notifyStatus = () => {};
  let notifyTodoDataChanged = () => {};
  let accessToken = "";
  let accessTokenExpiresAt = 0;
  let failureCount = 0;
  const activeControllers = new Set();
  let state = {
    phase: "disabled",
    message: "尚未启用多端同步",
    lastSyncAt: "",
    lastError: "",
    nextRetryAt: "",
    manual: false,
  };

  function getState() {
    const account = accountStore.getSyncAccount();
    const queue = outbox.getSyncOutboxStatus();
    return {
      ...state,
      account,
      pendingCount: queue.pendingCount || 0,
      conflictCount: queue.conflictCount || 0,
      rejectedCount: queue.rejectedCount || 0,
      localTodoCount: todoStore.getTodoList().length,
    };
  }

  function publish(patch = {}) {
    state = { ...state, ...patch };
    const snapshot = getState();
    try {
      notifyStatus(snapshot);
    } catch (error) {
      console.error("发送同步状态失败", error);
    }
    return snapshot;
  }

  function clearSchedule() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function schedule(delayMs) {
    clearSchedule();
    if (!started || !accountStore.getSyncAccount().enabled) return;
    const delay = Math.max(250, Number(delayMs) || SUCCESS_INTERVAL_MS);
    const nextRetryAt = new Date(Date.now() + delay).toISOString();
    state.nextRetryAt = nextRetryAt;
    timer = setTimer(() => {
      timer = null;
      syncNow({ manual: false });
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  async function request(serverUrl, path, requestOptions = {}) {
    const controller = new AbortController();
    const timeout = setTimer(() => controller.abort(), requestTimeoutMs);
    if (timeout && typeof timeout.unref === "function") timeout.unref();
    activeControllers.add(controller);
    try {
      const response = await fetchImpl(`${serverUrl}${path}`, {
        method: requestOptions.method || "GET",
        headers: {
          accept: "application/json",
          ...(requestOptions.body ? { "content-type": "application/json" } : {}),
          ...(requestOptions.accessToken
            ? { authorization: `Bearer ${requestOptions.accessToken}` }
            : {}),
        },
        ...(requestOptions.body ? { body: JSON.stringify(requestOptions.body) } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (_error) {
          body = { message: text };
        }
      }
      if (!response.ok) {
        const error = new Error(body?.message || `同步服务返回 ${response.status}`);
        error.status = response.status;
        error.responseBody = body;
        throw error;
      }
      return body;
    } finally {
      clearTimer(timeout);
      activeControllers.delete(controller);
    }
  }

  function rememberAccessToken(bundle = {}) {
    accessToken = String(bundle.accessToken || "");
    const lifetime = Math.max(0, Number(bundle.accessTokenExpiresInSeconds) || 0);
    accessTokenExpiresAt = Date.now() + lifetime * 1000;
  }

  async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const credentials = accountStore.getSyncCredentials();
      if (!credentials?.enabled || !credentials.refreshToken) {
        throw new Error("同步账户凭据不可用");
      }
      const bundle = await request(credentials.serverUrl, "/auth/refresh", {
        method: "POST",
        body: {
          deviceId: credentials.deviceId,
          refreshToken: credentials.refreshToken,
        },
      });
      if (!bundle?.accessToken || !bundle?.refreshToken) {
        throw new Error("同步服务返回的令牌信息无效");
      }
      accountStore.updateRefreshToken(bundle.refreshToken);
      rememberAccessToken(bundle);
      return accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function authorizedRequest(path, requestOptions = {}, canRetry = true) {
    const account = accountStore.getSyncAccount();
    if (!account.enabled) throw new Error("尚未启用多端同步");
    if (!accessToken || accessTokenExpiresAt <= Date.now() + 30_000) {
      await refreshAccessToken();
    }
    try {
      return await request(account.serverUrl, path, {
        ...requestOptions,
        accessToken,
      });
    } catch (error) {
      if (canRetry && error.status === 401) {
        accessToken = "";
        accessTokenExpiresAt = 0;
        await refreshAccessToken();
        return authorizedRequest(path, requestOptions, false);
      }
      throw error;
    }
  }

  function captureTodoMutation(operation, todo) {
    if (operation === "delete") {
      outbox.enqueueTodoDelete({ uuid: todo.uuid, cloudRevision: todo.cloudRevision });
    } else {
      outbox.enqueueTodoUpsert({
        uuid: todo.uuid,
        cloudRevision: todo.cloudRevision,
        payload: buildTodoSyncPayload(todo),
      });
    }
    publish();
    if (started && accountStore.getSyncAccount().enabled) schedule(1_500);
  }

  function queueExistingTodos() {
    for (const todo of todoStore.getTodoSyncSnapshot()) {
      if (todo.deletedAt) {
        outbox.enqueueTodoDelete({ uuid: todo.uuid, cloudRevision: todo.cloudRevision });
      } else {
        outbox.enqueueTodoUpsert({
          uuid: todo.uuid,
          cloudRevision: 0,
          payload: buildTodoSyncPayload(todo),
        });
      }
    }
  }

  async function enableSync(details = {}) {
    if (details.confirmExistingUpload !== true) {
      throw new Error("请先确认上传现有本地待办");
    }
    if (accountStore.getSyncAccount().enabled) {
      throw new Error("当前电脑已经启用多端同步");
    }
    if (typeof accountStore.canStoreSyncCredentials === "function" &&
      !accountStore.canStoreSyncCredentials()) {
      throw new Error("Windows 安全存储当前不可用，暂时不能启用同步");
    }
    const serverUrl = accountStore.normalizeServerUrl(details.serverUrl);
    const deviceName = String(details.deviceName || accountStore.getDefaultDeviceName()).trim();
    publish({ phase: "connecting", message: "正在创建同步账户", lastError: "", manual: true });
    const registration = await request(serverUrl, "/auth/register-device", {
      method: "POST",
      body: { platform: "WINDOWS", deviceName },
    });
    accountStore.registerSyncAccount({
      serverUrl,
      userId: registration.userId,
      deviceId: registration.device?.id,
      deviceName: registration.device?.name || deviceName,
      refreshToken: registration.refreshToken,
      recoveryKey: registration.recoveryKey,
      initialUploadConfirmed: true,
    });
    rememberAccessToken(registration);
    queueExistingTodos();
    const syncState = await syncNow({ manual: true });
    return {
      ...syncState,
      recoveryKey: String(registration.recoveryKey || ""),
    };
  }

  function mutationBatch() {
    const selected = [];
    const entityIds = new Set();
    for (const mutation of outbox.getPendingMutations(100)) {
      if (entityIds.has(mutation.entityId)) continue;
      entityIds.add(mutation.entityId);
      selected.push(mutation);
    }
    return selected;
  }

  async function pushChanges() {
    let changed = false;
    for (let pass = 0; pass < 100; pass += 1) {
      const mutations = mutationBatch();
      if (!mutations.length) break;
      for (const mutation of mutations) outbox.markMutationAttempt(mutation.mutationId);

      let response;
      try {
        response = await authorizedRequest("/sync/push", {
          method: "POST",
          body: {
            mutations: mutations.map(({ createdAt, attemptCount, lastAttemptAt, lastError,
              blockedReason, serverEntity, ...mutation }) => mutation),
          },
        });
      } catch (error) {
        for (const mutation of mutations) {
          outbox.setMutationError(mutation.mutationId, errorMessage(error));
        }
        throw error;
      }

      const results = Array.isArray(response?.results) ? response.results : [];
      const resultById = new Map(results.map((result) => [result.mutationId, result]));
      for (const mutation of mutations) {
        const result = resultById.get(mutation.mutationId);
        if (result?.status === "applied") {
          outbox.removeMutation(mutation.mutationId);
          outbox.rebaseEntityMutations(mutation.entityId, result.appliedRevision);
          const pending = outbox.hasPendingForEntity(mutation.entityId);
          todoStore.setTodoCloudState(
            mutation.entityId,
            result.appliedRevision,
            pending ? "pending" : "synced",
          );
          changed = true;
        } else {
          const reason = result?.errorCode || (result?.status === "conflict"
            ? "REVISION_CONFLICT"
            : "SYNC_REJECTED");
          outbox.markMutationBlocked(mutation.mutationId, reason, result?.serverEntity);
          todoStore.setTodoCloudState(
            mutation.entityId,
            result?.appliedRevision ?? mutation.baseRevision,
            "conflict",
          );
          changed = true;
        }
      }
    }
    return changed;
  }

  async function pullChanges() {
    let changed = false;
    for (let page = 0; page < 1_000; page += 1) {
      const account = accountStore.getSyncAccount();
      const response = await authorizedRequest(
        `/sync/pull?cursor=${encodeURIComponent(account.cursor)}&limit=100`,
      );
      const changes = Array.isArray(response?.changes) ? response.changes : [];
      for (const change of changes) {
        const local = todoStore.getTodoSyncSnapshot()
          .find((item) => item.uuid === String(change.entityId).toLowerCase());
        if (outbox.hasPendingForEntity(change.entityId)) {
          if (!local || Number(change.revision) > Number(local.cloudRevision || 0)) {
            todoStore.setTodoCloudState(
              change.entityId,
              local?.cloudRevision || 0,
              "conflict",
            );
            changed = true;
          }
          continue;
        }
        todoStore.applyCloudTodo(
          change.entityId,
          change.payload || {},
          change.revision,
          change.operation,
        );
        changed = true;
      }
      accountStore.updateSyncCursor(response?.nextCursor || account.cursor);
      if (!response?.hasMore) break;
    }
    return changed;
  }

  async function performSync(manual) {
    const account = accountStore.getSyncAccount();
    if (!account.enabled) {
      return publish({
        phase: "disabled",
        message: "尚未启用多端同步",
        lastError: "",
        nextRetryAt: "",
        manual,
      });
    }

    clearSchedule();
    publish({
      phase: "syncing",
      message: "正在同步待办",
      lastError: "",
      nextRetryAt: "",
      manual,
    });
    try {
      const pushed = await pushChanges();
      const pulled = await pullChanges();
      if (pushed || pulled) notifyTodoDataChanged();
      failureCount = 0;
      const queue = outbox.getSyncOutboxStatus();
      const hasIssues = (queue.conflictCount || 0) + (queue.rejectedCount || 0) > 0;
      const snapshot = publish({
        phase: hasIssues ? "attention" : "idle",
        message: hasIssues ? "部分待办需要处理同步冲突" : "同步已完成",
        lastSyncAt: new Date().toISOString(),
        lastError: "",
        manual,
      });
      schedule(SUCCESS_INTERVAL_MS);
      return snapshot;
    } catch (error) {
      failureCount += 1;
      const retryDelay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * (2 ** (failureCount - 1)));
      const snapshot = publish({
        phase: "offline",
        message: "暂时无法连接同步服务，本地功能不受影响",
        lastError: errorMessage(error),
        manual,
      });
      schedule(retryDelay);
      return snapshot;
    }
  }

  function syncNow(options = {}) {
    if (currentSync) return currentSync;
    currentSync = performSync(options.manual === true).finally(() => {
      currentSync = null;
    });
    return currentSync;
  }

  function startSyncManager(startOptions = {}) {
    if (started) return getState();
    started = true;
    notifyStatus = typeof startOptions.notifyStatus === "function"
      ? startOptions.notifyStatus
      : () => {};
    notifyTodoDataChanged = typeof startOptions.notifyTodoDataChanged === "function"
      ? startOptions.notifyTodoDataChanged
      : () => {};
    if (accountStore.getSyncAccount().enabled) {
      publish({ phase: "idle", message: "等待同步", lastError: "" });
      schedule(1_000);
    } else {
      publish({ phase: "disabled", message: "尚未启用多端同步" });
    }
    return getState();
  }

  function stopSyncManager() {
    started = false;
    clearSchedule();
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
    accessToken = "";
    accessTokenExpiresAt = 0;
  }

  return {
    captureTodoMutation,
    enableSync,
    getSyncState: getState,
    startSyncManager,
    stopSyncManager,
    syncNow,
  };
}

const defaultManager = createSyncManager();

module.exports = {
  ...defaultManager,
  buildTodoSyncPayload,
  createSyncManager,
};
