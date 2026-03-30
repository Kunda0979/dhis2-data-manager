const crypto = require('crypto');

const MAX_HISTORY_ITEMS = parseInt(process.env.MAX_HISTORY_ITEMS || '300', 10);
const historyBySessionId = new Map();

function getSessionHistory(sessionId) {
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

module.exports = {
  addHistoryEntry,
  listHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  updateHistoryByJobId,
};
