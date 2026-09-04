const { createDhis2Client } = require('./dhis2Client');
const { convertToTracker } = require('../utils/payloadBuilder');
const { updateHistoryByJobId } = require('./historyService');

const importJobs = new Map();
const IMPORT_JOB_STATUS_RETENTION_HOURS = parseInt(process.env.IMPORT_JOB_STATUS_RETENTION_HOURS || '24', 10);
const IMPORT_JOB_META_RETENTION_HOURS = parseInt(process.env.IMPORT_JOB_META_RETENTION_HOURS || '168', 10);

let cleanupTimerStarted = false;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SAFE_IMPORT_JOB_STATUS_RETENTION_HOURS = parsePositiveInt(IMPORT_JOB_STATUS_RETENTION_HOURS, 24);
const SAFE_IMPORT_JOB_META_RETENTION_HOURS = parsePositiveInt(IMPORT_JOB_META_RETENTION_HOURS, 168);

function buildImportJobKey(sessionId, jobId) {
  return `${sessionId}:${jobId}`;
}

function maybeStartCleanupTimer() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  const timer = setInterval(() => {
    sweepExpiredImportJobs().catch((err) => {
      console.error('[ImportJob] Status sweep failed', err.message);
    });
  }, 60 * 60 * 1000);
  timer.unref();
}

function extractImportJobId(result) {
  return result?.id || result?.jobId || result?.response?.id || result?.response?.jobId || null;
}

function toTrackedImportStatus(record) {
  if (!record) return null;
  if (record.expired) {
    return {
      jobId: record.jobId,
      id: record.jobId,
      status: 'EXPIRED',
      expired: true,
      message: 'Import job status expired after retention TTL. Rerun the import if you need a fresh status snapshot.',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiredAt: record.expiredAt,
      lastKnownStatus: record.lastKnownStatus || null,
      dataType: record.dataType,
    };
  }

  return {
    ...(record.lastResponse || {}),
    jobId: record.jobId,
    id: record.jobId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dataType: record.dataType,
  };
}

function registerImportJob({ sessionId, jobId, dataType = 'tracker', status = 'PENDING', metadata = {} }) {
  if (!jobId) return null;
  maybeStartCleanupTimer();
  const now = new Date().toISOString();
  const record = {
    sessionId,
    jobId,
    dataType,
    createdAt: now,
    updatedAt: now,
    expired: false,
    expiredAt: null,
    lastKnownStatus: status,
    lastResponse: {
      id: jobId,
      jobId,
      status,
    },
    metadata,
  };
  importJobs.set(buildImportJobKey(sessionId, jobId), record);
  return record;
}

function getTrackedImportJob(sessionId, jobId) {
  return importJobs.get(buildImportJobKey(sessionId, jobId)) || null;
}

function markImportJobExpired(record, nowIso = new Date().toISOString()) {
  if (!record || record.expired) return record;
  record.expired = true;
  record.expiredAt = nowIso;
  record.updatedAt = nowIso;
  updateHistoryByJobId(record.sessionId, record.jobId, {
    status: 'expired',
    details: 'Async import job status expired after retention TTL',
  });
  return record;
}

async function sweepExpiredImportJobs(now = Date.now()) {
  const statusRetentionMs = SAFE_IMPORT_JOB_STATUS_RETENTION_HOURS * 60 * 60 * 1000;
  const metadataRetentionMs = SAFE_IMPORT_JOB_META_RETENTION_HOURS * 60 * 60 * 1000;
  let removed = 0;

  for (const [key, record] of importJobs.entries()) {
    const updatedAtMs = Date.parse(record.updatedAt || record.createdAt) || now;
    const ageMs = now - updatedAtMs;

    if (!record.expired && ageMs > statusRetentionMs) {
      markImportJobExpired(record, new Date(now).toISOString());
    }

    if (ageMs > metadataRetentionMs) {
      importJobs.delete(key);
      removed++;
    }
  }

  return removed;
}

function isTerminalImportStatus(status) {
  const normalized = String(status || '').toUpperCase();
  return ['COMPLETED', 'FAILED', 'ERROR', 'CANCELLED', 'WARNING'].includes(normalized);
}

function pushUnique(target, item) {
  const text = String(item || '').trim();
  if (!text) return;
  if (!target.includes(text)) target.push(text);
}

function collectMessagesDeep(node, { errors, warnings }) {
  if (!node) return;

  if (typeof node === 'string') {
    pushUnique(errors, node);
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectMessagesDeep(item, { errors, warnings }));
    return;
  }

  if (typeof node !== 'object') return;

  const status = String(node.status || node.httpStatus || node.severity || '').toUpperCase();
  const text = node.message || node.description || node.errorMessage || node.warningMessage || node.conflict || node.value;
  if (text) {
    if (status.includes('WARN')) {
      pushUnique(warnings, text);
    } else if (status.includes('ERROR') || status.includes('FAIL')) {
      pushUnique(errors, text);
    }
  }

  if (Array.isArray(node.errorReports)) {
    node.errorReports.forEach((r) => collectMessagesDeep({ ...r, status: r.status || 'ERROR' }, { errors, warnings }));
  }
  if (Array.isArray(node.warningReports)) {
    node.warningReports.forEach((r) => collectMessagesDeep({ ...r, status: r.status || 'WARNING' }, { errors, warnings }));
  }
  if (Array.isArray(node.conflicts)) {
    node.conflicts.forEach((r) => collectMessagesDeep({ ...r, status: r.status || 'ERROR' }, { errors, warnings }));
  }

  for (const value of Object.values(node)) {
    if (value && (typeof value === 'object' || Array.isArray(value))) {
      collectMessagesDeep(value, { errors, warnings });
    }
  }
}

