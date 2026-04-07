const express = require('express');
const path = require('path');
const { requireDhis2Credentials } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validateImportRequest } = require('../middleware/validate');
const { importLimiter } = require('../middleware/rateLimiter');
const { importTrackerData, getJobStatus } = require('../services/importService');
const { csvToJson, excelToJson, jsonToCsv, buildTemplateWorkbook } = require('../services/fileService');
const { buildTrackerPayload, convertToTracker } = require('../utils/payloadBuilder');
const { validateTrackerPayload } = require('../utils/payloadValidator');
const { addHistoryEntry } = require('../services/historyService');
const { buildIssueReport } = require('../utils/rowValidation');
const { createDhis2Client } = require('../services/dhis2Client');

const router = express.Router();

router.use(requireDhis2Credentials);

const ALLOWED_TEMPLATE_TYPES = new Set(['events', 'enrollments', 'trackedEntities']);
const ALLOWED_TEMPLATE_FORMATS = new Set(['json', 'csv', 'xlsx']);
const ALLOWED_TEMPLATE_VARIANTS = new Set(['empty', 'prepopulated']);
const ALLOWED_TEMPLATE_LAYOUTS = new Set(['horizontal', 'vertical']);
const DHIS2_UID_PATTERN = /^[A-Za-z0-9]{11}$/;

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sanitizeHeaderName(name) {
  return String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function buildTemplateFieldKey(prefix, id, displayName) {
  const safeName = sanitizeHeaderName(displayName);
  return safeName ? `${prefix}_${id}__${safeName}` : `${prefix}_${id}`;
}

function makeQuestion(key, label, valueType = 'TEXT', required = false) {
  return { key, label, valueType, required: Boolean(required), options: [] };
}

function extractOptionValues(entity) {
  const opts = entity?.optionSet?.options || [];
  const seen = new Set();
  const values = [];
  for (const opt of opts) {
    const value = String(opt?.displayName || opt?.name || opt?.code || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function buildProgramTemplateLayout(programMeta, dataType, programStageId) {
  const sections = [];

  if (dataType === 'trackedEntities') {
    const attrs = uniqueById([
      ...((programMeta.programTrackedEntityAttributes || []).map((item) => item.trackedEntityAttribute).filter(Boolean)),
      ...((programMeta.trackedEntityType?.trackedEntityTypeAttributes || []).map((item) => item.trackedEntityAttribute).filter(Boolean)),
    ]);

    sections.push({
      id: 'te-core',
      name: 'Tracked Entity Details',
      questions: [
        makeQuestion('trackedEntity', 'Tracked Entity ID', 'TEXT', false),
        makeQuestion('trackedEntityType', 'Tracked Entity Type', 'TEXT', true),
        makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
      ],
    });

    sections.push({
      id: 'te-attributes',
      name: 'Attributes',
      questions: attrs.map((attr) => ({
        ...makeQuestion(buildTemplateFieldKey('attr', attr.id, attr.displayName), attr.displayName || attr.id, attr.valueType || 'TEXT', false),
        options: extractOptionValues(attr),
      })),
    });

    return sections;
  }

  if (dataType === 'enrollments') {
    return [{
      id: 'enrollment-core',
      name: 'Enrollment Details',
      questions: [
        makeQuestion('enrollment', 'Enrollment ID', 'TEXT', false),
        makeQuestion('trackedEntity', 'Tracked Entity ID', 'TEXT', false),
        makeQuestion('program', 'Program', 'TEXT', true),
        makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
        makeQuestion('enrolledAt', 'Enrollment Date', 'DATE', true),
        makeQuestion('occurredAt', 'Incident Date', 'DATE', false),
        makeQuestion('status', 'Status', 'TEXT', false),
      ],
    }];
  }

  const sortedStages = [...(programMeta.programStages || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const selectedStage = sortedStages.find((stage) => stage.id === programStageId) || sortedStages[0] || null;

  if (!selectedStage) {
    return [{
      id: 'event-core',
      name: 'Event Details',
      questions: [
        makeQuestion('event', 'Event ID', 'TEXT', false),
        makeQuestion('status', 'Status', 'TEXT', false),
        makeQuestion('program', 'Program', 'TEXT', true),
        makeQuestion('programStage', 'Program Stage', 'TEXT', true),
        makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
        makeQuestion('occurredAt', 'Event Date', 'DATE', true),
      ],
    }];
  }

  const coreQuestions = [
    makeQuestion('event', 'Event ID', 'TEXT', false),
    makeQuestion('status', 'Status', 'TEXT', false),
    makeQuestion('program', 'Program', 'TEXT', true),
    makeQuestion('programStage', 'Program Stage', 'TEXT', true),
    makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
    makeQuestion('occurredAt', 'Event Date', 'DATE', true),
  ];

  if (programMeta.programType === 'WITH_REGISTRATION') {
    coreQuestions.push(makeQuestion('trackedEntity', 'Tracked Entity ID', 'TEXT', false));
    coreQuestions.push(makeQuestion('enrollment', 'Enrollment ID', 'TEXT', false));
  }

  sections.push({ id: 'event-core', name: 'Event Details', questions: coreQuestions });

  const sectionElements = (selectedStage.programStageSections || []).map((section) => {
    const questions = (section.dataElements || []).map((de) => ({
      ...makeQuestion(buildTemplateFieldKey('de', de.id, de.formName || de.displayName), de.formName || de.displayName || de.id, de.valueType || 'TEXT', false),
      options: extractOptionValues(de),
    }));
    return {
      id: section.id,
      name: section.displayName || 'Section',
      questions,
    };
  });

  const stageElements = (selectedStage.programStageDataElements || [])
    .map((item) => ({
      dataElement: item.dataElement,
      compulsory: item.compulsory,
      sortOrder: item.sortOrder,
    }))
    .filter((item) => item.dataElement);

  if (sectionElements.length > 0) {
    sections.push(...sectionElements);
    return sections;
  }

  sections.push({
    id: selectedStage.id,
    name: selectedStage.displayName || 'Program Stage Questions',
    questions: [...stageElements]
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) =>
        ({
          ...makeQuestion(
          buildTemplateFieldKey('de', item.dataElement.id, item.dataElement.formName || item.dataElement.displayName),
          item.dataElement.formName || item.dataElement.displayName || item.dataElement.id,
          item.dataElement.valueType || 'TEXT',
          item.compulsory,
          ),
          options: extractOptionValues(item.dataElement),
        })
      ),
  });

  return sections;
}

function buildGenericTemplateLayout(sampleRow) {
  return [{
    id: 'generic',
    name: 'Template Fields',
    questions: Object.keys(sampleRow || {}).map((key) => makeQuestion(key, key, 'TEXT', false)),
  }];
}

function buildGenericTemplateRows(dataType, variant) {
  const empty = variant === 'empty';

  if (dataType === 'events') {
    return [{
      event: empty ? '' : 'vrr6fQh6vQf',
      status: empty ? '' : 'ACTIVE',
      program: empty ? '' : 'IpHINAT79UW',
      programStage: empty ? '' : 'A03MvHHogjR',
      orgUnit: empty ? '' : 'DiszpKrYNg8',
      occurredAt: empty ? '' : '2026-03-31',
      trackedEntity: empty ? '' : 'PMa2VCrupOd',
      enrollment: empty ? '' : 'AaB3zKZ2CXY',
      de_a3kGcGDCuk6: empty ? '' : '37.5',
      de_B4Q2mFh3xWk: empty ? '' : 'No symptoms',
    }];
  }

  if (dataType === 'enrollments') {
    return [{
      enrollment: empty ? '' : 'AaB3zKZ2CXY',
      trackedEntity: empty ? '' : 'PMa2VCrupOd',
      program: empty ? '' : 'IpHINAT79UW',
      orgUnit: empty ? '' : 'DiszpKrYNg8',
      enrolledAt: empty ? '' : '2026-03-30',
      occurredAt: empty ? '' : '2026-03-30',
      status: empty ? '' : 'ACTIVE',
    }];
  }

  return [{
    trackedEntity: empty ? '' : 'PMa2VCrupOd',
    trackedEntityType: empty ? '' : 'nEenWmSyUEp',
    orgUnit: empty ? '' : 'DiszpKrYNg8',
    attr_w75KJ2mc4zz: empty ? '' : 'John',
    attr_zDhUuAYrxNC: empty ? '' : 'Doe',
    attr_AxqcoiKURhU: empty ? '' : '1988-04-12',
  }];
}

function buildProgramTemplateRows(programMeta, dataType, variant, programStageId) {
  const empty = variant === 'empty';
  const row = {};
  const sortedStages = [...(programMeta.programStages || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const selectedStage = dataType === 'events'
    ? sortedStages.find((stage) => stage.id === programStageId) || sortedStages[0] || null
    : null;
  const programAttributes = uniqueById([
    ...((programMeta.programTrackedEntityAttributes || []).map((item) => item.trackedEntityAttribute).filter(Boolean)),
    ...((programMeta.trackedEntityType?.trackedEntityTypeAttributes || []).map((item) => item.trackedEntityAttribute).filter(Boolean)),
  ]);

  if (dataType === 'trackedEntities') {
    row.trackedEntity = empty ? '' : 'PMa2VCrupOd';
    row.trackedEntityType = empty ? '' : programMeta.trackedEntityType?.id || '';
    row.orgUnit = empty ? '' : 'DiszpKrYNg8';
    for (const attr of programAttributes) {
      row[buildTemplateFieldKey('attr', attr.id, attr.displayName)] = empty ? '' : sampleValueForType(attr.valueType, attr.displayName);
    }
    return [row];
  }

  if (dataType === 'enrollments') {
    row.enrollment = empty ? '' : 'AaB3zKZ2CXY';
    row.trackedEntity = empty ? '' : 'PMa2VCrupOd';
    row.program = programMeta.id;
    row.orgUnit = empty ? '' : 'DiszpKrYNg8';
    row.enrolledAt = empty ? '' : '2026-03-30';
    row.occurredAt = empty ? '' : '2026-03-30';
    row.status = empty ? '' : 'ACTIVE';
    return [row];
  }

  row.event = empty ? '' : 'vrr6fQh6vQf';
  row.status = empty ? '' : 'ACTIVE';
  row.program = programMeta.id;
  row.programStage = selectedStage?.id || '';
  row.orgUnit = empty ? '' : 'DiszpKrYNg8';
  row.occurredAt = empty ? '' : '2026-03-31';
  if (programMeta.programType === 'WITH_REGISTRATION') {
    row.trackedEntity = empty ? '' : 'PMa2VCrupOd';
    row.enrollment = empty ? '' : 'AaB3zKZ2CXY';
  }

  const stageElements = (selectedStage?.programStageDataElements || [])
    .map((item) => item.dataElement)
    .filter(Boolean);

  for (const dataElement of stageElements) {
    row[buildTemplateFieldKey('de', dataElement.id, dataElement.displayName)] = empty ? '' : sampleValueForType(dataElement.valueType, dataElement.displayName);
  }

  return [row];
}

function sampleValueForType(valueType, displayName) {
  const label = (displayName || '').toLowerCase();
  switch (valueType) {
    case 'BOOLEAN':
    case 'TRUE_ONLY':
      return 'true';
    case 'DATE':
      return '2026-03-31';
    case 'DATETIME':
      return '2026-03-31T09:00:00';
    case 'INTEGER':
    case 'INTEGER_POSITIVE':
    case 'INTEGER_NEGATIVE':
    case 'INTEGER_ZERO_OR_POSITIVE':
      return '1';
    case 'NUMBER':
    case 'PERCENTAGE':
    case 'UNIT_INTERVAL':
      return '12.5';
    case 'EMAIL':
      return 'user@example.org';
    case 'PHONE_NUMBER':
      return '+260977000000';
    case 'AGE':
      return '34';
    case 'TEXT':
    case 'LONG_TEXT':
    case 'LETTER':
      if (label.includes('first')) return 'John';
      if (label.includes('last') || label.includes('surname')) return 'Doe';
      if (label.includes('name')) return 'Sample value';
      return 'Sample value';
    default:
      return 'Sample value';
  }
}

async function fetchProgramTemplateMetadata(req, programId) {
  const client = createDhis2Client(req);
  const response = await client.get(`/api/programs/${programId}`, {
    params: {
      fields: [
        'id',
        'displayName',
        'programType',
        'trackedEntityType[id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType,optionSet[id,options[id,code,name,displayName]]]]]',
        'programTrackedEntityAttributes[trackedEntityAttribute[id,displayName,valueType,optionSet[id,options[id,code,name,displayName]]],mandatory]',
        'programStages[id,displayName,sortOrder,programStageDataElements[dataElement[id,displayName,formName,valueType,optionSet[id,options[id,code,name,displayName]]],sortOrder,compulsory],programStageSections[id,displayName,sortOrder,dataElements[id,displayName,formName,valueType,optionSet[id,options[id,code,name,displayName]]]]]',
        'programRuleVariables[id,displayName,name,programRuleVariableSourceType,dataElement[id,displayName],trackedEntityAttribute[id,displayName],programStage[id,displayName]]',
        'programRules[id,displayName,condition,programRuleActions[id,programRuleActionType,data,content,location,template],programRuleRuleVariables[programRuleVariable[id,displayName,name]]]',
      ].join(','),
    },
  });
  return response.data;
}

function validateTemplateSelection(programMeta, dataType, programStageId) {
  if (programMeta.programType === 'WITHOUT_REGISTRATION' && dataType !== 'events') {
    const err = new Error('Selected program supports only event templates');
    err.status = 400;
    throw err;
  }

  if (dataType === 'trackedEntities' && !programMeta.trackedEntityType?.id) {
    const err = new Error('Selected program does not expose a tracked entity type for tracked entity templates');
    err.status = 400;
    throw err;
  }

  if (dataType !== 'events') return;

  const stages = programMeta.programStages || [];
  if (stages.length === 0) {
    const err = new Error('Selected program has no stages for event templates');
    err.status = 400;
    throw err;
  }

  if (programStageId && !stages.some((stage) => stage.id === programStageId)) {
    const err = new Error('Selected program stage does not belong to the selected program');
    err.status = 400;
    throw err;
  }

  if (!programStageId && stages.length > 1) {
    const err = new Error('Please select a program stage for event template download');
    err.status = 400;
    throw err;
  }
}

async function resolveTemplateBundle(req, { dataType, variant, programId, programStageId }) {
  if (!programId) {
    const rows = buildGenericTemplateRows(dataType, variant);
    return {
      rows,
      sections: buildGenericTemplateLayout(rows[0] || {}),
      programMeta: null,
    };
  }

  const programMeta = await fetchProgramTemplateMetadata(req, programId);
  validateTemplateSelection(programMeta, dataType, programStageId);
  return {
    rows: buildProgramTemplateRows(programMeta, dataType, variant, programStageId),
    sections: buildProgramTemplateLayout(programMeta, dataType, programStageId),
    programMeta,
  };
}

async function sendTemplateFile(res, { rows, sections, programMeta, dataType, variant, format, settings }) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileBase = `template-${dataType}-${variant}-${timestamp}`;

  if (format === 'csv') {
    const csv = jsonToCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    return res.send(csv);
  }

  if (format === 'xlsx') {
    const buffer = await buildTemplateWorkbook({
      rows,
      sections,
      dataType,
      programMeta,
      templateSettings: settings,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(buffer);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
  return res.send(JSON.stringify(rows, null, 2));
}

async function fetchOrgUnitEntries(req, orgUnitIds) {
  if (!Array.isArray(orgUnitIds) || orgUnitIds.length === 0) return [];
  const client = createDhis2Client(req);

  const entries = await Promise.all(orgUnitIds.map(async (id) => {
    try {
      const response = await client.get(`/api/organisationUnits/${id}`, {
        params: { fields: 'id,displayName' },
      });
      return {
        id: response.data?.id || id,
        name: response.data?.displayName || id,
      };
    } catch {
      return { id, name: id };
    }
  }));

  return entries;
}

async function resolveOrgUnitNamesToIds(req, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const names = [...new Set(rows
    .map((row) => String(row?.orgUnit || '').trim())
    .filter((value) => value && !DHIS2_UID_PATTERN.test(value)))];

  if (names.length === 0) return rows;

  const client = createDhis2Client(req);
  const mapping = new Map();

  await Promise.all(names.map(async (name) => {
    try {
      const response = await client.get('/api/organisationUnits', {
        params: {
          fields: 'id,displayName',
          filter: `displayName:eq:${name}`,
          paging: false,
        },
      });
      const resolved = response.data?.organisationUnits?.[0];
      if (resolved?.id) {
        mapping.set(name, resolved.id);
      }
    } catch {
      // Keep original value if resolution fails; downstream validation will flag it.
    }
  }));

  return rows.map((row) => {
    const source = String(row?.orgUnit || '').trim();
    if (!source || DHIS2_UID_PATTERN.test(source)) return row;
    const mapped = mapping.get(source);
    if (!mapped) return row;
    return { ...row, orgUnit: mapped };
  });
}

function parseMapping(mappingRaw) {
  if (!mappingRaw) return {};
  try {
    const parsed = JSON.parse(mappingRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Mapping must be a JSON object');
    }
    return parsed;
  } catch {
    const err = new Error('Invalid mapping JSON payload');
    err.status = 400;
    throw err;
  }
}

/**
 * GET /api/import/template
 * Download import templates (empty or pre-populated).
 */
router.get('/template', async (req, res, next) => {
  try {
    const dataType = String(req.query.dataType || 'events');
    const format = String(req.query.format || 'csv').toLowerCase();
    const variant = String(req.query.variant || 'empty').toLowerCase();
    const programId = req.query.programId ? String(req.query.programId) : null;
    const programStageId = req.query.programStageId ? String(req.query.programStageId) : null;
    const orgUnitScope = String(req.query.orgUnitScope || 'all');
    const orgUnitIds = req.query.orgUnitIds ? String(req.query.orgUnitIds).split(',').map((v) => v.trim()).filter(Boolean) : [];
    const language = String(req.query.language || 'en');
    const layout = String(req.query.layout || 'horizontal').toLowerCase();

    if (!ALLOWED_TEMPLATE_TYPES.has(dataType)) {
      return res.status(400).json({ error: 'Invalid dataType for template download' });
    }

    if (!ALLOWED_TEMPLATE_FORMATS.has(format)) {
      return res.status(400).json({ error: 'Invalid format for template download' });
    }

    if (!ALLOWED_TEMPLATE_VARIANTS.has(variant)) {
      return res.status(400).json({ error: 'Invalid variant for template download' });
    }

    if (!ALLOWED_TEMPLATE_LAYOUTS.has(layout)) {
      return res.status(400).json({ error: 'Invalid layout for template download' });
    }

    const bundle = await resolveTemplateBundle(req, {
      dataType,
      variant,
      programId,
      programStageId,
    });
    const orgUnitEntries = await fetchOrgUnitEntries(req, orgUnitIds);

    await sendTemplateFile(res, {
      ...bundle,
      dataType,
      variant,
      format,
      settings: {
        orgUnitScope,
        orgUnitIds,
        orgUnitNames: orgUnitEntries.map((entry) => entry.name).filter(Boolean),
        orgUnitEntries,
        language,
        layout,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/import/template/preview
 * Return template columns and a sample row for UI preview.
 */
router.get('/template/preview', async (req, res, next) => {
  try {
    const dataType = String(req.query.dataType || 'events');
    const variant = String(req.query.variant || 'empty').toLowerCase();
    const programId = req.query.programId ? String(req.query.programId) : null;
    const programStageId = req.query.programStageId ? String(req.query.programStageId) : null;

    if (!ALLOWED_TEMPLATE_TYPES.has(dataType)) {
      return res.status(400).json({ error: 'Invalid dataType for template preview' });
    }

    if (!ALLOWED_TEMPLATE_VARIANTS.has(variant)) {
      return res.status(400).json({ error: 'Invalid variant for template preview' });
    }

    const bundle = await resolveTemplateBundle(req, {
      dataType,
      variant,
      programId,
      programStageId,
    });

    const sampleRow = bundle.rows[0] || {};
    res.json({
      columns: Object.keys(sampleRow),
      sampleRow,
      sections: bundle.sections,
      dataType,
      variant,
      programId,
      programStageId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/tracker
 * Upload a file (JSON/CSV/Excel) and import it to DHIS2.
 */
router.post('/tracker', importLimiter, validateImportRequest, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const options = {
      importStrategy: req.body.importStrategy || 'CREATE_AND_UPDATE',
      atomicMode: req.body.atomicMode || 'ALL',
      async: req.body.async === 'true',
    };
    const dataType = req.body.dataType || 'events';
    const mapping = parseMapping(req.body.mapping);

    let payload;
    let rows = [];

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      rows = await excelToJson(req.file.buffer);
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // Validate before sending
    const validation = validateTrackerPayload(payload);
    const issueReport = buildIssueReport(rows, mapping, dataType);
    if (!validation.valid) {
      return res.status(422).json({
        error: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
        rowIssues: issueReport,
      });
    }

    const result = await importTrackerData(req, payload, options);

    const importCount = result?.importSummary?.importCount || result?.stats || {};
    const totalCount = (importCount.created || 0) + (importCount.updated || 0) + (importCount.deleted || 0) + (importCount.ignored || 0);
    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'import',
      status: 'success',
      mode: options.async ? 'async' : 'sync',
      dataType,
      count: totalCount,
      details: 'Import completed successfully',
      metadata: {
        importStrategy: options.importStrategy,
        atomicMode: options.atomicMode,
      },
    });

    res.json({
      success: true,
      result,
      warnings: validation.warnings,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/validate
 * Validate a file without importing.
 */
router.post('/validate', importLimiter, validateImportRequest, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const dataType = req.body.dataType || 'events';
    const mapping = parseMapping(req.body.mapping);

    let payload;
    let rows = [];

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      rows = await excelToJson(req.file.buffer);
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    const validation = validateTrackerPayload(payload);
    const issueReport = buildIssueReport(rows, mapping, dataType);
    const counts = {
      events: payload.events ? payload.events.length : 0,
      enrollments: payload.enrollments ? payload.enrollments.length : 0,
      trackedEntities: payload.trackedEntities ? payload.trackedEntities.length : 0,
    };

    res.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      rowIssues: issueReport,
      counts,
      preview: {
        events: payload.events ? payload.events.slice(0, 5) : [],
        enrollments: payload.enrollments ? payload.enrollments.slice(0, 5) : [],
        trackedEntities: payload.trackedEntities ? payload.trackedEntities.slice(0, 5) : [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/import/jobs/:jobId
 * Check async import job status.
 */
router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const status = await getJobStatus(req, req.params.jobId);

    addHistoryEntry(req.authSession?.id || 'anonymous', {
      type: 'import',
      status: status?.status?.toLowerCase?.() || 'running',
      mode: 'async',
      dataType: 'tracker',
      details: `Checked import job status for ${req.params.jobId}`,
      metadata: { jobId: req.params.jobId },
    });

    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
