const test = require("node:test");
const assert = require("node:assert/strict");
const { createSyncManager } = require("../src/main/syncManager");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function createHarness(fetchImpl) {
  const todo = {
    id: 1,
    uuid: "2f296d9f-74f2-420c-ad0f-20bcf1fa086f",
    text: "Existing task",
    desc: "Local note",
    date: "2026-09-17",
    dueTime: "12:00",
    priority: "high",
    remind: true,
    reminderMode: "standard",
    customReminderOffsets: [1440, 0],
    cloudRevision: 0,
    syncState: "local",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T01:00:00.000Z",
  };
  const account = {
    enabled: false,
    serverUrl: "http://127.0.0.1:3100/api/v1",
    userId: "",
    deviceId: "",
    deviceName: "Test PC",
    cursor: "0",
  };
  let refreshToken = "";
  const items = [];
  const accountStore = {
    getSyncAccount: () => ({ ...account }),
    getSyncCredentials: () => ({ ...account, refreshToken }),
    normalizeServerUrl: (value) => String(value).replace(/\/$/, ""),
    getDefaultDeviceName: () => "Test PC",
    registerSyncAccount: (details) => {
      Object.assign(account, {
        enabled: true,
        serverUrl: details.serverUrl,
        userId: details.userId,
        deviceId: details.deviceId,
        deviceName: details.deviceName,
        cursor: "0",
      });
      refreshToken = details.refreshToken;
    },
    updateRefreshToken: (value) => { refreshToken = value; },
    updateSyncCursor: (value) => { account.cursor = String(value); },
  };
  const outbox = {
    enqueueTodoUpsert: (entry) => {
      const mutation = {
        mutationId: "a1bc9b49-0877-46ca-8766-e235ee9ab7f8",
        entityType: "todo",
        entityId: entry.uuid,
        operation: "upsert",
        baseRevision: entry.cloudRevision,
        payload: entry.payload,
        attemptCount: 0,
      };
      items.push(mutation);
      return mutation;
    },
    enqueueTodoDelete: () => null,
    getPendingMutations: () => items.map((item) => ({ ...item })),
    getSyncOutboxStatus: () => ({
      pendingCount: items.length,
      conflictCount: 0,
      rejectedCount: 0,
    }),
    markMutationAttempt: (id) => {
      const item = items.find((entry) => entry.mutationId === id);
      if (item) item.attemptCount += 1;
    },
    setMutationError: () => {},
    removeMutation: (id) => {
      const index = items.findIndex((entry) => entry.mutationId === id);
      if (index >= 0) items.splice(index, 1);
    },
    rebaseEntityMutations: () => {},
    hasPendingForEntity: (id) => items.some((entry) => entry.entityId === id),
    markMutationBlocked: () => {},
  };
  const todoStore = {
    getTodoList: () => [todo],
    getTodoSyncSnapshot: () => [todo],
    setTodoCloudState: (_id, revision, state) => {
      todo.cloudRevision = Number(revision);
      todo.syncState = state;
    },
    applyCloudTodo: (_id, payload, revision) => {
      todo.text = payload.title;
      todo.cloudRevision = Number(revision);
      todo.syncState = "synced";
    },
  };
  const manager = createSyncManager({
    accountStore,
    outbox,
    todoStore,
    fetch: fetchImpl,
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
  });
  return { account, items, manager, todo };
}

test("existing tasks upload only after explicit confirmation", async () => {
  const calls = [];
  const harness = createHarness(async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/auth/register-device")) {
      return jsonResponse({
        userId: "976561b7-a599-4b2d-b753-7e9325042881",
        device: {
          id: "f8978649-403b-4105-8121-b4d42ac743f7",
          name: "Test PC",
        },
        recoveryKey: "one-time-recovery-key",
        accessToken: "access-token",
        accessTokenExpiresInSeconds: 900,
        refreshToken: "refresh-token",
      }, 201);
    }
    if (url.endsWith("/sync/push")) {
      const mutation = calls.at(-1).body.mutations[0];
      return jsonResponse({
        results: [{
          mutationId: mutation.mutationId,
          entityId: mutation.entityId,
          status: "applied",
          appliedRevision: 1,
          errorCode: null,
          serverEntity: null,
        }],
      });
    }
    if (url.includes("/sync/pull")) {
      return jsonResponse({ changes: [], nextCursor: "1", hasMore: false });
    }
    throw new Error("Unexpected request " + url);
  });

  await assert.rejects(
    harness.manager.enableSync({ serverUrl: harness.account.serverUrl }),
    /确认/,
  );
  assert.equal(calls.length, 0);
  assert.equal(harness.items.length, 0);

  const result = await harness.manager.enableSync({
    serverUrl: harness.account.serverUrl,
    confirmExistingUpload: true,
  });
  assert.equal(result.recoveryKey, "one-time-recovery-key");
  assert.equal(harness.account.enabled, true);
  assert.equal(harness.todo.cloudRevision, 1);
  assert.equal(harness.todo.syncState, "synced");
  assert.equal(harness.items.length, 0);
  assert.ok(calls.some((call) => call.url.endsWith("/sync/push")));
  assert.ok(calls.some((call) => call.url.includes("/sync/pull")));
});

test("network failure keeps local data and queued mutations", async () => {
  const harness = createHarness(async () => {
    throw new Error("server offline");
  });
  Object.assign(harness.account, {
    enabled: true,
    userId: "976561b7-a599-4b2d-b753-7e9325042881",
    deviceId: "f8978649-403b-4105-8121-b4d42ac743f7",
  });
  harness.manager.captureTodoMutation("upsert", harness.todo);
  const result = await harness.manager.syncNow({ manual: true });
  assert.equal(result.phase, "offline");
  assert.equal(harness.todo.text, "Existing task");
  assert.equal(harness.items.length, 1);
});
