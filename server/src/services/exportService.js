const { createDhis2Client } = require('./dhis2Client');
const { paginate } = require('../utils/pagination');

/**
 * Fetch all tracked entities with auto-pagination.
 */
async function fetchTrackedEntities(req, params) {
  const client = createDhis2Client(req);
  return paginate(client, '/api/tracker/trackedEntities', params, 'instances');
}

/**
 * Fetch all enrollments with auto-pagination.
 */
async function fetchEnrollments(req, params) {
  const client = createDhis2Client(req);
  return paginate(client, '/api/tracker/enrollments', params, 'instances');
}

/**
 * Fetch all events with auto-pagination.
 */
async function fetchEvents(req, params) {
  const client = createDhis2Client(req);
  return paginate(client, '/api/tracker/events', params, 'instances');
}

module.exports = { fetchTrackedEntities, fetchEnrollments, fetchEvents };
