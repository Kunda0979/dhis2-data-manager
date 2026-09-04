const { createDhis2Client } = require('./dhis2Client');
const { paginate, paginateEach } = require('../utils/pagination');
const JSONStream = require('JSONStream');

/**
 * Fetch all tracked entities with auto-pagination.
 */
async function fetchTrackedEntities(req, params, pagingOptions) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginate(client, '/api/tracker/trackedEntities', params, 'instances', pageSize, pagingOptions);
}

/**
 * Fetch all enrollments with auto-pagination.
 */
async function fetchEnrollments(req, params, pagingOptions) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginate(client, '/api/tracker/enrollments', params, 'instances', pageSize, pagingOptions);
}

/**
 * Fetch all events with auto-pagination.
 */
async function fetchEvents(req, params, pagingOptions) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginate(client, '/api/tracker/events', params, 'instances', pageSize, pagingOptions);
}

/**
 * Fetch aggregate data values.
 */
async function fetchAggregateData(req, params) {
  const client = createDhis2Client(req);
  const response = await client.get('/api/dataValueSets', { params });
  return response.data?.dataValues || [];
}

async function streamTrackedEntities(req, params, pagingOptions, onPage) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginateEach(client, '/api/tracker/trackedEntities', params, 'instances', pageSize, pagingOptions, onPage);
}

async function streamEnrollments(req, params, pagingOptions, onPage) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginateEach(client, '/api/tracker/enrollments', params, 'instances', pageSize, pagingOptions, onPage);
}

async function streamEvents(req, params, pagingOptions, onPage) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  return paginateEach(client, '/api/tracker/events', params, 'instances', pageSize, pagingOptions, onPage);
}

/**
 * Stream aggregate data values without materializing the full dataset in memory.
 */
async function streamAggregateData(req, params = {}, pagingOptions = {}, onPage = async () => {}) {
  const client = createDhis2Client(req);
  const pageSize = pagingOptions?.pageSize || 100;
  const maxRows = pagingOptions?.maxRows;
  const maxRowsErrorFactory = pagingOptions?.maxRowsErrorFactory;
  const response = await client.get('/api/dataValueSets', {
    params,
    responseType: 'stream',
  });

  const dataValueStream = response.data.pipe(JSONStream.parse('dataValues.*'));

  let rows = [];
  let totalCount = 0;
  let page = 1;

  return new Promise((resolve, reject) => {
    let settled = false;
    let processing = Promise.resolve();

    const fail = (err) => {
      if (settled) return;
      settled = true;
      response.data.destroy(err);
      reject(err);
    };

    dataValueStream.on('error', fail);
    response.data.on('error', fail);

    dataValueStream.on('data', (value) => {
      dataValueStream.pause();

      processing = processing
        .then(async () => {
          totalCount += 1;
          if (maxRows && totalCount > maxRows) {
            const err = typeof maxRowsErrorFactory === 'function'
              ? maxRowsErrorFactory()
              : new Error(`Export exceeds the configured row limit of ${maxRows}.`);
            if (!err.status) {
              err.status = 413;
            }
            throw err;
          }

          rows.push(value);
          if (rows.length >= pageSize) {
            await onPage(rows, { page, totalCount, pageSize });
            rows = [];
            page += 1;
          }
        })
        .then(() => {
          if (!settled) {
            dataValueStream.resume();
          }
        })
        .catch(fail);
    });

    dataValueStream.on('end', () => {
      processing
        .then(async () => {
          if (rows.length > 0) {
            await onPage(rows, { page, totalCount, pageSize });
          }
        })
        .then(() => {
          if (settled) return;
          settled = true;
          resolve(totalCount);
        })
        .catch(fail);
    });
  });
}

module.exports = {
  fetchTrackedEntities,
  fetchEnrollments,
  fetchEvents,
  fetchAggregateData,
  streamTrackedEntities,
  streamEnrollments,
  streamEvents,
  streamAggregateData,
};
