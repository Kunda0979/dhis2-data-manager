const crypto = require('crypto');
const { fetchEvents, fetchEnrollments, fetchTrackedEntities } = require('./exportService');
const { jsonToCsv, jsonToExcel, jsonToPdf } = require('./fileService');

const jobs = new Map();

function flattenArray(items) {
  return items.map((item) => {
    const flat = {};
    for (const [key, val] of Object.entries(item)) {
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
  });
}

function buildFilename(dataType, format) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const ext = format === 'excel' ? 'xlsx' : format;
  return `${dataType}-${timestamp}.${ext}`;
}

async function fetchByType(reqLike, dataType, params) {
  if (dataType === 'events') return fetchEvents(reqLike, params);
  if (dataType === 'enrollments') return fetchEnrollments(reqLike, params);
  return fetchTrackedEntities(reqLike, params);
}

function createExportJob({ sessionId, credentials, dataType, format, params = {} }) {
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
    params,
    recordCount: 0,
    error: null,
    cancelled: false,
    output: null,
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

      const data = await fetchByType(reqLike, dataType, params);
      if (job.cancelled) {
        job.status = 'cancelled';
        job.progress = 100;
        job.updatedAt = new Date().toISOString();
        return;
      }

      job.progress = 70;
      job.recordCount = data.length;

      if (format === 'json') {
        job.output = {
          contentType: 'application/json',
          filename: buildFilename(dataType, 'json'),
          body: Buffer.from(JSON.stringify({ data, count: data.length }), 'utf8'),
        };
      } else if (format === 'csv') {
        const csv = jsonToCsv(flattenArray(data));
        job.output = {
          contentType: 'text/csv',
          filename: buildFilename(dataType, 'csv'),
          body: Buffer.from(csv, 'utf8'),
        };
      } else if (format === 'pdf') {
        const buffer = await jsonToPdf(flattenArray(data), { title: `${dataType} export` });
        job.output = {
          contentType: 'application/pdf',
          filename: buildFilename(dataType, 'pdf'),
          body: Buffer.from(buffer),
        };
      } else {
        const buffer = await jsonToExcel(flattenArray(data));
        job.output = {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: buildFilename(dataType, 'xlsx'),
          body: Buffer.from(buffer),
        };
      }

      job.status = 'completed';
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
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
  return job;
}

module.exports = {
  createExportJob,
  getExportJob,
  cancelExportJob,
};
