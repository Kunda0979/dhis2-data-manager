const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const {
  streamEvents,
  streamEnrollments,
  streamTrackedEntities,
  streamAggregateData,
} = require('./exportService');
const { applyExportGuardrails } = require('../utils/exportGuardrails');
const { updateHistoryByJobId } = require('./historyService');

const jobs = new Map();
const MAX_CONCURRENT_EXPORT_JOBS_PER_SESSION = parseInt(process.env.EXPORT_MAX_CONCURRENT_JOBS || '1', 10);
const EXPORT_ASYNC_MAX_ROWS = parseInt(process.env.EXPORT_ASYNC_MAX_ROWS || '10000', 10);
const EXPORT_JOB_OUTPUT_DIR = process.env.EXPORT_JOB_OUTPUT_DIR || path.join(os.tmpdir(), 'dhis2-data-manager-exports');
const EXPORT_JOB_RETENTION_MIN = parseInt(process.env.EXPORT_JOB_RETENTION_MIN || '120', 10);
const EXPORT_JOB_META_RETENTION_MIN = parseInt(process.env.EXPORT_JOB_META_RETENTION_MIN || '1440', 10);

let outputDirReady = null;
let cleanupTimerStarted = false;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SAFE_EXPORT_ASYNC_MAX_ROWS = parsePositiveInt(EXPORT_ASYNC_MAX_ROWS, 10000);
const SAFE_EXPORT_JOB_RETENTION_MIN = parsePositiveInt(EXPORT_JOB_RETENTION_MIN, 120);
const SAFE_EXPORT_JOB_META_RETENTION_MIN = parsePositiveInt(EXPORT_JOB_META_RETENTION_MIN, 1440);

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function ensureOutputDir() {
  if (!outputDirReady) {
    outputDirReady = fsp.mkdir(EXPORT_JOB_OUTPUT_DIR, { recursive: true });
  }
  return outputDirReady;
}

async function cleanupJobOutput(job, options = {}) {
  if (!job?.output?.filePath) return;
  try {
    await fsp.unlink(job.output.filePath);
    if (options.markExpired) {
      job.output = {
        ...job.output,
        filePath: null,
        expiredAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[ExportJob] Failed to remove output file', err.message);
    }
  }
}

function maybeStartCleanupTimer() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  const intervalMs = 60 * 1000;
  const timer = setInterval(() => {
    sweepExpiredJobArtifacts().catch((err) => {
      console.error('[ExportJob] Artifact sweep failed', err.message);
    });
  }, intervalMs);
  timer.unref();
}

async function sweepExpiredJobArtifacts() {
  const now = Date.now();
  const artifactRetentionMs = SAFE_EXPORT_JOB_RETENTION_MIN * 60 * 1000;
  const metadataRetentionMs = SAFE_EXPORT_JOB_META_RETENTION_MIN * 60 * 1000;

  for (const [jobId, job] of jobs.entries()) {
    if (!TERMINAL_STATUSES.has(job.status)) continue;

    const updatedAtMs = Date.parse(job.updatedAt) || now;
    const ageMs = now - updatedAtMs;

    if (job.output?.filePath && ageMs > artifactRetentionMs) {
      await cleanupJobOutput(job, { markExpired: true });
      updateHistoryByJobId(job.sessionId, job.id, {
        status: 'expired-output',
        details: 'Async export output expired after retention TTL',
      });
    }

    if (ageMs > metadataRetentionMs) {
      updateHistoryByJobId(job.sessionId, job.id, {
        status: 'expired',
        details: 'Async export job record expired after retention TTL',
      });
      jobs.delete(jobId);
    }
  }
}

function assertAsyncRowLimit(dataType, rowCount) {
  if (rowCount <= SAFE_EXPORT_ASYNC_MAX_ROWS) return;
  const err = new Error(
    `${dataType} async export exceeds the maximum allowed rows (${SAFE_EXPORT_ASYNC_MAX_ROWS}). Refine your filters before retrying.`
  );
  err.status = 413;
  throw err;
}

function isJobActive(job) {
  return job.status === 'queued' || job.status === 'running';
}

function countActiveJobsForSession(sessionId) {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.sessionId === sessionId && isJobActive(job)) {
      count++;
    }
  }
  return count;
}

function assertConcurrencyLimit(sessionId) {
  if (!Number.isFinite(MAX_CONCURRENT_EXPORT_JOBS_PER_SESSION) || MAX_CONCURRENT_EXPORT_JOBS_PER_SESSION < 1) {
    return;
  }
  const activeCount = countActiveJobsForSession(sessionId);
  if (activeCount >= MAX_CONCURRENT_EXPORT_JOBS_PER_SESSION) {
    const err = new Error(
      `Only ${MAX_CONCURRENT_EXPORT_JOBS_PER_SESSION} export job can run at a time for this session. Wait for the current job to finish or cancel it.`
    );
    err.status = 409;
    throw err;
  }
}

