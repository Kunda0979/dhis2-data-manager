const express = require('express');
const path = require('path');
const { requireDhis2Credentials } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validateImportRequest } = require('../middleware/validate');
const { importLimiter } = require('../middleware/rateLimiter');
const { importTrackerData, getJobStatus } = require('../services/importService');
const { csvToJson, excelToJson } = require('../services/fileService');
const { buildTrackerPayload, convertToTracker } = require('../utils/payloadBuilder');
const { validateTrackerPayload } = require('../utils/payloadValidator');
const { addHistoryEntry } = require('../services/historyService');
const { buildIssueReport } = require('../utils/rowValidation');

const router = express.Router();

router.use(requireDhis2Credentials);

function parseMapping(mappingRaw) {
  if (!mappingRaw) return {};
  try {
    const parsed = JSON.parse(mappingRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Mapping must be a JSON object');
    }
    return parsed;
  } catch {
    const err = new Error('Invalid mapping JSON payload');
    err.status = 400;
    throw err;
  }
}

/**
 * POST /api/import/tracker
 * Upload a file (JSON/CSV/Excel) and import it to DHIS2.
 */
router.post('/tracker', importLimiter, validateImportRequest, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const options = {
      importStrategy: req.body.importStrategy || 'CREATE_AND_UPDATE',
      atomicMode: req.body.atomicMode || 'ALL',
      async: req.body.async === 'true',
    };
    const dataType = req.body.dataType || 'events';
    const mapping = parseMapping(req.body.mapping);

    let payload;
    let rows = [];

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      rows = await excelToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Validate before sending
    const validation = validateTrackerPayload(payload);
    const issueReport = buildIssueReport(rows, mapping, dataType);
    if (!validation.valid) {
      return res.status(422).json({
        error: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
        rowIssues: issueReport,
      });
    }

    const result = await importTrackerData(req, payload, options);

    const importCount = result?.importSummary?.importCount || result?.stats || {};
    const totalCount = (importCount.created || 0) + (importCount.updated || 0) + (importCount.deleted || 0) + (importCount.ignored || 0);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'import',
      status: 'success',
      mode: options.async ? 'async' : 'sync',
      dataType,
      count: totalCount,
      details: 'Import completed successfully',
      metadata: {
        importStrategy: options.importStrategy,
        atomicMode: options.atomicMode,
      },
    });

    res.json({
      success: true,
      result,
      warnings: validation.warnings,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/validate
 * Validate a file without importing.
 */
router.post('/validate', importLimiter, validateImportRequest, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const dataType = req.body.dataType || 'events';
    const mapping = parseMapping(req.body.mapping);

    let payload;
    let rows = [];

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      rows = await excelToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    const validation = validateTrackerPayload(payload);
    const issueReport = buildIssueReport(rows, mapping, dataType);
    const counts = {
      events: payload.events ? payload.events.length : 0,
      enrollments: payload.enrollments ? payload.enrollments.length : 0,
      trackedEntities: payload.trackedEntities ? payload.trackedEntities.length : 0,
    };

    res.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      rowIssues: issueReport,
      counts,
      preview: {
        events: payload.events ? payload.events.slice(0, 5) : [],
        enrollments: payload.enrollments ? payload.enrollments.slice(0, 5) : [],
        trackedEntities: payload.trackedEntities ? payload.trackedEntities.slice(0, 5) : [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/import/jobs/:jobId
 * Check async import job status.
 */
router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const status = await getJobStatus(req, req.params.jobId);

    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'import',
      status: status?.status?.toLowerCase?.() || 'running',
      mode: 'async',
      dataType: 'tracker',
      details: `Checked import job status for ${req.params.jobId}`,
      metadata: { jobId: req.params.jobId },
    });

    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
