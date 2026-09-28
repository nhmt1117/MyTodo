const FREE_LIMITS = require("./freeLimits");

function normalizeLimits(value) {
  return Object.fromEntries(Object.entries(FREE_LIMITS).map(([key, fallback]) => {
    const number = value?.[key];
    return [key, Number.isInteger(number) && number > 0 && number <= 100000 ? number : fallback];
  }));
}

function membershipLimits(membership, now = Date.now()) {
  const expiresAt = membership?.expiresAt;
  const expired = expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now);
  return normalizeLimits(expired ? membership?.baseLimits : membership?.limits);
}

module.exports = { membershipLimits, normalizeLimits };