function flattenItem(item) {
  const flat = {};
  for (const [key, val] of Object.entries(item || {})) {
    if (Array.isArray(val)) {
      flat[key] = JSON.stringify(val);
    } else if (val !== null && typeof val === 'object') {
      for (const [subKey, subVal] of Object.entries(val)) {
        flat[`${key}.${subKey}`] = subVal;
      }
    } else {
      flat[key] = val;
    }
  }
  return flat;
}

function buildFilename(dataType, format) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const ext = format === 'excel' ? 'xlsx' : format;
  return `${dataType}-${timestamp}.${ext}`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvLine(row, columns) {
  return `${columns.map((column) => csvEscape(row[column])).join(',')}\n`;
}

function streamWrite(stream, chunk) {
  return new Promise((resolve, reject) => {
    const done = () => {
      stream.removeListener('error', onError);
      resolve();
    };
    const onError = (err) => {
      stream.removeListener('drain', done);
      reject(err);
    };

    stream.once('error', onError);
    if (stream.write(chunk)) {
      done();
      return;
    }
    stream.once('drain', done);
  });
}

function streamEnd(stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
    stream.end();
  });
}

function createJsonArrayWriter(filePath) {
  const output = fs.createWriteStream(filePath, { encoding: 'utf8' });
  let first = true;
  let count = 0;

  return {
    async open() {
      await streamWrite(output, '{"data":[');
    },
    async writeRows(rows) {
      for (const row of rows) {
        if (!first) {
          await streamWrite(output, ',');
        }
        first = false;
        await streamWrite(output, JSON.stringify(row));
        count++;
      }
    },
    async close() {
      await streamWrite(output, `],"count":${count}}`);
      await streamEnd(output);
      return count;
    },
    async abort() {
      output.destroy();
    },
  };
}

function createCsvWriter(filePath) {
  const output = fs.createWriteStream(filePath, { encoding: 'utf8' });
  let columns = null;
  let count = 0;

  return {
    async open() {
      return undefined;
    },
    async writeRows(rows) {
      for (const raw of rows) {
        const row = flattenItem(raw);
        if (!columns) {
          columns = Object.keys(row);
          if (columns.length > 0) {
            await streamWrite(output, `${columns.map((key) => csvEscape(key)).join(',')}\n`);
          }
        }
        if (columns && columns.length > 0) {
          await streamWrite(output, toCsvLine(row, columns));
        }
        count++;
      }
    },
    async close() {
      await streamEnd(output);
      return count;
    },
    async abort() {
      output.destroy();
    },
  };
}

function createXlsxWriter(filePath) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath });
  const worksheet = workbook.addWorksheet('Data');
  let columns = null;
  let count = 0;

  return {
    async open() {
      return undefined;
    },
    async writeRows(rows) {
      for (const raw of rows) {
        const row = flattenItem(raw);
        if (!columns) {
          columns = Object.keys(row);
          worksheet.columns = columns.map((key) => ({ header: key, key, width: 20 }));
        }

        const payload = {};
        for (const key of columns || []) {
          payload[key] = row[key];
        }
        worksheet.addRow(payload).commit();
        count++;
      }
    },
    async close() {
      worksheet.commit();
      await workbook.commit();
      return count;
    },
    async abort() {
      await workbook.commit().catch(() => {});
    },
  };
}

function createPdfWriter(filePath, title) {
  const output = fs.createWriteStream(filePath);
  const doc = new PDFDocument({ margin: 36, size: 'A4' });
  doc.pipe(output);
  let count = 0;

  return {
    async open() {
      doc.fontSize(16).text(title);
      doc.moveDown(0.25);
      doc.fontSize(10).fillColor('#475569').text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown();
    },
    async writeRows(rows) {
      for (const raw of rows) {
        const row = flattenItem(raw);
        doc.fontSize(11).fillColor('#0f172a').text(`Record ${count + 1}`, { underline: true });
        for (const [key, value] of Object.entries(row)) {
          const rendered = value === null || value === undefined ? '' : String(value);
          doc.fontSize(9).fillColor('#111827').text(`${key}: ${rendered}`);
        }
        doc.moveDown(0.5);
        count++;
      }
    },
    async close() {
      doc.end();
      await new Promise((resolve, reject) => {
        output.once('finish', resolve);
        output.once('error', reject);
      });
      return count;
    },
    async abort() {
      doc.destroy();
      output.destroy();
    },
  };
}

function createOutputWriter(job, filePath) {
  if (job.format === 'json') {
    return createJsonArrayWriter(filePath);
  }
  if (job.format === 'csv') {
    return createCsvWriter(filePath);
  }
  if (job.format === 'pdf') {
    return createPdfWriter(filePath, `${job.dataType} export`);
  }
  return createXlsxWriter(filePath);
}

function updateJobProgressByCount(job, count) {
  const baseline = 20;
  const range = 65;
  const ratio = Math.min(1, count / SAFE_EXPORT_ASYNC_MAX_ROWS);
  job.progress = Math.min(90, baseline + Math.round(ratio * range));
  job.updatedAt = new Date().toISOString();
}

