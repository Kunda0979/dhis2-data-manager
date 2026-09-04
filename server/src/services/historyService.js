const crypto = require('crypto');

const MAX_HISTORY_ITEMS = parseInt(process.env.MAX_HISTORY_ITEMS || '300', 10);
const HISTORY_RETENTION_HOURS = parseInt(process.env.HISTORY_RETENTION_HOURS || '0', 10);
const historyBySessionId = new Map();
let cleanupTimerStarted = false;

function parseNonNegativeInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SAFE_HISTORY_RETENTION_HOURS = parseNonNegativeInt(HISTORY_RETENTION_HOURS, 0);

function maybeStartCleanupTimer() {
  if (cleanupTimerStarted || SAFE_HISTORY_RETENTION_HOURS === 0) return;
  cleanupTimerStarted = true;
  const timer = setInterval(() => {
    sweepExpiredHistory();
  }, 60 * 60 * 1000);
  timer.unref();
}

function sweepExpiredHistory(now = Date.now(), retentionHours = SAFE_HISTORY_RETENTION_HOURS) {
  if (retentionHours === 0) {
    return 0;
  }

  const retentionMs = retentionHours * 60 * 60 * 1000;
  let removed = 0;

  for (const [sessionId, history] of historyBySessionId.entries()) {
    const next = history.filter((entry) => {
      const timestampMs = Date.parse(entry.updatedAt || entry.timestamp) || now;
      const keep = now - timestampMs <= retentionMs;
      if (!keep) {
        removed++;
      }
      return keep;
    });
    historyBySessionId.set(sessionId, next);
  }

  return removed;
}

function getSessionHistory(sessionId) {
  maybeStartCleanupTimer();
  sweepExpiredHistory();
  if (!historyBySessionId.has(sessionId)) {
    historyBySessionId.set(sessionId, []);
  }
  return historyBySessionId.get(sessionId);
}

function addHistoryEntry(sessionId, entry) {
  const history = getSessionHistory(sessionId);
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  history.unshift(record);
  if (history.length > MAX_HISTORY_ITEMS) {
    history.length = MAX_HISTORY_ITEMS;
  }
  return record;
}

function listHistory(sessionId, { type, status, q } = {}) {
  const history = getSessionHistory(sessionId);
  return history.filter((entry) => {
    if (type && entry.type !== type) return false;
    if (status && entry.status !== status) return false;
    if (q) {
      const haystack = JSON.stringify(entry).toLowerCase();
      if (!haystack.includes(String(q).toLowerCase())) return false;
    }
    return true;
  });
}

function getHistoryEntry(sessionId, id) {
  const history = getSessionHistory(sessionId);
  return history.find((entry) => entry.id === id) || null;
}

function deleteHistoryEntry(sessionId, id) {
  const history = getSessionHistory(sessionId);
  const next = history.filter((entry) => entry.id !== id);
  const deleted = next.length !== history.length;
  historyBySessionId.set(sessionId, next);
  return deleted;
}

function clearHistory(sessionId) {
  historyBySessionId.set(sessionId, []);
}

function updateHistoryByJobId(sessionId, jobId, patch) {
  const history = getSessionHistory(sessionId);
  const entry = history.find((item) => item.metadata?.jobId === jobId);
  if (!entry) return null;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  return entry;
}

function getHistoryRetentionStatus(sessionId) {
  const sessionHistory = getSessionHistory(sessionId);
  let expiredEntries = 0;
  for (const entry of sessionHistory) {
    if (entry.status === 'expired' || entry.status === 'expired-output') {
      expiredEntries++;
    }
  }

  return {
    retentionHours: SAFE_HISTORY_RETENTION_HOURS,
    maxItems: MAX_HISTORY_ITEMS,
    totalEntries: sessionHistory.length,
    expiredEntries,
  };
}

module.exports = {
  addHistoryEntry,
  listHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  updateHistoryByJobId,
  sweepExpiredHistory,
  getHistoryRetentionStatus,
};
