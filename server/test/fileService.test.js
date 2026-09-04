const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const {
  buildTemplateWorkbook,
  excelToJson,
} = require('../src/services/fileService');

const TEMPLATE_PRIMARY_ARGB = 'FFFFBB22';
const TEMPLATE_SECONDARY_ARGB = 'FFFFEBBD';
const TEMPLATE_CELL_ARGB = 'FFD9D9D9';

function getMetaValue(workbook, key) {
  const wsMeta = workbook.getWorksheet('Metadata Snapshot');
  if (!wsMeta) return '';
  for (let rowNumber = 2; rowNumber <= wsMeta.rowCount; rowNumber++) {
    if (String(wsMeta.getCell(rowNumber, 1).value || '').trim() === key) {
      return String(wsMeta.getCell(rowNumber, 2).value || '').trim();
    }
  }
  return '';
}

function buildSampleSections() {
  return [
    {
      name: 'Main',
      questions: [
        { key: 'orgUnit', label: 'Org Unit', valueType: 'TEXT', required: true },
        { key: 'status', label: 'Status', valueType: 'TEXT', required: false },
      ],
    },
  ];
}

test('excelToJson ignores template helper and example rows for horizontal Data Entry templates', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const parsedRows = await excelToJson(buffer);
  assert.deepEqual(parsedRows, []);
});

test('excelToJson parses only user-entered rows from horizontal Data Entry templates', async () => {
  const sourceBuffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceBuffer);
  const ws = workbook.getWorksheet('Data Entry');
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  ws.getCell(dataStartRow, 1).value = 'Org Unit Alpha';
  ws.getCell(dataStartRow, 2).value = 'ACTIVE';

  const updatedBuffer = await workbook.xlsx.writeBuffer();
  const parsedRows = await excelToJson(updatedBuffer);

  assert.equal(parsedRows.length, 1);
  assert.equal(parsedRows[0].orgUnit, 'Org Unit Alpha');
  assert.equal(parsedRows[0].status, 'ACTIVE');
});

test('excelToJson ignores empty vertical Data Entry templates', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'vertical' },
  });

  const parsedRows = await excelToJson(buffer);
  assert.deepEqual(parsedRows, []);
});

test('excelToJson parses user-entered values from vertical Data Entry templates', async () => {
  const sourceBuffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'vertical' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceBuffer);
  const ws = workbook.getWorksheet('Data Entry');
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '5');

  for (let rowNumber = dataStartRow; rowNumber <= ws.rowCount; rowNumber++) {
    const keyRaw = String(ws.getCell(rowNumber, 3).value || '').trim();
    const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
    if (key === 'orgUnit') ws.getCell(rowNumber, 5).value = 'Org Unit Beta';
    if (key === 'status') ws.getCell(rowNumber, 5).value = 'ACTIVE';
  }

  const updatedBuffer = await workbook.xlsx.writeBuffer();
  const parsedRows = await excelToJson(updatedBuffer);

  assert.equal(parsedRows.length, 1);
  assert.equal(parsedRows[0].orgUnit, 'Org Unit Beta');
  assert.equal(parsedRows[0].status, 'ACTIVE');
});

test('excelToJson resolves formula result cells', async () => {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Data');
  ws.addRow(['orgUnit', 'status']);
  ws.addRow(['Org Unit Gamma', '']);
  ws.getCell('B2').value = { formula: 'UPPER("active")', result: 'ACTIVE' };

  const buffer = await workbook.xlsx.writeBuffer();
  const parsedRows = await excelToJson(buffer);

  assert.equal(parsedRows.length, 1);
  assert.equal(parsedRows[0].orgUnit, 'Org Unit Gamma');
  assert.equal(parsedRows[0].status, 'ACTIVE');
});

test('excelToJson concatenates rich text cells', async () => {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Data');
  ws.addRow(['orgUnit', 'status']);
  ws.addRow([{ richText: [{ text: 'Org ' }, { text: 'Unit Delta' }] }, 'ACTIVE']);

  const buffer = await workbook.xlsx.writeBuffer();
  const parsedRows = await excelToJson(buffer);

  assert.equal(parsedRows.length, 1);
  assert.equal(parsedRows[0].orgUnit, 'Org Unit Delta');
  assert.equal(parsedRows[0].status, 'ACTIVE');
});

