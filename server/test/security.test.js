const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs/promises');
const request = require('supertest');
const http = require('http');
const ExcelJS = require('exceljs');

const app = require('../src/index');
const { normalizeDhis2BaseUrl } = require('../src/utils/security');
const { buildTrackerPayload, convertToTracker } = require('../src/utils/payloadBuilder');
const { validateTrackerPayload } = require('../src/utils/payloadValidator');
const { addHistoryEntry, listHistory, sweepExpiredHistory } = require('../src/services/historyService');
const {
  createExportJob,
  getExportJob,
  cancelExportJob,
  createJobOutputReadStream,
  assertAsyncRowLimit,
  sweepExpiredJobArtifacts,
} = require('../src/services/exportJobService');
const { streamAggregateData } = require('../src/services/exportService');
const {
  registerImportJob,
  getTrackedImportJob,
  toTrackedImportStatus,
  sweepExpiredImportJobs,
} = require('../src/services/importService');

test('normalizeDhis2BaseUrl strips query/hash and trailing slash', () => {
  const normalized = normalizeDhis2BaseUrl('https://play.dhis2.org/42/?x=1#frag');
  assert.equal(normalized, 'https://play.dhis2.org/42');
});

test('normalizeDhis2BaseUrl rejects credentialed URLs', () => {
  assert.throws(() => normalizeDhis2BaseUrl('https://user:pass@example.org'), {
    message: 'DHIS2 URL must not include embedded credentials',
  });
});

test('buildTrackerPayload ignores prototype pollution keys', () => {
  const row = { event: 'abc', program: 'prog', programStage: 'stage', orgUnit: 'org' };
  const payload = buildTrackerPayload([row], { __proto__: 'x', constructor: 'y' }, 'events');

  assert.equal(Object.prototype.x, undefined);
  assert.equal(Object.prototype.y, undefined);
  assert.equal(payload.events.length, 1);
});

test('buildTrackerPayload builds aggregate data value payloads', () => {
  const payload = buildTrackerPayload([
    {
      dataElement: 'f7n9E0hX8qk',
      period: '202604',
      orgUnit: 'DiszpKrYNg8',
      categoryOptionCombo: 'HllvX50cXC0',
      value: '15',
    },
  ], {}, 'aggregate');

  assert.equal(payload.dataValues.length, 1);
  assert.deepEqual(payload.dataValues[0], {
    dataElement: 'f7n9E0hX8qk',
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: 'HllvX50cXC0',
    attributeOptionCombo: undefined,
    value: '15',
    comment: undefined,
    storedBy: undefined,
  });
});

test('buildTrackerPayload builds aggregate data values from wide template fields', () => {
  const payload = buildTrackerPayload([
    {
      dataSet: 'BfMAe6Itzgt',
      period: '202604',
      orgUnit: 'DiszpKrYNg8',
      attributeOptionCombo: 'HllvX50cXC0',
      de_f7n9E0hX8qk__ANC_visits: '15',
      de_a3kGcGDCuk6__coc_HllvX50cXC0__Stock_outs_default: '3',
    },
  ], {}, 'aggregate');

  assert.equal(payload.dataValues.length, 2);
  assert.deepEqual(payload.dataValues[0], {
    dataElement: 'f7n9E0hX8qk',
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: undefined,
    attributeOptionCombo: 'HllvX50cXC0',
    value: '15',
    comment: undefined,
    storedBy: undefined,
  });
  assert.deepEqual(payload.dataValues[1], {
    dataElement: 'a3kGcGDCuk6',
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: 'HllvX50cXC0',
    attributeOptionCombo: 'HllvX50cXC0',
    value: '3',
    comment: undefined,
    storedBy: undefined,
  });
});

test('convertToTracker respects aggregate JSON arrays', () => {
  const payload = convertToTracker([{ dataElement: 'f7n9E0hX8qk', value: '9' }], 'aggregate');

  assert.ok(Array.isArray(payload.dataValues));
  assert.equal(payload.dataValues.length, 1);
});

