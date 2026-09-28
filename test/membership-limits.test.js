const test = require("node:test");
const assert = require("node:assert/strict");
const { membershipLimits } = require("../src/shared/membershipLimits");

test("membership limits cache expires without deleting data", () => {
  const membership = { limits: { activeTodos: 200, completedTodos: 1000 },
    baseLimits: { activeTodos: 50, completedTodos: 300 }, expiresAt: "2026-10-01T00:00:00Z" };
  assert.deepEqual(membershipLimits(membership, Date.parse("2026-09-01")), membership.limits);
  assert.deepEqual(membershipLimits(membership, Date.parse("2026-11-01")), membership.baseLimits);
  assert.deepEqual(membershipLimits({ limits: { activeTodos: -1, completedTodos: "bad" } }), { activeTodos: 100, completedTodos: 500 });
});