test('buildTemplateWorkbook preserves explicit Data Entry styling after row banding', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const headerRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  // Header row uses explicit semantic color and should not be overwritten by neutral row banding.
  assert.equal(ws.getCell(headerRow, 1).fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  // First user row keeps neutral editable styling (alternating white/gray banding).
  assert.ok(['FFFFFFFF', TEMPLATE_CELL_ARGB].includes(ws.getCell(dataStartRow, 1).fill?.fgColor?.argb));
});

test('buildTemplateWorkbook applies aggregate theme colors in Data Entry', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'aggregate',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const headerRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = headerRow + 1;

  assert.equal(ws.getCell(headerRow, 1).fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  assert.equal(ws.getCell(valueTypeRow, 1).fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
});

test('buildTemplateWorkbook applies tracker theme colors in Data Entry', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'tracker',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const headerRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = headerRow + 1;

  assert.equal(ws.getCell(headerRow, 1).fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  assert.equal(ws.getCell(valueTypeRow, 1).fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
});

test('buildTemplateWorkbook places cleaned section headings directly above questions', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: [{
      name: 'Data Entry - Data Elements',
      questions: [
        { key: 'orgUnit', label: 'Org Unit', valueType: 'TEXT', required: true },
      ],
    }],
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const sectionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5') - 1;
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');

  assert.equal(ws.getCell(sectionRow, 1).value, 'Data Elements');
  assert.equal(ws.getCell(questionRow, 1).value, 'Org Unit');
});

test('buildTemplateWorkbook keeps a larger question row and removes hidden key helper row in horizontal layout', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = questionRow + 1;

  assert.ok((ws.getRow(questionRow).height || 0) >= 54);
  assert.equal(ws.getRow(valueTypeRow).hidden, false);
});

test('buildTemplateWorkbook includes a DHIS value type row under question headers', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const valueTypeRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5') + 1;

  assert.equal(ws.getCell(valueTypeRow, 1).value, 'Text');
  assert.equal(ws.getCell(valueTypeRow, 2).value, 'Dropdown (click cell)');
});

test('aggregate Start Here removes organisation unit row and includes Submission Decision dropdown', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ period: '202604', orgUnit: 'ou1', de_abc: '' }],
    sections: [{
      name: 'Aggregate Data Entry',
      questions: [
        { key: 'period', label: 'Period', valueType: 'TEXT', required: true, options: ['202604'] },
        { key: 'orgUnit', label: 'Organisation Unit', valueType: 'TEXT', required: true, options: ['Central Hospital'] },
        { key: 'de_abc', label: 'ANC visits', valueType: 'INTEGER', required: false },
      ],
    }],
    dataType: 'aggregate',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const wsStart = workbook.getWorksheet('Start Here');

  const stepValues = [];
  for (let rowNumber = 2; rowNumber <= wsStart.rowCount; rowNumber++) {
    stepValues.push(String(wsStart.getCell(rowNumber, 1).value || '').trim());
  }

  assert.equal(stepValues.some((value) => value === 'Organisation Unit:'), false);

  let submissionDecisionRow = 0;
  for (let rowNumber = 2; rowNumber <= wsStart.rowCount; rowNumber++) {
    if (String(wsStart.getCell(rowNumber, 1).value || '').trim() === 'Submission Decision:') {
      submissionDecisionRow = rowNumber;
      break;
    }
  }

  assert.ok(submissionDecisionRow > 0);
  const decisionValidation = wsStart.getCell(submissionDecisionRow, 2).dataValidation;
  assert.equal(decisionValidation?.type, 'list');
  assert.equal(decisionValidation?.formulae?.[0], '"Draft,Submit and Mark Complete"');

  const wsCompletion = workbook.getWorksheet('Completion');
  assert.equal(wsCompletion, undefined);
});

test('buildTemplateWorkbook hides Validation and Metadata Snapshot sheets', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const wsValidation = workbook.getWorksheet('Validation');
  const wsMetadata = workbook.getWorksheet('Metadata Snapshot');

  assert.equal(wsValidation?.state, 'hidden');
  assert.equal(wsMetadata?.state, 'veryHidden');
});

test('buildTemplateWorkbook stores data element descriptions as visible cell notes in headers', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: [{
      name: 'Main',
      questions: [
        { key: 'orgUnit', label: 'Org Unit', valueType: 'TEXT', required: true, description: 'Pick the reporting facility.' },
      ],
    }],
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const wsData = workbook.getWorksheet('Data Entry');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');

  assert.equal(wsData.getCell(questionRow, 1).note, 'Pick the reporting facility.');
});

