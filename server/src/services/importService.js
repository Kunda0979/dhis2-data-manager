const { createDhis2Client } = require('./dhis2Client');
const { convertToTracker } = require('../utils/payloadBuilder');

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
  return response.data;
}

/**
 * Get async import job status.
 */
async function getJobStatus(req, jobId) {
  const client = createDhis2Client(req);
  const response = await client.get(`/api/tracker/jobs/${jobId}`);
  return response.data;
}

module.exports = { importTrackerData, getJobStatus };