test('validateTrackerPayload accepts aggregate data values', () => {
  const result = validateTrackerPayload({
    dataValues: [{
      dataElement: 'f7n9E0hX8qk',
      period: '202604',
      orgUnit: 'DiszpKrYNg8',
      categoryOptionCombo: 'HllvX50cXC0',
      value: '15',
    }],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('connection endpoint rejects malformed payloads', async () => {
  const res = await request(app)
    .post('/api/connect')
    .send({ url: 123, username: 'u', password: 'p' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Invalid request payload format');
});

test('connection endpoint auto-corrects DHIS2 URLs ending with /api', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/api/me')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'u1', username: 'user', displayName: 'User One', organisationUnits: [] }));
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/system/info')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '2.42.0', systemName: 'Test DHIS2' }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const res = await request(app)
    .post('/api/connect')
    .send({
      url: `http://127.0.0.1:${port}/api`,
      username: 'user',
      password: 'pass',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.activeProfile?.url, `http://127.0.0.1:${port}`);

  server.close();
});

test('import endpoint rejects invalid mapping JSON before processing file', async () => {
  const res = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('mapping', '{not-json}')
    .attach('file', Buffer.from('a,b\n1,2\n'), 'data.csv');

  assert.equal(res.status, 400);
  assert.equal(res.body.error?.message, 'Invalid mapping JSON payload');
});

test('validate endpoint returns validation token', async () => {
  const csv = [
    'program,programStage,orgUnit,occurredAt,status',
    'IpHINAT79UW,A03MvHHogjR,DiszpKrYNg8,2026-04-01,ACTIVE',
  ].join('\n');

  const res = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .attach('file', Buffer.from(csv), 'events.csv');

  assert.equal(res.status, 200);
  assert.ok(typeof res.body.validationToken === 'string');
  assert.ok(res.body.validationToken.length > 10);
});

test('import endpoint rejects requests without validation token', async () => {
  const csv = [
    'program,programStage,orgUnit,occurredAt,status',
    'IpHINAT79UW,A03MvHHogjR,DiszpKrYNg8,2026-04-01,ACTIVE',
  ].join('\n');

  const res = await request(app)
    .post('/api/import/tracker')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .attach('file', Buffer.from(csv), 'events.csv');

  assert.equal(res.status, 409);
  assert.equal(res.body.validationGate?.ok, false);
});

test('import endpoint accepts matching validation token for same file and options', async () => {
  const csv = [
    'program,programStage,orgUnit,occurredAt,status',
    'IpHINAT79UW,A03MvHHogjR,DiszpKrYNg8,2026-04-01,ACTIVE',
  ].join('\n');

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/api/tracker')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ importSummary: { importCount: { created: 1, updated: 0, ignored: 0 } } }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const validateRes = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .field('importStrategy', 'CREATE_AND_UPDATE')
    .field('atomicMode', 'ALL')
    .field('async', 'false')
    .attach('file', Buffer.from(csv), 'events.csv');

  const token = validateRes.body.validationToken;
  assert.equal(validateRes.status, 200);
  assert.ok(token);

  const importRes = await request(app)
    .post('/api/import/tracker')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .field('importStrategy', 'CREATE_AND_UPDATE')
    .field('atomicMode', 'ALL')
    .field('async', 'false')
    .field('validationToken', token)
    .attach('file', Buffer.from(csv), 'events.csv');

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.success, true);

  server.close();
});

test('validate endpoint flags UPDATE enrollment imports without real enrollment UID', async () => {
  const csv = [
    'program,orgUnit,trackedEntity,enrollment,enrolledAt,status',
    'IpHINAT79UW,DiszpKrYNg8,a1b2c3d4e5F,AUTO,2026-04-01,ACTIVE',
  ].join('\n');

  const res = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'enrollments')
    .field('importStrategy', 'UPDATE')
    .attach('file', Buffer.from(csv), 'enrollments.csv');

  assert.equal(res.status, 200);
  assert.equal(res.body.valid, false);
  assert.equal(Array.isArray(res.body.rowIssues?.errors), true);
  assert.equal(res.body.rowIssues.errors.some((issue) => issue.field === 'enrollment'), true);
});

test('sync tracker import returns blocking import report when DHIS2 reports errors', async () => {
  const csv = [
    'program,programStage,orgUnit,occurredAt,status',
    'IpHINAT79UW,A03MvHHogjR,DiszpKrYNg8,2026-04-01,ACTIVE',
  ].join('\n');

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/api/tracker')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ERROR',
        stats: { created: 0, updated: 0, ignored: 1, deleted: 0 },
        bundleReport: {
          errorReports: [{ message: 'Event date is required for one or more rows' }],
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const validateRes = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .field('importStrategy', 'CREATE_AND_UPDATE')
    .field('atomicMode', 'ALL')
    .field('async', 'false')
    .attach('file', Buffer.from(csv), 'events.csv');

  assert.equal(validateRes.status, 200);
  assert.ok(validateRes.body.validationToken);

  const importRes = await request(app)
    .post('/api/import/tracker')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'events')
    .field('importStrategy', 'CREATE_AND_UPDATE')
    .field('atomicMode', 'ALL')
    .field('async', 'false')
    .field('validationToken', validateRes.body.validationToken)
    .attach('file', Buffer.from(csv), 'events.csv');

  assert.equal(importRes.status, 422);
  assert.equal(importRes.body.importReport?.hasBlockingErrors, true);
  assert.equal(Array.isArray(importRes.body.importReport?.errors), true);
  assert.equal(importRes.body.importReport.errors.length > 0, true);

  server.close();
});

test('export async job endpoint queues a job', async () => {
  const res = await request(app)
    .post('/api/export/jobs')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .send({
      dataType: 'events',
      format: 'json',
      params: { program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8' },
    });

  assert.equal(res.status, 202);
  assert.ok(res.body.jobId);
});

test('tracker export job requires program filter by default', async () => {
  const res = await request(app)
    .post('/api/export/jobs')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .send({
      dataType: 'events',
      format: 'json',
      params: { orgUnit: 'DiszpKrYNg8' },
    });

  assert.equal(res.status, 400);
  assert.match(res.body.error?.message || '', /requires a program filter/i);
});

test('only one async export job can run per session', () => {
  const sessionId = `test-session-${Date.now()}-${Math.random()}`;
  const first = createExportJob({
    sessionId,
    credentials: {
      url: 'https://play.dhis2.org/42',
      username: 'user',
      password: 'pass',
    },
    dataType: 'events',
    format: 'json',
    params: { program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8' },
  });

  assert.ok(first.id);
  assert.throws(() => createExportJob({
    sessionId,
    credentials: {
      url: 'https://play.dhis2.org/42',
      username: 'user',
      password: 'pass',
    },
    dataType: 'trackedEntities',
    format: 'json',
    params: { program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8' },
  }), {
    message: /only 1 export job can run at a time/i,
  });

  cancelExportJob(first.id, sessionId);
});

test('async export row cap rejects oversized datasets with clear message', () => {
  assert.throws(() => assertAsyncRowLimit('events', 10001), {
    message: /async export exceeds the maximum allowed rows/i,
  });
});

test('export download stream is unavailable for unknown jobs', () => {
  const stream = createJobOutputReadStream('missing-job-id');
  assert.equal(stream, null);
});

test('export artifact cleanup marks output as expired', async () => {
  const sessionId = `export-retention-${Date.now()}-${Math.random()}`;
  const job = createExportJob({
    sessionId,
    credentials: {
      url: 'https://play.dhis2.org/42',
      username: 'user',
      password: 'pass',
    },
    dataType: 'events',
    format: 'json',
    params: { program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8' },
  });

  const filePath = path.join(os.tmpdir(), `${job.id}.json`);
  fsSync.writeFileSync(filePath, '{"data":[],"count":0}', 'utf8');

  job.status = 'completed';
  job.updatedAt = new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString();
  job.output = {
    contentType: 'application/json',
    filename: 'events.json',
    filePath,
    sizeBytes: 21,
  };

  await sweepExpiredJobArtifacts(Date.now());

  const storedJob = getExportJob(job.id);
  assert.equal(storedJob.output.filePath, null);
  assert.ok(storedJob.output.expiredAt);
});

test('import job registry returns expired status after retention sweep', async () => {
  const sessionId = `import-retention-${Date.now()}-${Math.random()}`;
  const record = registerImportJob({
    sessionId,
    jobId: 'import-job-1',
    dataType: 'events',
    status: 'RUNNING',
  });

  record.updatedAt = new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString();
  await sweepExpiredImportJobs(Date.now());

  const tracked = getTrackedImportJob(sessionId, 'import-job-1');
  const status = toTrackedImportStatus(tracked);
  assert.equal(status.status, 'EXPIRED');
  assert.equal(status.expired, true);
});

test('history retention sweep removes expired entries when configured', () => {
  const sessionId = `history-retention-${Date.now()}-${Math.random()}`;
  const entry = addHistoryEntry(sessionId, {
    type: 'export',
    status: 'success',
    details: 'old history',
  });

  entry.timestamp = new Date(Date.now() - (400 * 24 * 60 * 60 * 1000)).toISOString();
  const removed = sweepExpiredHistory(Date.now(), 24);

  const entries = listHistory(sessionId);
  assert.equal(removed >= 1, true);
  assert.equal(entries.length, 0);
});

test('aggregate export job rejects missing dataset or period', async () => {
  const res = await request(app)
    .post('/api/export/jobs')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .send({
      dataType: 'aggregate',
      format: 'json',
      params: { orgUnit: 'DiszpKrYNg8' },
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error?.message, 'Aggregate export requires a dataSet');
});

test('history endpoint returns list payload', async () => {
  const res = await request(app)
    .get('/api/history')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass');

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.entries));
});

test('history retention status endpoint returns retention payload', async () => {
  const res = await request(app)
    .get('/api/history/retention-status')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')

  assert.equal(res.status, 200)
  assert.ok(res.body.export)
  assert.ok(res.body.import)
  assert.ok(res.body.history)
})

test('metadata cache status endpoint returns observability payload', async () => {
  const res = await request(app)
    .get('/api/metadata/cache/status')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass');

  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'session');
  assert.ok(typeof res.body.ttlSeconds === 'number');
  assert.ok(typeof res.body.entries?.total === 'number');
  assert.ok(typeof res.body.entries?.session === 'number');
  assert.ok(typeof res.body.stats?.hits === 'number');
  assert.ok(typeof res.body.stats?.misses === 'number');
});

test('metadata cache status endpoint supports global scope', async () => {
  const res = await request(app)
    .get('/api/metadata/cache/status?scope=global')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass');

  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'global');
  assert.ok(typeof res.body.entries?.total === 'number');
  assert.ok(typeof res.body.stats?.sets === 'number');
  assert.ok(typeof res.body.hitRate === 'number');
});

test('template preview supports aggregate type', async () => {
  const res = await request(app)
    .get('/api/import/template/preview?dataType=aggregate&variant=empty')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass');

  assert.equal(res.status, 200);
  assert.equal(res.body.dataType, 'aggregate');
  assert.ok(Array.isArray(res.body.columns));
  assert.ok(res.body.columns.includes('dataElement'));
  assert.ok(res.body.columns.includes('period'));
});

test('template preview applies aggregate period query', async () => {
  const res = await request(app)
    .get('/api/import/template/preview?dataType=aggregate&variant=prepopulated&period=2026Q1')
    .set('x-dhis2-url', 'https://play.dhis2.org/42')
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass');

  assert.equal(res.status, 200);
  assert.equal(res.body.sampleRow?.period, '2026Q1');
});

test('aggregate template download includes dataset data elements in the workbook', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/api/dataSets/ds1')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'ds1',
        displayName: 'ANC Monthly',
        periodType: 'Monthly',
        categoryCombo: {
          id: 'cc1',
          displayName: 'Default',
          categoryOptionCombos: [{ id: 'HllvX50cXC0', displayName: 'default' }],
        },
        organisationUnits: [{ id: 'DiszpKrYNg8', displayName: 'Org Unit One' }],
        dataSetElements: [
          {
            dataElement: {
              id: 'f7n9E0hX8qk',
              displayName: 'ANC visits',
              valueType: 'INTEGER',
            },
          },
          {
            dataElement: {
              id: 'a3kGcGDCuk6',
              displayName: 'Stock outs',
              valueType: 'NUMBER',
            },
          },
        ],
      }));
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/validationRules')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ validationRules: [] }));
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/organisationUnits')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ organisationUnits: [] }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const res = await request(app)
      .get('/api/import/template?dataType=aggregate&variant=empty&format=xlsx&dataSetId=ds1&period=202604')
      .set('x-dhis2-url', `http://127.0.0.1:${port}`)
      .set('x-dhis2-username', 'user')
      .set('x-dhis2-password', 'pass')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
        response.on('error', callback);
      });

    assert.equal(res.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const dataEntrySheet = workbook.getWorksheet('Data Entry');
    const questionHeaders = dataEntrySheet.getRow(2).values
      .slice(1)
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const metadataSheet = workbook.getWorksheet('Metadata Snapshot');
    let fieldKeys = [];
    for (let rowNumber = 2; rowNumber <= metadataSheet.rowCount; rowNumber++) {
      const key = String(metadataSheet.getCell(rowNumber, 1).value || '').trim();
      if (key !== 'fieldKeys') continue;
      const rawValue = metadataSheet.getCell(rowNumber, 2).value;
      try {
        fieldKeys = JSON.parse(String(rawValue || '[]'));
      } catch {
        fieldKeys = [];
      }
      break;
    }

    assert.ok(questionHeaders.some((value) => value.includes('ANC visits')));
    assert.ok(questionHeaders.some((value) => value.includes('Stock outs')));
    assert.ok(fieldKeys.some((value) => value.startsWith('de_f7n9E0hX8qk')));
    assert.ok(fieldKeys.some((value) => value.startsWith('de_a3kGcGDCuk6')));
  } finally {
    server.close();
  }
});