test('buildTemplateWorkbook applies events theme colors in Start Here', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Start Here');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  assert.equal(ws.getCell('A2').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
  assert.equal(ws.getCell('A3').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
});

test('buildTemplateWorkbook applies aggregate theme colors in Start Here', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'aggregate',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Start Here');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  assert.equal(ws.getCell('A2').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
  assert.equal(ws.getCell('A3').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
});

test('buildTemplateWorkbook applies tracker theme colors in Start Here', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'tracker',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Start Here');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
  assert.equal(ws.getCell('A2').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
  assert.equal(ws.getCell('A3').fill?.fgColor?.argb, TEMPLATE_CELL_ARGB);
});

test('buildTemplateWorkbook applies events theme colors in Validation sheet', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'events',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Validation');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
});

test('buildTemplateWorkbook applies aggregate theme colors in Validation sheet', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'aggregate',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Validation');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
});

test('buildTemplateWorkbook applies tracker theme colors in Validation sheet', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ orgUnit: '', status: '' }],
    sections: buildSampleSections(),
    dataType: 'tracker',
    templateSettings: { layout: 'horizontal' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Validation');

  assert.equal(ws.getCell('A1').fill?.fgColor?.argb, TEMPLATE_PRIMARY_ARGB);
});

// ── Context cell (locked pre-fill) tests ──────────────────────────────────────

const CONTEXT_ARGB = 'FFD6E8FF';

function buildAggSections() {
  return [
    {
      name: 'Context',
      questions: [
        { key: 'period', label: 'Period', valueType: 'TEXT', required: true },
        { key: 'orgUnit', label: 'Organisation Unit', valueType: 'TEXT', required: true },
      ],
    },
    {
      name: 'Values',
      questions: [
        { key: 'de_testDE12a345', label: 'Test DE', valueType: 'NUMBER', required: false },
      ],
    },
  ];
}