async function streamRowsByType(reqLike, dataType, params, paging, onPage) {
  if (dataType === 'events') {
    return streamEvents(reqLike, params, paging, onPage);
  }
  if (dataType === 'enrollments') {
    return streamEnrollments(reqLike, params, paging, onPage);
  }
  if (dataType === 'trackedEntities') {
    return streamTrackedEntities(reqLike, params, paging, onPage);
  }
  return streamAggregateData(reqLike, params, paging, onPage);
}

function createExportJob({ sessionId, credentials, dataType, format, params = {} }) {
  assertConcurrencyLimit(sessionId);
  maybeStartCleanupTimer();
  const scopedExport = applyExportGuardrails(dataType, params);

  const id = crypto.randomUUID();
  const job = {
    id,
    sessionId,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataType,
    format,
    params: scopedExport.params,
    scope: scopedExport.scope,
    paging: scopedExport.paging,
    recordCount: 0,
    error: null,
    cancelled: false,
    output: null,
    outputExpired: false,
    outputContentType: format === 'json'
      ? 'application/json'
      : format === 'csv'
        ? 'text/csv'
        : format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    outputExtension: format === 'excel' ? 'xlsx' : format,
  };

  jobs.set(id, job);

  setImmediate(async () => {
    try {
      job.status = 'running';
      job.progress = 10;
      job.updatedAt = new Date().toISOString();

      const reqLike = {
        dhis2Credentials: {
          url: credentials.url,
          username: credentials.username,
          password: credentials.password,
        },
      };

      await ensureOutputDir();
      const filePath = path.join(EXPORT_JOB_OUTPUT_DIR, `${job.id}.${job.outputExtension}`);
      const writer = createOutputWriter(job, filePath);
      await writer.open();

      let count = 0;
      try {
        await streamRowsByType(reqLike, dataType, scopedExport.params, scopedExport.paging, async (rows) => {
          if (job.cancelled) {
            const cancelErr = new Error('Export job was cancelled');
            cancelErr.code = 'JOB_CANCELLED';
            throw cancelErr;
          }

          count += rows.length;
          assertAsyncRowLimit(dataType, count);
          updateJobProgressByCount(job, count);
          await writer.writeRows(rows);
        });

        job.recordCount = await writer.close();
      } catch (err) {
        await writer.abort();
        throw err;
      }

      const stats = await fsp.stat(filePath);
      job.output = {
        contentType: job.outputContentType,
        filename: buildFilename(dataType, job.outputExtension),
        filePath,
        sizeBytes: stats.size,
      };

      job.status = 'completed';
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      await cleanupJobOutput(job);
      if (job.cancelled || err.code === 'JOB_CANCELLED') {
        job.status = 'cancelled';
        job.error = null;
      } else {
        job.status = 'failed';
        job.error = err.message;
      }
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
    }
  });

  return job;
}

function getExportJob(jobId) {
  return jobs.get(jobId) || null;
}

function cancelExportJob(jobId, sessionId) {
  const job = jobs.get(jobId);
  if (!job || job.sessionId !== sessionId) return null;
  if (job.status === 'completed' || job.status === 'failed') return job;
  job.cancelled = true;
  job.status = 'cancelled';
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  cleanupJobOutput(job).catch((err) => {
    console.error('[ExportJob] Failed cleanup after cancel', err.message);
  });
  return job;
}

function createJobOutputReadStream(jobId) {
  const job = jobs.get(jobId);
  if (!job || !job.output?.filePath) return null;
  if (!fs.existsSync(job.output.filePath)) return null;
  return fs.createReadStream(job.output.filePath);
}

function getExportRetentionStatus() {
  let activeJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let cancelledJobs = 0;
  let expiredOutputs = 0;
  let availableOutputs = 0;

  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') activeJobs++;
    if (job.status === 'completed') completedJobs++;
    if (job.status === 'failed') failedJobs++;
    if (job.status === 'cancelled') cancelledJobs++;
    if (job.output?.expiredAt) expiredOutputs++;
    if (job.output?.filePath) availableOutputs++;
  }

  return {
    asyncMaxRows: SAFE_EXPORT_ASYNC_MAX_ROWS,
    outputRetentionMinutes: SAFE_EXPORT_JOB_RETENTION_MIN,
    metadataRetentionMinutes: SAFE_EXPORT_JOB_META_RETENTION_MIN,
    totalTrackedJobs: jobs.size,
    activeJobs,
    completedJobs,
    failedJobs,
    cancelledJobs,
    availableOutputs,
    expiredOutputs,
  };
}

module.exports = {
  createExportJob,
  getExportJob,
  cancelExportJob,
  countActiveJobsForSession,
  createJobOutputReadStream,
  assertAsyncRowLimit,
  sweepExpiredJobArtifacts,
  getExportRetentionStatus,
};