test('aggregate validate step returns dataset validation violations while keeping import validation usable', async () => {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/dataAnalysis/validation')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        validationRuleViolations: [{
          id: 'vrv1',
          validationRule: { id: 'vr1', displayName: 'ANC visits must be <= deliveries' },
          leftsideValue: 12,
          rightsideValue: 4,
          operator: '<=',
          importance: 'HIGH',
        }],
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const csv = [
    'dataSet,dataElement,period,orgUnit,categoryOptionCombo,value',
    'BfMAe6Itzgt,f7n9E0hX8qk,202604,DiszpKrYNg8,HllvX50cXC0,15',
  ].join('\n');

  const res = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'aggregate')
    .attach('file', Buffer.from(csv), 'aggregate.csv');

  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true);
  assert.equal(res.body.aggregateValidation?.violationCount, 1);
  assert.equal(res.body.completionPolicy?.completionAllowed, false);

  server.close();
});

test('aggregate import still attempts completion after successful import even when dataset validation has violations', async () => {
  let dataValueSetPosts = 0;
  let completionPosts = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/api/dataValueSets')) {
      dataValueSetPosts += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ importSummary: { importCount: { imported: 1 } } }));
      return;
    }

    if (req.url?.startsWith('/api/dataAnalysis/validation')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        validationRuleViolations: [{
          id: 'vrv1',
          validationRule: { id: 'vr1', displayName: 'Rule failed' },
          leftsideValue: 5,
          rightsideValue: 2,
          operator: '<=',
          importance: 'HIGH',
        }],
      }));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/api/completeDataSetRegistrations')) {
      completionPosts += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK' }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const csv = [
    'dataSet,dataElement,period,orgUnit,categoryOptionCombo,value',
    'BfMAe6Itzgt,f7n9E0hX8qk,202604,DiszpKrYNg8,HllvX50cXC0,15',
  ].join('\n');

  const validateRes = await request(app)
    .post('/api/import/validate')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'aggregate')
    .field('markComplete', 'true')
    .attach('file', Buffer.from(csv), 'aggregate.csv');

  assert.equal(validateRes.status, 200);
  assert.ok(validateRes.body.validationToken);

  const res = await request(app)
    .post('/api/import/tracker')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .field('dataType', 'aggregate')
    .field('markComplete', 'true')
    .field('validationToken', validateRes.body.validationToken)
    .attach('file', Buffer.from(csv), 'aggregate.csv');

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.completion?.status, 'completed_successfully');
  assert.equal(dataValueSetPosts, 1);
  assert.equal(completionPosts, 1);

  server.close();
});

