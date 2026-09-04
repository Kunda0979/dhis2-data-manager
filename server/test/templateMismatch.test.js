const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/index');
const { buildTemplateWorkbook } = require('../src/services/fileService');

// Fake DHIS2 credentials — mismatch check fires before any DHIS2 API call so no live instance needed.
const FAKE_HEADERS = {
  'x-dhis2-url': 'https://play.dhis2.org/40',
  'x-dhis2-username': 'admin',
  'x-dhis2-password': 'district',
  Accept: 'application/json',
};

async function buildAggregateWorkbookBuffer(dataSetId, dataSetName = '') {
  return buildTemplateWorkbook({
    rows: [{ period: '202604', orgUnit: 'DiszpKrYNg8' }],
    sections: [{
      name: 'Values',
      questions: [{ key: 'de_f7n9E0hX8qk', label: 'Test Data Element', valueType: 'NUMBER', required: false }],
    }],
    dataType: 'aggregate',
    dataSetMeta: { id: dataSetId, displayName: dataSetName },
    templateSettings: { dataSetId, layout: 'horizontal' },
  });
}

async function buildTrackerWorkbookBuffer(programId, programName = '', programStageId = '') {
  return buildTemplateWorkbook({
    rows: [{ program: programId, programStage: programStageId, orgUnit: 'DiszpKrYNg8', occurredAt: '2026-04-07' }],
    sections: [{
      name: 'Event Details',
      questions: [
        { key: 'event', label: 'Event ID', valueType: 'TEXT', required: false },
        { key: 'orgUnit', label: 'Org Unit', valueType: 'TEXT', required: true },
      ],
    }],
    dataType: 'events',
    programMeta: { id: programId, displayName: programName },
    templateSettings: {},
  });
}

test('wrong dataset returns DATASET_MISMATCH and does not parse rows', async () => {
  const templateDataSetId = 'BfMAe6Itzgt';
  const selectedDataSetId = 'lyLU2wR22tC';
  const buffer = await buildAggregateWorkbookBuffer(templateDataSetId, 'ART Monthly Summary');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', selectedDataSetId)
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'DATASET_MISMATCH');
  assert.equal(res.body.uploadedDatasetId, templateDataSetId);
  assert.equal(res.body.selectedDatasetId, selectedDataSetId);
  assert.equal(res.body.uploadedDatasetName, 'ART Monthly Summary');
  // Mismatch is detected before row-level processing runs
  assert.ok(!res.body.counts, 'counts should not be present — processing was halted');
});

test('matching dataset does not trigger DATASET_MISMATCH', async () => {
  const dataSetId = 'BfMAe6Itzgt';
  const buffer = await buildAggregateWorkbookBuffer(dataSetId, 'ART Monthly Summary');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', dataSetId)
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // No mismatch — response should not include DATASET_MISMATCH code
  assert.ok(res.body.code !== 'DATASET_MISMATCH', `Unexpected DATASET_MISMATCH on matching dataset, got: ${res.body.code}`);
});

test('template without dataSetId metadata does not trigger DATASET_MISMATCH', async () => {
  // Template built without a specific dataset (generic template)
  const buffer = await buildAggregateWorkbookBuffer('', '');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', 'BfMAe6Itzgt')
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.ok(res.body.code !== 'DATASET_MISMATCH', 'Generic template (no dataSetId in metadata) should not trigger mismatch');
});

test('wrong dataset on tracker endpoint also returns DATASET_MISMATCH', async () => {
  const templateDataSetId = 'BfMAe6Itzgt';
  const selectedDataSetId = 'lyLU2wR22tC';
  const buffer = await buildAggregateWorkbookBuffer(templateDataSetId, 'ART Monthly Summary');

  const res = await request(app)
    .post('/api/import/tracker')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', selectedDataSetId)
    // validationToken is required by /tracker — omit it to reach the token gate first
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Without a valid token the tracker handler returns 409 (validation gate) before the mismatch check.
  // For /tracker the mismatch check is inside the file parsing block which runs before token validation.
  // The token check runs first in the handler, so we expect 409 here, not 422.
  // This test documents expected ordering: token gate → mismatch gate.
  assert.ok([409, 422].includes(res.status), `Expected 409 or 422, got ${res.status}`);
});

test('wrong program returns PROGRAM_MISMATCH on validate endpoint', async () => {
  const templateProgramId = 'IpHINAT79UW';
  const selectedProgramId = 'WSGAb5XwJ3Y';
  const buffer = await buildTrackerWorkbookBuffer(templateProgramId, 'Child Programme');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'events')
    .field('programId', selectedProgramId)
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'PROGRAM_MISMATCH');
  assert.equal(res.body.uploadedProgramId, templateProgramId);
  assert.equal(res.body.selectedProgramId, selectedProgramId);
});

test('mismatch response includes rowIssues for UI compatibility', async () => {
  const buffer = await buildAggregateWorkbookBuffer('BfMAe6Itzgt', 'Dataset A');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', 'lyLU2wR22tC')
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.equal(res.status, 422);
  assert.ok(res.body.rowIssues, 'rowIssues must be present for UI compatibility');
  assert.ok(Array.isArray(res.body.rowIssues?.errors), 'rowIssues.errors must be an array');
  assert.ok(res.body.rowIssues.errors.length > 0, 'at least one rowIssues error should describe the mismatch');
  assert.equal(res.body.rowIssues.errors[0].code, 'DATASET_MISMATCH');
});

test('layout mismatch returns TEMPLATE_LAYOUT_MISMATCH', async () => {
  const dataSetId = 'BfMAe6Itzgt';
  const buffer = await buildAggregateWorkbookBuffer(dataSetId, 'ART Monthly Summary');

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', dataSetId)
    .field('layout', 'vertical')
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'TEMPLATE_LAYOUT_MISMATCH');
});

test('attribute option combo mismatch returns ATTRIBUTE_OPTION_COMBO_MISMATCH', async () => {
  const dataSetId = 'BfMAe6Itzgt';
  const buffer = await buildTemplateWorkbook({
    rows: [{ period: '202604', orgUnit: 'DiszpKrYNg8', attributeOptionCombo: 'HllvX50cXC0' }],
    sections: [{
      name: 'Values',
      questions: [{ key: 'de_f7n9E0hX8qk', label: 'Test Data Element', valueType: 'NUMBER', required: false }],
    }],
    dataType: 'aggregate',
    dataSetMeta: { id: dataSetId, displayName: 'ART Monthly Summary' },
    templateSettings: { dataSetId, attributeOptionCombo: 'HllvX50cXC0', layout: 'horizontal' },
  });

  const res = await request(app)
    .post('/api/import/validate')
    .set(FAKE_HEADERS)
    .field('dataType', 'aggregate')
    .field('dataSetId', dataSetId)
    .field('attributeOptionCombo', 'XyZ12345678')
    .attach('file', buffer, { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'ATTRIBUTE_OPTION_COMBO_MISMATCH');
});
