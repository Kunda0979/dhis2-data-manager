const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const { exportLimiter } = require('../middleware/rateLimiter');
const { fetchTrackedEntities, fetchEnrollments, fetchEvents, fetchAggregateData } = require('../services/exportService');
const { jsonToCsv, jsonToExcel, jsonToPdf } = require('../services/fileService');
const { createExportJob, getExportJob, cancelExportJob, createJobOutputReadStream } = require('../services/exportJobService');
const { addHistoryEntry, updateHistoryByJobId } = require('../services/historyService');
const { applyExportGuardrails } = require('../utils/exportGuardrails');
const { ensureSelectionAccess } = require('../services/permissionService');
const { createAppError } = require('../utils/apiError');

const router = express.Router();

router.use(requireDhis2Credentials);
router.use(exportLimiter);

function sanitizeExportParams(params, dataType = 'events') {
  const allowed = dataType === 'aggregate'
    ? ['dataSet', 'period', 'orgUnit', 'children', 'includeDeleted']
    : ['program', 'orgUnit', 'ouMode', 'startDate', 'endDate', 'status'];
  const cleaned = {};
  for (const key of allowed) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      cleaned[key] = String(params[key]);
    }
  }
  return cleaned;
}

function validateAggregateParams(params) {
  if (!params.dataSet) {
    const err = new Error('Aggregate export requires a dataSet');
    err.status = 400;
    throw err;
  }

  if (!params.period) {
    const err = new Error('Aggregate export requires a period');
    err.status = 400;
    throw err;
  }
}

/**
 * GET /api/export/trackedEntities
 */
router.get('/trackedEntities', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const cleanedParams = sanitizeExportParams(params);
    const scopedExport = applyExportGuardrails('trackedEntities', cleanedParams);
    await ensureSelectionAccess(req, {
      programId: cleanedParams.program,
      orgUnitIds: cleanedParams.orgUnit ? [cleanedParams.orgUnit] : [],
    });
    const data = await fetchTrackedEntities(req, scopedExport.params, scopedExport.paging);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'trackedEntities',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams, scope: scopedExport.scope },
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
    const scopedExport = applyExportGuardrails('enrollments', cleanedParams);
    await ensureSelectionAccess(req, {
      programId: cleanedParams.program,
      orgUnitIds: cleanedParams.orgUnit ? [cleanedParams.orgUnit] : [],
    });
    const data = await fetchEnrollments(req, scopedExport.params, scopedExport.paging);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'enrollments',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams, scope: scopedExport.scope },
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
    const cleanedParams = sanitizeExportParams(params, 'events');
    const scopedExport = applyExportGuardrails('events', cleanedParams);
    await ensureSelectionAccess(req, {
      programId: cleanedParams.program,
      orgUnitIds: cleanedParams.orgUnit ? [cleanedParams.orgUnit] : [],
    });
    const data = await fetchEvents(req, scopedExport.params, scopedExport.paging);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'events',
      format,
      count: data.length,
      details: 'Synchronous export completed',
      metadata: { params: cleanedParams, scope: scopedExport.scope },
    });
    sendData(res, data, format, 'events');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/export/aggregate
 */
