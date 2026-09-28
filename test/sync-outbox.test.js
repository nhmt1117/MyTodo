const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadOutbox(directory) {
  const modulePath = require.resolve("../src/main/syncOutbox");
  const dataLocationModulePath = require.resolve("../src/main/dataLocation");
  delete require.cache[modulePath];
  delete require.cache[dataLocationModulePath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => directory } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("matches shared synchronization cases in the local outbox", (t) => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "contracts/sync-cases.json"), "utf8"));
  const source = path.resolve(__dirname, "../../MyTodo-Contracts/fixtures/sync-cases.json");
  if (fs.existsSync(source)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), cases);
  }

  for (const [index, entry] of cases.entries()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-sync-case-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const outbox = loadOutbox(directory);
    outbox.loadSyncOutbox();
    const uuid = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    if (entry.operation === "delete") {
      outbox.enqueueTodoUpsert({ uuid, cloudRevision: 0, payload: { title: entry.name } });
      assert.equal(outbox.enqueueTodoDelete({ uuid, cloudRevision: entry.localRevision }), null, entry.name);
      assert.deepEqual(outbox.getPendingMutations(), [], entry.name);
      continue;
    }

    const mutation = outbox.enqueueTodoUpsert({
      uuid,
      cloudRevision: entry.localRevision,
      payload: { title: entry.name },
    });
    assert.equal(mutation.baseRevision, entry.localRevision, entry.name);
    if (entry.expected === "conflict") {
      outbox.markMutationBlocked(mutation.mutationId, entry.errorCode, {
        id: uuid,
        revision: entry.serverRevision,
      });
      assert.equal(outbox.getBlockedMutations()[0].blockedReason, entry.errorCode, entry.name);
    } else {
      assert.equal(outbox.getPendingMutations().length, 1, entry.name);
    }
  }
});

test("sync outbox persists, coalesces unattempted changes and preserves attempted mutations", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-outbox-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const uuid = "1a132ac7-f448-4211-a4e9-cf51b2dd5a99";
  let outbox = loadOutbox(directory);
  outbox.loadSyncOutbox();

  const first = outbox.enqueueTodoUpsert({
    uuid,
    cloudRevision: 0,
    payload: { title: "First" },
  });
  const coalesced = outbox.enqueueTodoUpsert({
    uuid,
    cloudRevision: 0,
    payload: { title: "Latest" },
  });
  assert.equal(coalesced.mutationId, first.mutationId);
  assert.equal(outbox.getPendingMutations().length, 1);
  assert.equal(outbox.getPendingMutations()[0].payload.title, "Latest");

  assert.equal(outbox.markMutationAttempt(first.mutationId, "offline"), true);
  const second = outbox.enqueueTodoUpsert({
    uuid,
    cloudRevision: 4,
    payload: { title: "After retry" },
  });
  assert.notEqual(second.mutationId, first.mutationId);
  assert.equal(outbox.getPendingMutations().length, 2);

  const deletion = outbox.enqueueTodoDelete({ uuid, cloudRevision: 4 });
  assert.equal(deletion.mutationId, second.mutationId);
  assert.equal(deletion.operation, "delete");

  outbox = loadOutbox(directory);
  const reloaded = outbox.loadSyncOutbox();
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].attemptCount, 1);
  assert.equal(reloaded[1].operation, "delete");
  assert.equal(outbox.removeMutation(first.mutationId), true);
  assert.equal(outbox.enqueueTodoDelete({ uuid, cloudRevision: 0 }), null);
  assert.deepEqual(outbox.getPendingMutations(), []);
  assert.equal(outbox.getSyncOutboxStatus().pendingCount, 0);
});

test("damaged sync outbox enters read-only protection", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-outbox-damaged-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "sync-outbox.json"), "{broken", "utf8");
  fs.writeFileSync(path.join(directory, "sync-outbox.json.bak"), "[]", "utf8");

  const outbox = loadOutbox(directory);
  assert.deepEqual(outbox.loadSyncOutbox(), []);
  assert.equal(outbox.getSyncOutboxStatus().readOnly, true);
  assert.throws(() => outbox.enqueueTodoUpsert({
    uuid: "8364ac13-827c-41fa-9078-3c048d26c80a",
    cloudRevision: 0,
    payload: { title: "Must not overwrite" },
  }), /只读保护/);
});

test("blocked conflicts can be inspected and removed by entity", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-outbox-conflict-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outbox = loadOutbox(directory);
  outbox.loadSyncOutbox();
  const uuid = "1a132ac7-f448-4211-a4e9-cf51b2dd5a99";
  const mutation = outbox.enqueueTodoUpsert({
    uuid,
    cloudRevision: 1,
    payload: { title: "Local" },
  });
  outbox.markMutationBlocked(mutation.mutationId, "REVISION_CONFLICT", {
    title: "Cloud",
    revision: 2,
  });

  const conflicts = outbox.getBlockedMutations();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].serverEntity.title, "Cloud");
  conflicts[0].serverEntity.title = "Changed outside";
  assert.equal(outbox.getBlockedMutations()[0].serverEntity.title, "Cloud");
  assert.equal(outbox.removeEntityMutations(uuid), 1);
  assert.equal(outbox.getBlockedMutations().length, 0);
});

test("editing after a quota rejection replaces the blocked upload", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-outbox-quota-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outbox = loadOutbox(directory);
  outbox.loadSyncOutbox();
  const uuid = "371ce7bd-e242-4cb1-a8fd-b9024bc8c582";
  const first = outbox.enqueueTodoUpsert({
    uuid, cloudRevision: 0, payload: { title: "Before quota" },
  });
  outbox.markMutationBlocked(first.mutationId, "ACTIVE_TODO_LIMIT_REACHED");
  const retry = outbox.enqueueTodoUpsert({
    uuid, cloudRevision: 0, payload: { title: "After freeing space" },
  });
  assert.notEqual(retry.mutationId, first.mutationId);
  assert.equal(outbox.getBlockedMutations().length, 0);
  assert.equal(outbox.getPendingMutations().length, 1);
  assert.equal(outbox.getPendingMutations()[0].payload.title, "After freeing space");
});