test('single org unit is pre-filled and locked in horizontal aggregate template', async () => {
  const orgUnitName = 'Sierra Leone';
  const buffer = await buildTemplateWorkbook({
    rows: [{ period: '202601', orgUnit: orgUnitName }],
    sections: buildAggSections(),
    dataType: 'aggregate',
    templateSettings: {
      orgUnitNames: [orgUnitName],
      orgUnitIds: ['DiszpKrYNg8'],
      layout: 'horizontal',
    },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  assert.ok(ws, 'Data Entry sheet must exist');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = questionRow + 1;
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  // Find org unit column by scanning question row headers
  let orgUnitCol = null;
  ws.getRow(questionRow).eachCell((cell, c) => {
    if (String(cell.value || '').toLowerCase().includes('organisation')) orgUnitCol = c;
  });
  assert.ok(orgUnitCol, 'Organisation Unit column must be present in header row');

  // First user data row should be pre-filled and locked
  const dataCell = ws.getCell(dataStartRow, orgUnitCol);
  assert.equal(String(dataCell.value || ''), orgUnitName, 'Cell value should equal the single org unit name');
  // ExcelJS only writes explicit locked:false; absence means locked (default when sheet is protected)
  assert.ok(dataCell.protection?.locked !== false, 'Context cell must not be explicitly unlocked');
  assert.equal(dataCell.fill?.fgColor?.argb, CONTEXT_ARGB, 'Context cell should have the context fill colour');
});

test('single period is pre-filled and locked in horizontal aggregate template', async () => {
  const period = '202601';
  const buffer = await buildTemplateWorkbook({
    rows: [{ period, orgUnit: 'Ngelehun CHC' }],
    sections: buildAggSections(),
    dataType: 'aggregate',
    templateSettings: {
      orgUnitNames: ['Ngelehun CHC', 'Bo District'], // multiple — not context
      period,
      layout: 'horizontal',
    },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  assert.ok(ws);
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = questionRow + 1;
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  let periodCol = null;
  ws.getRow(questionRow).eachCell((cell, c) => {
    if (String(cell.value || '').toLowerCase() === 'period') periodCol = c;
  });
  assert.ok(periodCol, 'Period column must be present');

  const typeCell = ws.getCell(valueTypeRow, periodCol);
  assert.ok(String(typeCell.value || '').toLowerCase().includes('pre-filled'), `Row 3 should indicate pre-filled, got: "${typeCell.value}"`);

  const dataCell = ws.getCell(dataStartRow, periodCol);
  assert.equal(String(dataCell.value || ''), period);
  assert.ok(dataCell.protection?.locked !== false, 'Context cell must not be explicitly unlocked');
});

test('specific org-unit mode keeps a single locked org-unit row even if extra names are supplied', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ period: '202601', orgUnit: 'Bo District' }],
    sections: buildAggSections(),
    dataType: 'aggregate',
    templateSettings: {
      orgUnitScope: 'selected',
      orgUnitNames: ['Bo District', 'Bombali District'],
      layout: 'horizontal',
    },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const valueTypeRow = questionRow + 1;
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  let orgUnitCol = null;
  ws.getRow(questionRow).eachCell((cell, c) => {
    if (String(cell.value || '').toLowerCase().includes('organisation')) orgUnitCol = c;
  });
  assert.ok(orgUnitCol, 'Organisation Unit column must be present');

  const typeCell = ws.getCell(valueTypeRow, orgUnitCol);
  assert.ok(
    !String(typeCell.value || '').toLowerCase().includes('dropdown'),
    `Type row should not advertise dropdown for multiple selected org units, got: "${typeCell.value}"`,
  );

  const firstDataCell = ws.getCell(dataStartRow, orgUnitCol);
  const secondDataCell = ws.getCell(dataStartRow + 1, orgUnitCol);
  assert.equal(String(firstDataCell.value || ''), 'Bo District');
  assert.equal(String(secondDataCell.value || ''), '', 'Only one specific org-unit entry row should be generated');
  assert.ok(firstDataCell.protection?.locked !== false, 'Org unit should be locked for specific-scope templates');
});

test('all-accessible org-unit mode keeps org-unit dropdown editable with multiple blank rows', async () => {
  const buffer = await buildTemplateWorkbook({
    rows: [{ period: '202601', orgUnit: '' }],
    sections: buildAggSections(),
    dataType: 'aggregate',
    templateSettings: {
      orgUnitScope: 'all',
      orgUnitNames: ['Bo District', 'Bombali District', 'Kenema District'],
      layout: 'horizontal',
    },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  let orgUnitCol = null;
  ws.getRow(questionRow).eachCell((cell, c) => {
    if (String(cell.value || '').toLowerCase().includes('organisation')) orgUnitCol = c;
  });
  assert.ok(orgUnitCol, 'Organisation Unit column must be present');

  const rowOneCell = ws.getCell(dataStartRow, orgUnitCol);
  const rowTwoCell = ws.getCell(dataStartRow + 1, orgUnitCol);
  assert.equal(String(rowOneCell.value || ''), '');
  assert.equal(String(rowTwoCell.value || ''), '');
  assert.equal(rowOneCell.dataValidation?.type, 'list');
  assert.equal(rowTwoCell.dataValidation?.type, 'list');
  assert.ok(rowOneCell.protection?.locked !== true, 'Org-unit dropdown should be editable in all-accessible mode');
});

test('pre-filled context values are read back correctly by excelToJson when data is entered', async () => {
  const orgUnitName = 'Sierra Leone';
  const period = '202601';

  const buffer = await buildTemplateWorkbook({
    rows: [{ period, orgUnit: orgUnitName }],
    sections: buildAggSections(),
    dataType: 'aggregate',
    templateSettings: {
      orgUnitNames: [orgUnitName],
      orgUnitIds: ['DiszpKrYNg8'],
      period,
      layout: 'horizontal',
    },
  });

  // Simulate user entering a data element value
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.getWorksheet('Data Entry');
  const questionRow = Number(getMetaValue(workbook, 'dataHeaderRow') || '5');
  const dataStartRow = Number(getMetaValue(workbook, 'dataStartRow') || '7');

  // Find the de_testDE12a345 column in question header row
  let deCol = null;
  ws.getRow(questionRow).eachCell((cell, c) => {
    if (String(cell.value || '').includes('Test DE')) deCol = c;
  });
  assert.ok(deCol, 'Data element column must be present');

  // Write a value in first user row
  ws.getCell(dataStartRow, deCol).value = '42';

  const updatedBuffer = await workbook.xlsx.writeBuffer();
  const rows = await excelToJson(updatedBuffer);

  assert.ok(rows.length >= 1, 'Should have at least one row returned');
  const row = rows[0];
  assert.equal(String(row.orgUnit || ''), orgUnitName, 'orgUnit should be the pre-filled locked value');
  assert.equal(String(row.period || ''), period, 'period should be the pre-filled locked value');
});