function parseTrackerImportOutcome(raw = {}) {
  const status = String(raw?.status || raw?.response?.status || '').toUpperCase();
  const stats = raw?.stats
    || raw?.response?.stats
    || raw?.importSummary?.importCount
    || raw?.response?.importSummary?.importCount
    || {};

  const errors = [];
  const warnings = [];
  collectMessagesDeep(raw, { errors, warnings });

  const ignored = Number(stats?.ignored || 0);
  const failed = Number(stats?.failed || 0);
  const statusIndicatesError = status === 'ERROR' || status === 'FAILED';
  const hasBlockingErrors = statusIndicatesError || errors.length > 0 || failed > 0 || ignored > 0;

  return {
    status,
    stats,
    errors,
    warnings,
    hasBlockingErrors,
  };
}

function updateImportJobStatus(sessionId, jobId, statusResponse) {
  const record = getTrackedImportJob(sessionId, jobId);
  if (!record) return null;
  const nowIso = new Date().toISOString();
  record.lastResponse = statusResponse || record.lastResponse;
  record.lastKnownStatus = statusResponse?.status || record.lastKnownStatus;
  if (isTerminalImportStatus(record.lastKnownStatus)) {
    record.updatedAt = nowIso;
  } else {
    record.updatedAt = nowIso;
  }
  return record;
}

function getImportRetentionStatus() {
  let expiredJobs = 0;
  let activeJobs = 0;
  let terminalJobs = 0;

  for (const record of importJobs.values()) {
    if (record.expired) {
      expiredJobs++;
    } else if (isTerminalImportStatus(record.lastKnownStatus)) {
      terminalJobs++;
    } else {
      activeJobs++;
    }
  }

  return {
    statusRetentionHours: SAFE_IMPORT_JOB_STATUS_RETENTION_HOURS,
    metadataRetentionHours: SAFE_IMPORT_JOB_META_RETENTION_HOURS,
    totalTrackedJobs: importJobs.size,
    activeJobs,
    terminalJobs,
    expiredJobs,
  };
}

/**
 * Import tracker data to DHIS2.
 * @param {object} req - Express request (for credentials)
 * @param {object} payload - { trackedEntities, enrollments, events }
 * @param {object} options - { importStrategy, atomicMode, async }
 */
async function importTrackerData(req, payload, options = {}) {
  const client = createDhis2Client(req);
  const {
    importStrategy = 'CREATE_AND_UPDATE',
    atomicMode = 'ALL',
    async: asyncMode = false,
  } = options;

  const params = new URLSearchParams({
    importStrategy,
    atomicMode,
    async: String(asyncMode),
  });

  const response = await client.post(`/api/tracker?${params}`, payload);
  const data = response.data;

  if (!asyncMode) {
    const parsed = parseTrackerImportOutcome(data);
    return {
      ...data,
      importReport: parsed,
    };
  }

  return data;
}

/**
 * Import aggregate data values to DHIS2.
 * @param {object} req - Express request (for credentials)
 * @param {object} payload - { dataValues }
 */
async function importAggregateData(req, payload) {
  const client = createDhis2Client(req);
  const response = await client.post('/api/dataValueSets', payload);
  return response.data;
}

/**
 * Get async import job status.
 */
async function getJobStatus(req, jobId) {
  maybeStartCleanupTimer();
  await sweepExpiredImportJobs();
  const sessionId = req.authSession?.id || 'anonymous';
  const tracked = getTrackedImportJob(sessionId, jobId);
  if (tracked?.expired) {
    return toTrackedImportStatus(tracked);
  }

  const client = createDhis2Client(req);
  const response = await client.get(`/api/tracker/jobs/${jobId}`);
  const parsed = parseTrackerImportOutcome(response.data || {});
  const enriched = {
    ...(response.data || {}),
    importReport: parsed,
    hasBlockingErrors: parsed.hasBlockingErrors,
  };
  updateImportJobStatus(sessionId, jobId, enriched);
  return enriched;
}

module.exports = {
  importTrackerData,
  importAggregateData,
  getJobStatus,
  convertToTracker,
  extractImportJobId,
  registerImportJob,
  getTrackedImportJob,
  toTrackedImportStatus,
  parseTrackerImportOutcome,
  markImportJobExpired,
  sweepExpiredImportJobs,
  getImportRetentionStatus,
};
