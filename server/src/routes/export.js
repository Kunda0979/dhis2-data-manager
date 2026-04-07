const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const { fetchTrackedEntities, fetchEnrollments, fetchEvents } = require('../services/exportService');
const { jsonToCsv, jsonToExcel, jsonToPdf } = require('../services/fileService');
const { createExportJob, getExportJob, cancelExportJob } = require('../services/exportJobService');
const { addHistoryEntry, updateHistoryByJobId } = require('../services/historyService');

const router = express.Router();

router.use(requireDhis2Credentials);

function sanitizeExportParams(params) {
  const allowed = ['program', 'orgUnit', 'ouMode', 'startDate', 'endDate', 'status'];
  const cleaned = {};
  for (const key of allowed) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      cleaned[key] = String(params[key]);
    }
  }
  return cleaned;
}

/**
 * GET /api/export/trackedEntities
 */
router.get('/trackedEntities', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const cleanedParams = sanitizeExportParams(params);
    const data = await fetchTrackedEntities(req, cleanedParams);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'trackedEntities',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams },
    });
    sendData(res, data, format, 'tracked-entities');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/export/enrollments
 */
router.get('/enrollments', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const cleanedParams = sanitizeExportParams(params);
    const data = await fetchEnrollments(req, cleanedParams);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'enrollments',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams },
    });
    sendData(res, data, format, 'enrollments');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/export/events
 */
router.get('/events', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const cleanedParams = sanitizeExportParams(params);
    const data = await fetchEvents(req, cleanedParams);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'events',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams },
    });
    sendData(res, data, format, 'events');
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', async (req, res) => {
  const { dataType = 'events', format = 'json', params = {} } = req.body || {};
  const allowedTypes = new Set(['events', 'enrollments', 'trackedEntities']);
  const allowedFormats = new Set(['json', 'csv', 'xlsx', 'pdf']);

  if (!allowedTypes.has(dataType)) {
    return res.status(400).json({ error: 'Invalid dataType for export job' });
  }

  if (!allowedFormats.has(format)) {
    return res.status(400).json({ error: 'Invalid format for export job' });
  }

  const cleanedParams = sanitizeExportParams(params);
  const credentials = req.dhis2Credentials;
  const sessionId = req.authSession?.id || 'anonymous';
  const job = createExportJob({
    sessionId,
    credentials,
    dataType,
    format,
    params: cleanedParams,
  });

  addHistoryEntry(sessionId, {
    type: 'export',
    status: 'queued',
    mode: 'async',
    dataType,
    format,
    details: 'Async export job queued',
    metadata: {
      jobId: job.id,
      params: cleanedParams,
    },
  });

  res.status(202).json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
  });
});

router.get('/jobs/:jobId', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.sessionId !== (req.authSession?.id || 'anonymous')) {
    return res.status(404).json({ error: 'Export job not found' });
  }

  updateHistoryByJobId(req.authSession?.id || 'anonymous', job.id, {
    status: job.status,
    count: job.recordCount,
    details: job.error || `Async export ${job.status}`,
  });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    dataType: job.dataType,
    format: job.format,
    recordCount: job.recordCount,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadUrl: job.status === 'completed' ? `/api/export/jobs/${job.id}/download` : null,
  });
});

router.post('/jobs/:jobId/cancel', (req, res) => {
  const sessionId = req.authSession?.id || 'anonymous';
  const job = cancelExportJob(req.params.jobId, sessionId);
  if (!job) {
    return res.status(404).json({ error: 'Export job not found' });
  }

  addHistoryEntry(sessionId, {
    type: 'export',
    status: 'cancelled',
    mode: 'async',
    dataType: job.dataType,
    format: job.format,
    details: 'Async export job cancelled',
    metadata: { jobId: job.id, params: job.params },
  });

  res.json({ success: true, status: job.status });
});

router.get('/jobs/:jobId/download', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.sessionId !== (req.authSession?.id || 'anonymous')) {
    return res.status(404).json({ error: 'Export job not found' });
  }

  if (job.status !== 'completed' || !job.output) {
    return res.status(409).json({ error: 'Export job is not ready for download' });
  }

  updateHistoryByJobId(req.authSession?.id || 'anonymous', job.id, {
    status: 'success',
    count: job.recordCount,
    details: 'Async export download completed',
  });

  res.setHeader('Content-Type', job.output.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${job.output.filename}"`);
  res.send(job.output.body);
});

/**
 * Helper: send data in the requested format.
 */
async function sendData(res, data, format, filename) {
  const timestamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const flat = flattenArray(data);
    const csv = jsonToCsv(flat);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-${timestamp}.csv"`);
    res.send(csv);
  } else if (format === 'xlsx' || format === 'excel') {
    const flat = flattenArray(data);
    const buffer = await jsonToExcel(flat);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-${timestamp}.xlsx"`);
    res.send(buffer);
  } else if (format === 'pdf') {
    const flat = flattenArray(data);
    const buffer = await jsonToPdf(flat, { title: `${filename} export` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-${timestamp}.pdf"`);
    res.send(buffer);
  } else {
    res.json({ data, count: data.length });
  }
}

/**
 * Flatten an array of DHIS2 objects for CSV/Excel export.
 */
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

module.exports = router;