router.get('/aggregate', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const cleanedParams = sanitizeExportParams(params, 'aggregate');
    validateAggregateParams(cleanedParams);
    await ensureSelectionAccess(req, {
      dataSetId: cleanedParams.dataSet,
      orgUnitIds: cleanedParams.orgUnit ? [cleanedParams.orgUnit] : [],
    });
    const data = await fetchAggregateData(req, cleanedParams);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'export',
      status: 'success',
      mode: 'sync',
      dataType: 'aggregate',
      format,
      count: data.length,
      details: 'Synchronous aggregate export completed',
      metadata: { params: cleanedParams },
    });
    sendData(res, data, format, 'aggregate-data-values');
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', async (req, res, next) => {
  try {
    const { dataType = 'events', format = 'json', params = {} } = req.body || {};
    const allowedTypes = new Set(['events', 'enrollments', 'trackedEntities', 'aggregate']);
    const allowedFormats = new Set(['json', 'csv', 'xlsx', 'pdf']);

    if (!allowedTypes.has(dataType)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_EXPORT_TYPE',
        message: 'Invalid dataType for export job',
        hint: 'Use one of: events, enrollments, trackedEntities, aggregate.',
      });
    }

    if (!allowedFormats.has(format)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_EXPORT_FORMAT',
        message: 'Invalid format for export job',
        hint: 'Use one of: json, csv, xlsx, pdf.',
      });
    }

    const cleanedParams = sanitizeExportParams(params, dataType);
    const scopedExport = applyExportGuardrails(dataType, cleanedParams);
    if (dataType === 'aggregate') {
      validateAggregateParams(cleanedParams);
    }
    await ensureSelectionAccess(req, {
      programId: cleanedParams.program,
      dataSetId: cleanedParams.dataSet,
      orgUnitIds: cleanedParams.orgUnit ? [cleanedParams.orgUnit] : [],
    });
    const credentials = req.dhis2Credentials;
    const sessionId = req.authSession?.id || 'anonymous';
    const job = createExportJob({
      sessionId,
      credentials,
      dataType,
      format,
      params: scopedExport.params,
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
        params: scopedExport.params,
        scope: scopedExport.scope,
      },
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:jobId', (req, res, next) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.sessionId !== (req.authSession?.id || 'anonymous')) {
    return next(createAppError({
      status: 404,
      code: 'EXPORT_JOB_NOT_FOUND',
      message: 'Export job not found',
      hint: 'The job may belong to a different session or may have expired.',
    }));
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
    outputSizeBytes: job.output?.sizeBytes || null,
    outputExpired: Boolean(job.output?.expiredAt),
    outputExpiredAt: job.output?.expiredAt || null,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadUrl: job.status === 'completed' && !job.output?.expiredAt ? `/api/export/jobs/${job.id}/download` : null,
  });
});

router.post('/jobs/:jobId/cancel', (req, res, next) => {
  const sessionId = req.authSession?.id || 'anonymous';
  const job = cancelExportJob(req.params.jobId, sessionId);
  if (!job) {
    return next(createAppError({
      status: 404,
      code: 'EXPORT_JOB_NOT_FOUND',
      message: 'Export job not found',
      hint: 'The job may belong to a different session or may have expired.',
    }));
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

router.get('/jobs/:jobId/download', (req, res, next) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.sessionId !== (req.authSession?.id || 'anonymous')) {
    return next(createAppError({
      status: 404,
      code: 'EXPORT_JOB_NOT_FOUND',
      message: 'Export job not found',
      hint: 'The job may belong to a different session or may have expired.',
    }));
  }

  if (job.output?.expiredAt) {
    return next(createAppError({
      status: 410,
      code: 'EXPORT_OUTPUT_EXPIRED',
      message: 'Export output expired after retention TTL',
      hint: 'Rerun the export job to generate a new downloadable file.',
    }));
  }

  if (job.status !== 'completed' || !job.output?.filePath) {
    return next(createAppError({
      status: 409,
      code: 'EXPORT_JOB_NOT_READY',
      message: 'Export job is not ready for download',
      hint: 'Wait for completion or check job status in history.',
    }));
  }

  const outputStream = createJobOutputReadStream(job.id);
  if (!outputStream) {
    return next(createAppError({
      status: 410,
      code: 'EXPORT_OUTPUT_MISSING',
      message: 'Export file is no longer available',
      hint: 'Rerun the export job to regenerate output.',
    }));
  }

  updateHistoryByJobId(req.authSession?.id || 'anonymous', job.id, {
    status: 'success',
    count: job.recordCount,
    details: 'Async export download completed',
  });

  res.setHeader('Content-Type', job.output.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${job.output.filename}"`);
  if (job.output.sizeBytes) {
    res.setHeader('Content-Length', String(job.output.sizeBytes));
  }

  outputStream.on('error', (err) => {
    next(err);
  });

  outputStream.pipe(res);
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
