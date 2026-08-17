const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTrackerPayload,
  hasBlockingImportErrors,
  validateValueType,
  isValidUid,
  isValidDate,
  isValidPeriod,
} = require('../src/utils/payloadValidator');

// --- UID helpers ---

test('isValidUid accepts valid DHIS2 UIDs', () => {
  assert.ok(isValidUid('f7n9E0hX8qk'));
  assert.ok(isValidUid('DiszpKrYNg8'));
  assert.ok(isValidUid('HllvX50cXC0'));
});

test('isValidUid rejects invalid UIDs', () => {
  assert.equal(isValidUid(''), false);
  assert.equal(isValidUid('1badStart0x'), false);   // starts with digit
  assert.equal(isValidUid('short'), false);
  assert.equal(isValidUid('toolongUID123'), false);
});

// --- Period validation ---

test('isValidPeriod accepts valid DHIS2 period formats', () => {
  assert.ok(isValidPeriod('202604'));      // monthly
  assert.ok(isValidPeriod('2026Q2'));      // quarterly
  assert.ok(isValidPeriod('2026W15'));     // weekly
  assert.ok(isValidPeriod('2026'));        // yearly
  assert.ok(isValidPeriod('20260407'));    // daily
});

test('isValidPeriod rejects invalid period formats', () => {
  assert.equal(isValidPeriod(''), false);
  assert.equal(isValidPeriod('April 2026'), false);
  assert.equal(isValidPeriod('2026-04'), false);
  assert.equal(isValidPeriod('Q1 2026'), false);
});

// --- validateTrackerPayload: invalid period is now an error ---

test('invalid period format blocks aggregate import (error, not warning)', () => {
  const payload = {
    dataValues: [
      {
        dataElement: 'f7n9E0hX8qk',
        orgUnit: 'DiszpKrYNg8',
        period: 'April-2026', // invalid
        value: '10',
      },
    ],
  };
  const { valid, errors, warnings } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("'period' is not a valid DHIS2 period format")));
  // Must NOT be in warnings
  assert.ok(!warnings.some((w) => w.includes('period')));
});

test('missing period blocks aggregate import', () => {
  const payload = {
    dataValues: [
      {
        dataElement: 'f7n9E0hX8qk',
        orgUnit: 'DiszpKrYNg8',
        value: '10',
      },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("missing required field 'period'")));
});

// --- validateTrackerPayload: missing value blocks import ---

test('missing value blocks aggregate import', () => {
  const payload = {
    dataValues: [
      {
        dataElement: 'f7n9E0hX8qk',
        orgUnit: 'DiszpKrYNg8',
        period: '202604',
        value: '',
      },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("missing required field 'value'")));
});

// --- validateTrackerPayload: invalid UID blocks import ---

test('invalid dataElement UID blocks aggregate import', () => {
  const payload = {
    dataValues: [
      {
        dataElement: 'not-a-uid',
        orgUnit: 'DiszpKrYNg8',
        period: '202604',
        value: '5',
      },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("'dataElement' is not a valid UID")));
});

test('invalid orgUnit UID blocks event import', () => {
  const payload = {
    events: [
      {
        program: 'IpHINAT79UW',
        programStage: 'A03MvHHogjR',
        orgUnit: 'BAD',
        occurredAt: '2026-04-07',
      },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("'orgUnit' is not a valid UID")));
});

// --- Duplicate aggregate data values ---

test('duplicate aggregate values with same value produce a warning, not error', () => {
  const payload = {
    dataValues: [
      { dataElement: 'f7n9E0hX8qk', orgUnit: 'DiszpKrYNg8', period: '202604', categoryOptionCombo: 'HllvX50cXC0', attributeOptionCombo: '', value: '10' },
      { dataElement: 'f7n9E0hX8qk', orgUnit: 'DiszpKrYNg8', period: '202604', categoryOptionCombo: 'HllvX50cXC0', attributeOptionCombo: '', value: '10' },
    ],
  };
  const { warnings, errors } = validateTrackerPayload(payload);
  assert.ok(warnings.some((w) => w.includes('duplicate data value')));
  assert.ok(!errors.some((e) => e.includes('conflicting')));
});

test('conflicting duplicate aggregate values (different value) produce an error', () => {
  const payload = {
    dataValues: [
      { dataElement: 'f7n9E0hX8qk', orgUnit: 'DiszpKrYNg8', period: '202604', categoryOptionCombo: 'HllvX50cXC0', attributeOptionCombo: '', value: '10' },
      { dataElement: 'f7n9E0hX8qk', orgUnit: 'DiszpKrYNg8', period: '202604', categoryOptionCombo: 'HllvX50cXC0', attributeOptionCombo: '', value: '99' },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('conflicting duplicate')));
});

// --- Event status validation ---

test('invalid event status produces an error', () => {
  const payload = {
    events: [
      {
        program: 'IpHINAT79UW',
        programStage: 'A03MvHHogjR',
        orgUnit: 'DiszpKrYNg8',
        status: 'INVALID_STATUS',
      },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("'status' must be one of")));
});

test('valid event statuses pass validation', () => {
  for (const status of ['ACTIVE', 'COMPLETED', 'VISITED', 'SCHEDULE', 'OVERDUE', 'SKIPPED']) {
    const payload = {
      events: [
        {
          program: 'IpHINAT79UW',
          programStage: 'A03MvHHogjR',
          orgUnit: 'DiszpKrYNg8',
          status,
        },
      ],
    };
    const { errors } = validateTrackerPayload(payload);
    const statusErrors = errors.filter((e) => e.includes("'status' must be one of"));
    assert.equal(statusErrors.length, 0, `status '${status}' should be valid`);
  }
});

