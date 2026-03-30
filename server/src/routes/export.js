const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const { fetchTrackedEntities, fetchEnrollments, fetchEvents } = require('../services/exportService');
const { jsonToCsv, jsonToExcel } = require('../services/fileService');

const router = express.Router();

router.use(requireDhis2Credentials);

/**
 * GET /api/export/trackedEntities
 */
router.get('/trackedEntities', async (req, res, next) => {
  try {
    const { format = 'json', ...params } = req.query;
    const data = await fetchTrackedEntities(req, params);
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
    const data = await fetchEnrollments(req, params);
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
    const data = await fetchEvents(req, params);
    sendData(res, data, format, 'events');
  } catch (err) {
    next(err);
  }
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
