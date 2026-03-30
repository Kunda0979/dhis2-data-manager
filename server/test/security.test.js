const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/index');
const { normalizeDhis2BaseUrl } = require('../src/utils/security');
const { buildTrackerPayload } = require('../src/utils/payloadBuilder');

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

test('connection endpoint rejects malformed payloads', async () => {
  const res = await request(app)
    .post('/api/connect')
    .send({ url: 123, username: 'u', password: 'p' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Invalid request payload format');
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
  assert.equal(res.body.error, 'Invalid mapping JSON payload');
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
      params: { orgUnit: 'DiszpKrYNg8' },
    });

  assert.equal(res.status, 202);
  assert.ok(res.body.jobId);
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