test('aggregate explicit un-complete calls completeDataSetRegistrations delete endpoint', async () => {
  let completionDeletes = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'DELETE' && req.url?.startsWith('/api/completeDataSetRegistrations')) {
      completionDeletes += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK' }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const res = await request(app)
    .post('/api/import/aggregate/completion')
    .set('x-dhis2-url', `http://127.0.0.1:${port}`)
    .set('x-dhis2-username', 'user')
    .set('x-dhis2-password', 'pass')
    .send({
      action: 'uncomplete',
      dataSet: 'BfMAe6Itzgt',
      period: '202604',
      orgUnit: 'DiszpKrYNg8',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'unregistered');
  assert.equal(completionDeletes, 1);

  server.close();
});

test('streamAggregateData emits chunked pages for aggregate exports', async () => {
  const dataValues = Array.from({ length: 235 }, (_, index) => ({
    dataElement: `de${index}`,
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: 'HllvX50cXC0',
    value: String(index),
  }));

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/dataValueSets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dataValues }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const reqLike = {
    dhis2Credentials: {
      url: `http://127.0.0.1:${port}`,
      username: 'user',
      password: 'pass',
    },
  };

  try {
    const pageSizes = [];
    const total = await streamAggregateData(reqLike, {}, { pageSize: 50 }, async (rows) => {
      pageSizes.push(rows.length);
    });

    assert.equal(total, 235);
    assert.equal(pageSizes.length, 5);
    assert.deepEqual(pageSizes, [50, 50, 50, 50, 35]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('streamAggregateData enforces maxRows for aggregate exports', async () => {
  const dataValues = Array.from({ length: 140 }, (_, index) => ({
    dataElement: `de${index}`,
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: 'HllvX50cXC0',
    value: String(index),
  }));

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/dataValueSets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dataValues }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const reqLike = {
    dhis2Credentials: {
      url: `http://127.0.0.1:${port}`,
      username: 'user',
      password: 'pass',
    },
  };

  try {
    await assert.rejects(
      streamAggregateData(reqLike, {}, { pageSize: 25, maxRows: 100 }, async () => {}),
      (err) => err && err.status === 413
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
