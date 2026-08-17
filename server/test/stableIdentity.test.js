const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAggregateStableKey,
  buildEventStableKey,
  buildEnrollmentStableKey,
  buildTrackedEntityStableKey,
  generateStableDhis2Uid,
  buildRowHash,
  isEventKeyComplete,
  isEnrollmentKeyComplete,
  isValidDhis2Uid,
} = require('../src/utils/stableIdentity');

// --- isValidDhis2Uid ---

test('isValidDhis2Uid accepts valid DHIS2 UIDs', () => {
  assert.ok(isValidDhis2Uid('f7n9E0hX8qk'));
  assert.ok(isValidDhis2Uid('DiszpKrYNg8'));
  assert.ok(isValidDhis2Uid('HllvX50cXC0'));
});

test('isValidDhis2Uid rejects invalid UIDs', () => {
  assert.equal(isValidDhis2Uid(''), false);
  assert.equal(isValidDhis2Uid('1startsWithDigit'), false);
  assert.equal(isValidDhis2Uid('tooShort'), false);
  assert.equal(isValidDhis2Uid('thisIsTooLong!!'), false);
  assert.equal(isValidDhis2Uid('AUTO'), false);
});

// --- buildAggregateStableKey ---

test('buildAggregateStableKey produces a consistent pipe-delimited key', () => {
  const key = buildAggregateStableKey({
    dataSet: 'BfMAe6Itzgt',
    dataElement: 'f7n9E0hX8qk',
    period: '202604',
    orgUnit: 'DiszpKrYNg8',
    categoryOptionCombo: 'HllvX50cXC0',
    attributeOptionCombo: '',
  });
  assert.equal(key, 'BfMAe6Itzgt||f7n9E0hX8qk||202604||DiszpKrYNg8||HllvX50cXC0||');
});

test('buildAggregateStableKey is stable across calls with same input', () => {
  const input = { dataSet: 'DS1', dataElement: 'DE1', period: '202604', orgUnit: 'OU1', categoryOptionCombo: 'COC1', attributeOptionCombo: 'AOC1' };
  assert.equal(buildAggregateStableKey(input), buildAggregateStableKey(input));
});

// --- buildEventStableKey ---

test('buildEventStableKey produces a consistent key', () => {
  const key = buildEventStableKey({
    program: 'IpHINAT79UW',
    programStage: 'A03MvHHogjR',
    orgUnit: 'DiszpKrYNg8',
    occurredAt: '2026-04-07',
    trackedEntity: 'PMa2VCrupOd',
  });
  assert.equal(key, 'IpHINAT79UW||A03MvHHogjR||DiszpKrYNg8||2026-04-07||PMa2VCrupOd');
});

