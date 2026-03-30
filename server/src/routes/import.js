const express = require('express');
const path = require('path');
const { requireDhis2Credentials } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { importTrackerData, getJobStatus } = require('../services/importService');
const { csvToJson, excelToJson } = require('../services/fileService');
const { buildTrackerPayload, convertToTracker } = require('../utils/payloadBuilder');
const { validateTrackerPayload } = require('../utils/payloadValidator');

const router = express.Router();

router.use(requireDhis2Credentials);

/**
 * POST /api/import/tracker
 * Upload a file (JSON/CSV/Excel) and import it to DHIS2.
 */
router.post('/tracker', upload.single('file'), async (req, res, next) => {
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
    const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : {};

    let payload;

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      const rows = csvToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const rows = await excelToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Validate before sending
    const validation = validateTrackerPayload(payload);
    if (!validation.valid) {
      return res.status(422).json({
        error: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const result = await importTrackerData(req, payload, options);

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
router.post('/validate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const dataType = req.body.dataType || 'events';
    const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : {};

    let payload;

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      const rows = csvToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const rows = await excelToJson(req.file.buffer);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    const validation = validateTrackerPayload(payload);
    const counts = {
      events: payload.events ? payload.events.length : 0,
      enrollments: payload.enrollments ? payload.enrollments.length : 0,
      trackedEntities: payload.trackedEntities ? payload.trackedEntities.length : 0,
    };

    res.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
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
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
