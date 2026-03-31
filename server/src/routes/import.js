const express = require('express');
const path = require('path');
const { requireDhis2Credentials } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validateImportRequest } = require('../middleware/validate');
const { importLimiter } = require('../middleware/rateLimiter');
const { importTrackerData, getJobStatus } = require('../services/importService');
const { csvToJson, excelToJson, jsonToCsv, jsonToExcel } = require('../services/fileService');
const { buildTrackerPayload, convertToTracker } = require('../utils/payloadBuilder');
const { validateTrackerPayload } = require('../utils/payloadValidator');
const { addHistoryEntry } = require('../services/historyService');
const { buildIssueReport } = require('../utils/rowValidation');

const router = express.Router();

router.use(requireDhis2Credentials);

const ALLOWED_TEMPLATE_TYPES = new Set(['events', 'enrollments', 'trackedEntities']);
const ALLOWED_TEMPLATE_FORMATS = new Set(['json', 'csv', 'xlsx']);
const ALLOWED_TEMPLATE_VARIANTS = new Set(['empty', 'prepopulated']);

function buildTemplateRows(dataType, variant) {
  const empty = variant === 'empty';

  if (dataType === 'events') {
    return [{
      event: empty ? '' : 'vrr6fQh6vQf',
      status: empty ? '' : 'ACTIVE',
      program: empty ? '' : 'IpHINAT79UW',
      programStage: empty ? '' : 'A03MvHHogjR',
      orgUnit: empty ? '' : 'DiszpKrYNg8',
      occurredAt: empty ? '' : '2026-03-31',
      trackedEntity: empty ? '' : 'PMa2VCrupOd',
      enrollment: empty ? '' : 'AaB3zKZ2CXY',
      de_a3kGcGDCuk6: empty ? '' : '37.5',
      de_B4Q2mFh3xWk: empty ? '' : 'No symptoms',
    }];
  }

  if (dataType === 'enrollments') {
    return [{
      enrollment: empty ? '' : 'AaB3zKZ2CXY',
      trackedEntity: empty ? '' : 'PMa2VCrupOd',
      program: empty ? '' : 'IpHINAT79UW',
      orgUnit: empty ? '' : 'DiszpKrYNg8',
      enrolledAt: empty ? '' : '2026-03-30',
      occurredAt: empty ? '' : '2026-03-30',
      status: empty ? '' : 'ACTIVE',
    }];
  }

  return [{
    trackedEntity: empty ? '' : 'PMa2VCrupOd',
    trackedEntityType: empty ? '' : 'nEenWmSyUEp',
    orgUnit: empty ? '' : 'DiszpKrYNg8',
    attr_w75KJ2mc4zz: empty ? '' : 'John',
    attr_zDhUuAYrxNC: empty ? '' : 'Doe',
    attr_AxqcoiKURhU: empty ? '' : '1988-04-12',
  }];
}

async function sendTemplateFile(res, rows, dataType, variant, format) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileBase = `template-${dataType}-${variant}-${timestamp}`;

  if (format === 'csv') {
    const csv = jsonToCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    return res.send(csv);
  }

  if (format === 'xlsx') {
    const buffer = await jsonToExcel(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(buffer);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
  return res.send(JSON.stringify(rows, null, 2));
}

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
 * GET /api/import/template
 * Download import templates (empty or pre-populated).
 */
router.get('/template', async (req, res, next) => {
  try {
    const dataType = String(req.query.dataType || 'events');
    const format = String(req.query.format || 'csv').toLowerCase();
    const variant = String(req.query.variant || 'empty').toLowerCase();

    if (!ALLOWED_TEMPLATE_TYPES.has(dataType)) {
      return res.status(400).json({ error: 'Invalid dataType for template download' });
    }

    if (!ALLOWED_TEMPLATE_FORMATS.has(format)) {
      return res.status(400).json({ error: 'Invalid format for template download' });
    }

    if (!ALLOWED_TEMPLATE_VARIANTS.has(variant)) {
      return res.status(400).json({ error: 'Invalid variant for template download' });
    }

    const rows = buildTemplateRows(dataType, variant);
    await sendTemplateFile(res, rows, dataType, variant, format);
  } catch (err) {
    next(err);
  }
});

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