test('buildEventStableKey is the same key on re-call', () => {
  const row = { program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-04-07', trackedEntity: '' };
  assert.equal(buildEventStableKey(row), buildEventStableKey(row));
});

// --- buildEnrollmentStableKey ---

test('buildEnrollmentStableKey produces a consistent key', () => {
  const key = buildEnrollmentStableKey({
    program: 'IpHINAT79UW',
    orgUnit: 'DiszpKrYNg8',
    trackedEntity: 'PMa2VCrupOd',
    enrolledAt: '2026-03-30',
    occurredAt: '',
  });
  assert.ok(key.includes('IpHINAT79UW'));
  assert.ok(key.includes('PMa2VCrupOd'));
});

// --- buildTrackedEntityStableKey ---

test('buildTrackedEntityStableKey produces a pipe-delimited key', () => {
  const key = buildTrackedEntityStableKey({ trackedEntityType: 'nEenWmSyUEp', orgUnit: 'DiszpKrYNg8' });
  assert.equal(key, 'nEenWmSyUEp||DiszpKrYNg8');
});

// --- generateStableDhis2Uid ---

test('generateStableDhis2Uid produces an 11-character UID', () => {
  const uid = generateStableDhis2Uid('program||stage||orgUnit||2026-04-07||te');
  assert.equal(uid.length, 11);
});

test('generateStableDhis2Uid first character is a letter', () => {
  const uid = generateStableDhis2Uid('any-stable-key');
  assert.match(uid[0], /[A-Za-z]/);
});

test('generateStableDhis2Uid all characters are alphanumeric', () => {
  const uid = generateStableDhis2Uid('any-stable-key');
  assert.match(uid, /^[A-Za-z0-9]{11}$/);
});

test('generateStableDhis2Uid is deterministic — same key always produces same UID', () => {
  const key = 'IpHINAT79UW||A03MvHHogjR||DiszpKrYNg8||2026-04-07||PMa2VCrupOd';
  const uid1 = generateStableDhis2Uid(key);
  const uid2 = generateStableDhis2Uid(key);
  assert.equal(uid1, uid2);
});

test('generateStableDhis2Uid different keys produce different UIDs', () => {
  const uid1 = generateStableDhis2Uid('key-alpha');
  const uid2 = generateStableDhis2Uid('key-beta');
  assert.notEqual(uid1, uid2);
});

test('generateStableDhis2Uid throws for empty stableKey', () => {
  assert.throws(() => generateStableDhis2Uid(''), { message: /stableKey is required/ });
  assert.throws(() => generateStableDhis2Uid(null), { message: /stableKey is required/ });
});

// --- Re-import idempotency: same key → same UID ---

test('re-importing with the same fields always produces the same event UID', () => {
  const row = {
    program: 'IpHINAT79UW',
    programStage: 'A03MvHHogjR',
    orgUnit: 'DiszpKrYNg8',
    occurredAt: '2026-04-07',
    trackedEntity: 'PMa2VCrupOd',
  };
  const key = buildEventStableKey(row);
  const firstImportUid = generateStableDhis2Uid(key);
  const secondImportUid = generateStableDhis2Uid(key);
  assert.equal(firstImportUid, secondImportUid, 'Identical rows must produce identical UIDs across imports');
});

test('two different events produce different deterministic UIDs', () => {
  const row1 = { program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-04-07', trackedEntity: '' };
  const row2 = { program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-04-08', trackedEntity: '' };
  const uid1 = generateStableDhis2Uid(buildEventStableKey(row1));
  const uid2 = generateStableDhis2Uid(buildEventStableKey(row2));
  assert.notEqual(uid1, uid2);
});

// --- buildRowHash ---

test('buildRowHash returns a 16-char hex string', () => {
  const hash = buildRowHash({ a: 1, b: 'hello' });
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('buildRowHash is consistent regardless of object key order', () => {
  const hashA = buildRowHash({ a: '1', b: '2', c: '3' });
  const hashB = buildRowHash({ c: '3', a: '1', b: '2' });
  assert.equal(hashA, hashB);
});

test('buildRowHash differs when values change', () => {
  const hash1 = buildRowHash({ value: '10' });
  const hash2 = buildRowHash({ value: '99' });
  assert.notEqual(hash1, hash2);
});

test('buildRowHash returns empty string for invalid input', () => {
  assert.equal(buildRowHash(null), '');
  assert.equal(buildRowHash(undefined), '');
});

// --- isEventKeyComplete / isEnrollmentKeyComplete ---

test('isEventKeyComplete returns true when all key fields present', () => {
  assert.ok(isEventKeyComplete({ program: 'P', programStage: 'S', orgUnit: 'O', occurredAt: '2026-04-07' }));
});

test('isEventKeyComplete returns false when any key field is missing', () => {
  assert.equal(isEventKeyComplete({ program: 'P', programStage: 'S', orgUnit: 'O' }), false);
  assert.equal(isEventKeyComplete({ program: '', programStage: 'S', orgUnit: 'O', occurredAt: '2026-04-07' }), false);
  assert.equal(isEventKeyComplete({}), false);
});

test('isEnrollmentKeyComplete returns true when program, orgUnit, trackedEntity present', () => {
  assert.ok(isEnrollmentKeyComplete({ program: 'P', orgUnit: 'O', trackedEntity: 'TE' }));
});

test('isEnrollmentKeyComplete returns false when any required field is missing', () => {
  assert.equal(isEnrollmentKeyComplete({ program: 'P', orgUnit: 'O' }), false);
  assert.equal(isEnrollmentKeyComplete({}), false);
});
