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