// --- Duplicate event UID detection ---

test('duplicate non-AUTO event UIDs produce an error', () => {
  const uid = 'vrr6fQh6vQf';
  const payload = {
    events: [
      { event: uid, program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8' },
      { event: uid, program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8' },
    ],
  };
  const { valid, errors } = validateTrackerPayload(payload);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicate event UID')));
});

test('AUTO event IDs do not trigger duplicate detection', () => {
  const payload = {
    events: [
      { event: 'AUTO', program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8' },
      { event: 'AUTO', program: 'IpHINAT79UW', programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8' },
    ],
  };
  const { errors } = validateTrackerPayload(payload);
  assert.ok(!errors.some((e) => e.includes('duplicate event UID')));
});

// --- storedBy warning ---

test('storedBy field produces a warning', () => {
  const payload = {
    dataValues: [
      { dataElement: 'f7n9E0hX8qk', orgUnit: 'DiszpKrYNg8', period: '202604', value: '5', storedBy: 'admin' },
    ],
  };
  const { warnings } = validateTrackerPayload(payload);
  assert.ok(warnings.some((w) => w.includes('storedBy')));
});

// --- hasBlockingImportErrors ---

test('hasBlockingImportErrors returns false for null/undefined', () => {
  assert.equal(hasBlockingImportErrors(null), false);
  assert.equal(hasBlockingImportErrors(undefined), false);
  assert.equal(hasBlockingImportErrors({}), false);
});

test('hasBlockingImportErrors returns true for ERROR status', () => {
  assert.equal(hasBlockingImportErrors({ status: 'ERROR' }), true);
  assert.equal(hasBlockingImportErrors({ status: 'FAILED' }), true);
  assert.equal(hasBlockingImportErrors({ status: 'FAILURE' }), true);
});

test('hasBlockingImportErrors returns true when errors array is non-empty', () => {
  assert.equal(hasBlockingImportErrors({ errors: ['something went wrong'] }), true);
});

test('hasBlockingImportErrors returns true when stats.failed > 0', () => {
  assert.equal(hasBlockingImportErrors({ stats: { failed: 1 } }), true);
});

test('hasBlockingImportErrors returns true when stats.ignored > 0', () => {
  assert.equal(hasBlockingImportErrors({ stats: { ignored: 3 } }), true);
});

test('hasBlockingImportErrors returns true for conflicts array', () => {
  assert.equal(hasBlockingImportErrors({ conflicts: [{ message: 'conflict' }] }), true);
});

test('hasBlockingImportErrors returns true when hasBlockingErrors flag is set', () => {
  assert.equal(hasBlockingImportErrors({ hasBlockingErrors: true }), true);
});

test('hasBlockingImportErrors returns false for clean import report', () => {
  assert.equal(hasBlockingImportErrors({
    status: 'SUCCESS',
    stats: { created: 5, updated: 0, deleted: 0, ignored: 0, failed: 0 },
    errors: [],
    conflicts: [],
    hasBlockingErrors: false,
  }), false);
});

// --- validateValueType ---

test('validateValueType returns null for valid values', () => {
  assert.equal(validateValueType('42', 'INTEGER'), null);
  assert.equal(validateValueType('5', 'INTEGER_POSITIVE'), null);
  assert.equal(validateValueType('0', 'INTEGER_ZERO_OR_POSITIVE'), null);
  assert.equal(validateValueType('-3', 'INTEGER_NEGATIVE'), null);
  assert.equal(validateValueType('12.5', 'NUMBER'), null);
  assert.equal(validateValueType('75', 'PERCENTAGE'), null);
  assert.equal(validateValueType('true', 'BOOLEAN'), null);
  assert.equal(validateValueType('false', 'BOOLEAN'), null);
  assert.equal(validateValueType('true', 'TRUE_ONLY'), null);
  assert.equal(validateValueType('2026-04-07', 'DATE'), null);
  assert.equal(validateValueType('2026-04-07T09:00', 'DATETIME'), null);
});

test('validateValueType returns error string for invalid values', () => {
  assert.ok(validateValueType('12.5', 'INTEGER'));
  assert.ok(validateValueType('-1', 'INTEGER_POSITIVE'));
  assert.ok(validateValueType('-5', 'INTEGER_ZERO_OR_POSITIVE'));
  assert.ok(validateValueType('3', 'INTEGER_NEGATIVE'));
  assert.ok(validateValueType('abc', 'NUMBER'));
  assert.ok(validateValueType('maybe', 'BOOLEAN'));
  assert.ok(validateValueType('false', 'TRUE_ONLY'));
  assert.ok(validateValueType('07/04/2026', 'DATE'));
  assert.ok(validateValueType('not-a-date', 'DATETIME'));
});

test('validateValueType returns null for empty values (blanks are handled separately)', () => {
  assert.equal(validateValueType('', 'INTEGER'), null);
  assert.equal(validateValueType(null, 'INTEGER'), null);
});

test('validateValueType returns null for unknown/text types', () => {
  assert.equal(validateValueType('anything', 'TEXT'), null);
  assert.equal(validateValueType('anything', 'UNKNOWN'), null);
});
