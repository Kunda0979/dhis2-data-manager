const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { requireDhis2Credentials } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validateImportRequest } = require('../middleware/validate');
const { importLimiter } = require('../middleware/rateLimiter');
const {
  importTrackerData,
  importAggregateData,
  getJobStatus,
  extractImportJobId,
  registerImportJob,
} = require('../services/importService');
const {
  runDataSetValidation,
  registerDataSetCompletion,
  unregisterDataSetCompletion,
  getDataSetCompletionStatus,
} = require('../services/aggregateValidationService');
const {
  csvToJson,
  excelToJson,
  excelToJsonWithMetadata,
  jsonToCsv,
  buildTemplateWorkbook,
  TEMPLATE_SCHEMA_VERSION,
} = require('../services/fileService');
const { buildTrackerPayload, convertToTracker } = require('../utils/payloadBuilder');
const { validateTrackerPayload, hasBlockingImportErrors } = require('../utils/payloadValidator');
const {
  buildEventStableKey,
  buildEnrollmentStableKey,
  buildTrackedEntityStableKey,
  generateStableDhis2Uid,
  isEventKeyComplete,
  isEnrollmentKeyComplete,
} = require('../utils/stableIdentity');
const { addHistoryEntry, updateHistoryByJobId } = require('../services/historyService');
const { buildIssueReport } = require('../utils/rowValidation');
const { createDhis2Client } = require('../services/dhis2Client');
const { issueValidationToken, verifyValidationToken } = require('../services/validationTokenService');
const { ensureSelectionAccess } = require('../services/permissionService');
const { createAppError } = require('../utils/apiError');

const router = express.Router();

router.use(requireDhis2Credentials);

const AGGREGATE_DATA_TYPE = 'aggregate';

const ALLOWED_TEMPLATE_TYPES = new Set(['events', 'enrollments', 'trackedEntities', AGGREGATE_DATA_TYPE]);
const ALLOWED_TEMPLATE_FORMATS = new Set(['json', 'csv', 'xlsx']);
const ALLOWED_TEMPLATE_VARIANTS = new Set(['empty', 'prepopulated']);
const ALLOWED_TEMPLATE_LAYOUTS = new Set(['horizontal', 'vertical']);
const DHIS2_UID_PATTERN = /^[A-Za-z0-9]{11}$/;
const STRICT_DHIS2_UID_PATTERN = /^[A-Za-z][A-Za-z0-9]{10}$/;
const ORG_UNIT_PLACEHOLDER_TOKENS = new Set([
  'dropdown (click cell)',
  'liste (cliquer cellule)',
  'lista (clique na celula)',
  'lista (clique na célula)',
  'all accessible units',
  'toutes les unites accessibles',
  'toutes les unités accessibles',
  'todas as unidades acessiveis',
  'todas as unidades acessíveis',
]);
const PERIOD_PLACEHOLDER_TOKENS = new Set([
  'dropdown (click cell)',
  'liste (cliquer cellule)',
  'lista (clique na celula)',
  'lista (clique na célula)',
]);

function normalizeLanguageCode(input) {
  const raw = String(input || 'en').trim().toLowerCase();
  if (!raw) return 'en';

  if (['fr', 'fr-fr', 'french', 'francais', 'français'].includes(raw)) return 'fr';
  if (['pt', 'pt-pt', 'pt-br', 'portuguese', 'portugese', 'portuse', 'portugais', 'português'].includes(raw)) return 'pt';
  return 'en';
}

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

function makeQuestion(key, label, valueType = 'TEXT', required = false, description = '') {
  return {
    key,
    label,
    valueType,
    required: Boolean(required),
    description: String(description || '').trim(),
    options: [],
  };
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
        ...makeQuestion(
          buildTemplateFieldKey('attr', attr.id, attr.displayName),
          attr.displayName || attr.id,
          attr.valueType || 'TEXT',
          false,
          attr.description || attr.helpText || '',
        ),
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
      ...makeQuestion(
        buildTemplateFieldKey('de', de.id, de.formName || de.displayName),
        de.formName || de.displayName || de.id,
        de.valueType || 'TEXT',
        false,
        de.description || de.helpText || '',
      ),
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
          item.dataElement.description || item.dataElement.helpText || '',
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

function currentIsoWeek(date = new Date()) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function buildPeriodByType(periodType) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const week = currentIsoWeek(now);

  if (periodType === 'Monthly') return `${year}${month}`;
  if (periodType === 'Quarterly') return `${year}Q${quarter}`;
  if (periodType === 'Weekly') return `${year}W${week}`;
  if (periodType === 'Daily') return `${year}${month}${day}`;
  return String(year);
}

function mapDatasetPeriodTypeToFrequency(periodType) {
  if (periodType === 'Monthly') return 'monthly';
  if (periodType === 'Quarterly') return 'quarterly';
  if (periodType === 'SixMonthly') return 'biannual';
  if (periodType === 'Yearly') return 'yearly';
  return 'monthly';
}

function parsePeriod(period, frequency) {
  const value = String(period || '').trim();
  if (!value) return null;

  if (frequency === 'monthly') {
    const match = value.match(/^(\d{4})(\d{2})$/);
    if (!match) return null;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(match[1]), slot: month };
  }

  if (frequency === 'quarterly') {
    const match = value.match(/^(\d{4})Q([1-4])$/i);
    if (!match) return null;
    return { year: Number(match[1]), slot: Number(match[2]) };
  }

  if (frequency === 'biannual') {
    const match = value.match(/^(\d{4})S([1-2])$/i);
    if (!match) return null;
    return { year: Number(match[1]), slot: Number(match[2]) };
  }

  if (frequency === 'yearly') {
    const match = value.match(/^(\d{4})$/);
    if (!match) return null;
    return { year: Number(match[1]), slot: 1 };
  }

  return null;
}

function formatPeriodFromSlot(state, frequency) {
  if (frequency === 'monthly') return `${state.year}${String(state.slot).padStart(2, '0')}`;
  if (frequency === 'quarterly') return `${state.year}Q${state.slot}`;
  if (frequency === 'biannual') return `${state.year}S${state.slot}`;
  return String(state.year);
}

function nextPeriodSlot(state, frequency) {
  if (frequency === 'yearly') return { year: state.year + 1, slot: 1 };

  const maxSlot = frequency === 'monthly' ? 12 : frequency === 'quarterly' ? 4 : 2;
  if (state.slot < maxSlot) {
    return { year: state.year, slot: state.slot + 1 };
  }

  return { year: state.year + 1, slot: 1 };
}

function comparePeriodSlot(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.slot - b.slot;
}

function buildPeriodRange({ startPeriod, endPeriod, frequency }) {
  const freq = String(frequency || 'monthly').toLowerCase();
  const start = parsePeriod(startPeriod, freq);
  const end = parsePeriod(endPeriod, freq);
  if (!start || !end) return [];
  if (comparePeriodSlot(start, end) > 0) return [];

  const maxPeriods = 60;
  const periods = [];
  let current = start;

  for (let i = 0; i < maxPeriods; i += 1) {
    periods.push(formatPeriodFromSlot(current, freq));
    if (comparePeriodSlot(current, end) === 0) break;
    current = nextPeriodSlot(current, freq);
  }

  return periods;
}

function buildAggregateValueFieldKey(dataElementId, categoryOptionComboId, label = '') {
  const safe = sanitizeHeaderName(label);
  if (categoryOptionComboId) {
    if (safe) return `de_${dataElementId}__coc_${categoryOptionComboId}__${safe}`;
    return `de_${dataElementId}__coc_${categoryOptionComboId}`;
  }
  if (safe) return `de_${dataElementId}__${safe}`;
  return `de_${dataElementId}`;
}

function isDefaultCategoryOptionCombo(combo = null) {
  const name = String(combo?.displayName || combo?.name || '').trim().toLowerCase();
  return name === 'default';
}

function resolveAggregateCategoryCombos(dataSetMeta = null, dataElement = null) {
  const fromDataElement = dataElement?.categoryCombo?.categoryOptionCombos || [];
  if (fromDataElement.length > 0) {
    const defaultCombos = fromDataElement.filter((combo) => isDefaultCategoryOptionCombo(combo));
    if (defaultCombos.length > 0) return defaultCombos;
    return [fromDataElement[0]].filter(Boolean);
  }

  const fromDataSet = dataSetMeta?.categoryCombo?.categoryOptionCombos || [];
  if (fromDataSet.length > 0) {
    const defaultCombos = fromDataSet.filter((combo) => isDefaultCategoryOptionCombo(combo));
    if (defaultCombos.length > 0) return defaultCombos;
    return [fromDataSet[0]].filter(Boolean);
  }

  return [null];
}

function buildAggregateValueQuestions(dataSetMeta = null) {
  const dataElements = (dataSetMeta?.dataSetElements || [])
    .map((item) => item?.dataElement)
    .filter(Boolean)
    .slice(0, 240);

  const questions = [];
  for (const de of dataElements) {
    const combos = resolveAggregateCategoryCombos(dataSetMeta, de);
    if (combos.length === 0) continue;
    for (const combo of combos) {
      const comboId = combo?.id || null;
      const label = de.displayName || de.id;

      questions.push({
        ...makeQuestion(
          buildAggregateValueFieldKey(de.id, comboId, label),
          label,
          de.valueType || 'TEXT',
          false,
          de.description || de.helpText || '',
        ),
        options: extractOptionValues(de),
        dataElementId: de.id,
        categoryOptionComboId: comboId,
      });
    }
  }

  return questions;
}

function resolveAggregateTemplateFieldFromDataValue(valueQuestions, dv = {}) {
  const dataElementId = String(dv.dataElement || '').trim();
  const cocId = String(dv.categoryOptionCombo || '').trim();
  if (!dataElementId) return null;

  if (cocId) {
    const exact = valueQuestions.find((question) => question.dataElementId === dataElementId && question.categoryOptionComboId === cocId);
    if (exact) return exact;
  }

  const generic = valueQuestions.find((question) => question.dataElementId === dataElementId && !question.categoryOptionComboId);
  if (generic) return generic;

  return valueQuestions.find((question) => question.dataElementId === dataElementId) || null;
}

function buildAggregateTemplateLayout(dataSetMeta = null) {
  const valueQuestions = buildAggregateValueQuestions(dataSetMeta);
  if (valueQuestions.length === 0) {
    const dataElementOptions = (dataSetMeta?.dataSetElements || [])
      .map((item) => item?.dataElement)
      .filter(Boolean)
      .map((de) => `${de.id} - ${de.displayName || de.id}`);
    const orgUnitOptions = (dataSetMeta?.organisationUnits || [])
      .filter((ou) => ou?.id)
      .map((ou) => ou.displayName || ou.id);
    const sectionName = dataSetMeta?.displayName
      ? `${dataSetMeta.displayName} — Data Entry`
      : 'Aggregate Data Values';

    return [{
      id: 'aggregate-core',
      name: sectionName,
      questions: [
        {
          ...makeQuestion('dataElement', 'Data Element UID', 'TEXT', true),
          options: dataElementOptions,
        },
        makeQuestion('period', 'Period', 'TEXT', true),
        {
          ...makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
          options: orgUnitOptions,
        },
        makeQuestion('value', 'Value', 'TEXT', true),
        makeQuestion('comment', 'Comment', 'LONG_TEXT', false),
        makeQuestion('storedBy', 'Stored By', 'TEXT', false),
      ],
    }];
  }

  const orgUnitOptions = (dataSetMeta?.organisationUnits || [])
    .filter((ou) => ou?.id)
    .map((ou) => ou.displayName || ou.id);

  const sectionName = dataSetMeta?.displayName
    ? `${dataSetMeta.displayName} — Data Entry`
    : 'Aggregate Data Values';

  return [
    {
      id: 'aggregate-context',
      name: `${sectionName} — Context`,
      questions: [
        makeQuestion('period', 'Period', 'TEXT', true),
        {
          ...makeQuestion('orgUnit', 'Organisation Unit', 'TEXT', true),
          options: orgUnitOptions,
        },
      ],
    },
    {
      id: 'aggregate-values',
      name: `${sectionName} — Data Elements`,
      questions: valueQuestions,
    },
  ];
}

function buildGenericTemplateRows(dataType, variant, dataSetId = null, period = null) {
  const empty = variant === 'empty';

  if (dataType === AGGREGATE_DATA_TYPE) {
    const samplePeriod = period || '202604';
    return [{
      dataElement: empty ? '' : 'f7n9E0hX8qk',
      period: empty ? '' : samplePeriod,
      orgUnit: empty ? '' : 'DiszpKrYNg8',
      value: empty ? '' : '15',
      comment: empty ? '' : 'Imported from aggregate template',
      storedBy: empty ? '' : 'Data Manager',
    }];
  }

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

function buildProgramTemplateRows(programMeta, dataType, variant, programStageId, sampleEvent = null) {
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

  row.event = empty ? '' : (sampleEvent?.event || 'vrr6fQh6vQf');
  row.status = empty ? '' : (sampleEvent?.status || 'ACTIVE');
  row.program = sampleEvent?.program || programMeta.id;
  row.programStage = sampleEvent?.programStage || selectedStage?.id || '';
  row.orgUnit = empty ? '' : (sampleEvent?.orgUnitName || sampleEvent?.orgUnit || 'DiszpKrYNg8');
  row.occurredAt = empty ? '' : (sampleEvent?.occurredAt || '2026-03-31');
  if (programMeta.programType === 'WITH_REGISTRATION') {
    row.trackedEntity = empty ? '' : (sampleEvent?.trackedEntity || 'PMa2VCrupOd');
    row.enrollment = empty ? '' : (sampleEvent?.enrollment || 'AaB3zKZ2CXY');
  }

  const stageElements = (selectedStage?.programStageDataElements || [])
    .map((item) => item.dataElement)
    .filter(Boolean);

  const dataValueMap = new Map((sampleEvent?.dataValues || []).map((dv) => [dv.dataElement, dv.value]));

  for (const dataElement of stageElements) {
    row[buildTemplateFieldKey('de', dataElement.id, dataElement.displayName)] = empty
      ? ''
      : (dataValueMap.has(dataElement.id)
        ? String(dataValueMap.get(dataElement.id) ?? '')
        : sampleValueForType(dataElement.valueType, dataElement.displayName));
  }

  return [row];
}

async function fetchSampleProgramEvent(req, { programId, programStageId, orgUnitIds = [] }) {
  try {
    const client = createDhis2Client(req);
    const params = {
      program: programId,
      pageSize: 1,
      fields: 'event,status,program,programStage,orgUnit,orgUnitName,occurredAt,trackedEntity,enrollment,dataValues[dataElement,value]',
    };

    if (programStageId) params.programStage = programStageId;
    if (Array.isArray(orgUnitIds) && orgUnitIds.length > 0) {
      params.orgUnit = orgUnitIds[0];
      params.ouMode = 'SELECTED';
    }

    const response = await client.get('/api/tracker/events', { params });
    const items = response.data?.instances || response.data?.events || [];
    return items[0] || null;
  } catch {
    return null;
  }
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

async function fetchProgramTemplateMetadata(req, programId, language = 'en') {
  const client = createDhis2Client(req);
  const response = await client.get(`/api/programs/${programId}`, {
    params: {
      locale: normalizeLanguageCode(language),
      fields: [
        'id',
        'displayName',
        'programType',
        'trackedEntityType[id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,description,helpText,valueType,optionSet[id,options[id,code,name,displayName]]]]]',
        'programTrackedEntityAttributes[trackedEntityAttribute[id,displayName,description,helpText,valueType,optionSet[id,options[id,code,name,displayName]]],mandatory]',
        'programStages[id,displayName,sortOrder,programStageDataElements[dataElement[id,displayName,formName,description,helpText,valueType,optionSet[id,options[id,code,name,displayName]]],sortOrder,compulsory],programStageSections[id,displayName,sortOrder,dataElements[id,displayName,formName,description,helpText,valueType,optionSet[id,options[id,code,name,displayName]]]]]',
        'programRuleVariables[id,displayName,name,programRuleVariableSourceType,dataElement[id,displayName],trackedEntityAttribute[id,displayName],programStage[id,displayName]]',
        'programRules[id,displayName,condition,programRuleActions[id,programRuleActionType,data,content,location,template],programRuleRuleVariables[programRuleVariable[id,displayName,name]]]',
      ].join(','),
    },
  });
  return response.data;
}

async function fetchDataSetTemplateMetadata(req, dataSetId, language = 'en') {
  const client = createDhis2Client(req);
  const response = await client.get(`/api/dataSets/${dataSetId}`, {
    params: {
      locale: normalizeLanguageCode(language),
      fields: [
        'id',
        'displayName',
        'periodType',
        'categoryCombo[id,displayName,categoryOptionCombos[id,displayName]]',
        'organisationUnits[id,displayName]',
        'dataSetElements[dataElement[id,displayName,description,helpText,valueType,optionSet[id,options[id,code,name,displayName]],categoryCombo[id,displayName,categoryOptionCombos[id,displayName]]]]',
      ].join(','),
    },
  });
  return response.data;
}

async function fetchDataSetValidationRules(req, dataSetId) {
  if (!dataSetId) return [];

  const client = createDhis2Client(req);
  const attempts = [
    { filter: `dataSets.id:eq:${dataSetId}` },
    { filter: `dataSet.id:eq:${dataSetId}` },
  ];

  for (const attempt of attempts) {
    try {
      const response = await client.get('/api/validationRules', {
        params: {
          fields: 'id,displayName,description,instruction',
          filter: attempt.filter,
          paging: false,
        },
      });
      const list = response.data?.validationRules || [];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((rule) => ({
          id: rule.id,
          name: rule.displayName || rule.name || rule.id,
          description: rule.description || '',
          instruction: rule.instruction || '',
        }));
      }
    } catch {
      // Best-effort only; template generation should still succeed.
    }
  }

  return [];
}

async function fetchSampleAggregateDataValues(req, { dataSetId, period, orgUnit }) {
  if (!dataSetId || !period || !orgUnit) return [];

  try {
    const client = createDhis2Client(req);
    const response = await client.get('/api/dataValueSets', {
      params: {
        dataSet: dataSetId,
        period,
        orgUnit,
        children: false,
      },
    });
    return response.data?.dataValues || [];
  } catch {
    return [];
  }
}

function chooseAggregateOrgUnit(orgUnitIds = [], dataSetMeta = null) {
  if (Array.isArray(orgUnitIds) && orgUnitIds.length > 0) return orgUnitIds[0];
  return dataSetMeta?.organisationUnits?.[0]?.id || 'DiszpKrYNg8';
}

function resolveAggregateOrgUnitLabel(dataSetMeta = null, orgUnitId = '') {
  const targetId = String(orgUnitId || '').trim();
  const match = (dataSetMeta?.organisationUnits || []).find((ou) => String(ou?.id || '').trim() === targetId);
  return match?.displayName || targetId;
}

function chooseAggregateCategoryOptionCombo(dataSetMeta = null) {
  return dataSetMeta?.categoryCombo?.categoryOptionCombos?.[0]?.id || 'HllvX50cXC0';
}

function buildAggregateTemplateRows({
  dataSetMeta,
  variant,
  dataSetId,
  orgUnitIds = [],
  periods = [],
  sampleDataValues = [],
}) {
  const empty = variant === 'empty';
  const effectivePeriods = Array.isArray(periods) && periods.length > 0
    ? periods
    : [buildPeriodByType(dataSetMeta?.periodType)];
  const defaultOrgUnit = chooseAggregateOrgUnit(orgUnitIds, dataSetMeta);
  const defaultOrgUnitLabel = resolveAggregateOrgUnitLabel(dataSetMeta, defaultOrgUnit);
  const defaultCoc = chooseAggregateCategoryOptionCombo(dataSetMeta);
  const valueQuestions = buildAggregateValueQuestions(dataSetMeta);

  if (valueQuestions.length === 0) {
    return buildGenericTemplateRows(AGGREGATE_DATA_TYPE, variant, dataSetId, effectivePeriods[0]);
  }

  const primeRowShape = (row) => {
    for (const question of valueQuestions) {
      if (!Object.prototype.hasOwnProperty.call(row, question.key)) {
        row[question.key] = '';
      }
    }
    return row;
  };

  if (!empty && Array.isArray(sampleDataValues) && sampleDataValues.length > 0) {
    const groupedRows = new Map();

    for (const dv of sampleDataValues.slice(0, 1200)) {
      const periodValue = dv.period || effectivePeriods[0] || '';
      const orgUnitValue = resolveAggregateOrgUnitLabel(dataSetMeta, dv.orgUnit || defaultOrgUnit);
      const aocValue = dv.attributeOptionCombo || defaultCoc;
      const rowKey = `${periodValue}||${orgUnitValue}||${aocValue}`;

      if (!groupedRows.has(rowKey)) {
        groupedRows.set(rowKey, primeRowShape({
          period: periodValue,
          orgUnit: orgUnitValue,
        }));
      }

      const targetRow = groupedRows.get(rowKey);
      const targetQuestion = resolveAggregateTemplateFieldFromDataValue(valueQuestions, dv);
      if (!targetQuestion) continue;
      targetRow[targetQuestion.key] = dv.value !== undefined && dv.value !== null ? String(dv.value) : '';
    }

    const rows = [...groupedRows.values()].slice(0, 150);
    if (rows.length > 0) return rows;
  }

  const rows = [];
  for (const currentPeriod of effectivePeriods) {
    const row = primeRowShape({
        period: currentPeriod,
        orgUnit: defaultOrgUnitLabel,
      });

    for (const question of valueQuestions) {
      if (!empty) {
        row[question.key] = sampleValueForType(question.valueType, question.label);
      }
    }

    rows.push(row);
    if (rows.length >= 120) {
      return rows;
    }
  }

  return rows;
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

async function resolveTemplateBundle(req, {
  dataType,
  variant,
  programId,
  programStageId,
  language = 'en',
  orgUnitIds = [],
  dataSetId = null,
  period = null,
  periodFrequency = null,
  startPeriod = null,
  endPeriod = null,
}) {
  if (dataType === AGGREGATE_DATA_TYPE) {
    if (!dataSetId) {
      const rows = buildGenericTemplateRows(dataType, variant, dataSetId, period);
      return {
        rows,
        sections: buildAggregateTemplateLayout(),
        programMeta: null,
        dataSetMeta: null,
      };
    }

    try {
      const dataSetMeta = await fetchDataSetTemplateMetadata(req, dataSetId, language);
      const dataSetValidationRules = await fetchDataSetValidationRules(req, dataSetId);
      const effectiveFrequency = String(periodFrequency || mapDatasetPeriodTypeToFrequency(dataSetMeta?.periodType)).toLowerCase();
      const periodRange = buildPeriodRange({ startPeriod, endPeriod, frequency: effectiveFrequency });
      const effectivePeriods = periodRange.length > 0
        ? periodRange
        : [period || buildPeriodByType(dataSetMeta?.periodType)];
      const sampleDataValues = variant === 'prepopulated'
        ? (await Promise.all(effectivePeriods.map((currentPeriod) => fetchSampleAggregateDataValues(req, {
          dataSetId,
          period: currentPeriod,
          orgUnit: chooseAggregateOrgUnit(orgUnitIds, dataSetMeta),
        })))).flat()
        : [];

      return {
        rows: buildAggregateTemplateRows({
          dataSetMeta,
          variant,
          dataSetId,
          orgUnitIds,
          periods: effectivePeriods,
          sampleDataValues,
        }),
        sections: buildAggregateTemplateLayout(dataSetMeta),
        programMeta: null,
        dataSetMeta,
        dataSetValidationRules,
      };
    } catch {
      const rows = buildGenericTemplateRows(dataType, variant, dataSetId, period);
      return {
        rows,
        sections: buildAggregateTemplateLayout(),
        programMeta: null,
        dataSetMeta: null,
        dataSetValidationRules: [],
      };
    }
  }

  if (!programId) {
    const rows = buildGenericTemplateRows(dataType, variant, dataSetId, period);
    return {
      rows,
      sections: buildGenericTemplateLayout(rows[0] || {}),
      programMeta: null,
      dataSetMeta: null,
      dataSetValidationRules: [],
    };
  }

  const programMeta = await fetchProgramTemplateMetadata(req, programId, language);
  validateTemplateSelection(programMeta, dataType, programStageId);

  let sampleEvent = null;
  if (variant === 'prepopulated' && dataType === 'events') {
    sampleEvent = await fetchSampleProgramEvent(req, {
      programId: programMeta.id,
      programStageId,
      orgUnitIds,
    });
  }

  return {
    rows: buildProgramTemplateRows(programMeta, dataType, variant, programStageId, sampleEvent),
    sections: buildProgramTemplateLayout(programMeta, dataType, programStageId),
    programMeta,
    dataSetMeta: null,
    dataSetValidationRules: [],
  };
}

async function sendTemplateFile(res, { rows, sections, programMeta, dataSetMeta, dataSetValidationRules, dataType, variant, format, settings }) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeProgramName = sanitizeHeaderName(programMeta?.displayName || dataSetMeta?.displayName || '')
    .replace(/_+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const programPart = safeProgramName ? `${safeProgramName}-` : '';
  const fileBase = `template-${programPart}${dataType}-${variant}-${timestamp}`;

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
      dataSetMeta,
      templateSettings: {
        ...settings,
        dataSetValidationRules: dataSetValidationRules || [],
      },
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(buffer);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
  return res.send(JSON.stringify(rows, null, 2));
}

async function fetchOrgUnitEntries(req, orgUnitIds, orgUnitScope) {
  const client = createDhis2Client(req);

  // If specific org units were selected in the form, use those explicitly.
  if (Array.isArray(orgUnitIds) && orgUnitIds.length > 0) {
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

  // For "all" scope, populate dropdown with available org units for the user.
  if (String(orgUnitScope || '').toLowerCase() === 'all') {
    try {
      const response = await client.get('/api/organisationUnits', {
        params: {
          fields: 'id,displayName',
          withinUserHierarchy: true,
          paging: false,
        },
      });
      const orgUnits = response.data?.organisationUnits || [];
      return orgUnits
        .filter((ou) => ou?.id && ou?.displayName)
        .map((ou) => ({ id: ou.id, name: ou.displayName }));
    } catch {
      return [];
    }
  }

  return [];
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

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeValidationOptions(body = {}, dataType = 'events') {
  const options = {
    importStrategy: String(body.importStrategy || 'CREATE_AND_UPDATE'),
    atomicMode: String(body.atomicMode || 'ALL'),
    async: body.async === true || body.async === 'true',
    programId: String(body.programId || '').trim(),
    dataSetId: String(body.dataSetId || '').trim(),
  };

  if (dataType === AGGREGATE_DATA_TYPE) {
    options.dataSet = String(body.dataSet || body.dataSetId || '').trim();
    options.period = String(body.period || '').trim();
    options.orgUnit = String(body.orgUnit || '').trim();
    options.attributeOptionCombo = String(body.attributeOptionCombo || '').trim();
  }

  return options;
}

function applySelectedModelDefaultsToRows(rows = [], dataType = 'events', selected = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const programId = String(selected?.programId || '').trim();

  if (!programId || !['events', 'enrollments'].includes(dataType)) {
    return rows;
  }

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    if (String(row.program || '').trim()) return row;
    return { ...row, program: programId };
  });
}

function applySelectedModelDefaultsToPayload(payload = {}, dataType = 'events', selected = {}) {
  const programId = String(selected?.programId || '').trim();
  if (!programId || !payload || typeof payload !== 'object') return payload;

  if (dataType === 'events' && Array.isArray(payload.events)) {
    payload.events = payload.events.map((item) => {
      if (!item || typeof item !== 'object') return item;
      if (String(item.program || '').trim()) return item;
      return { ...item, program: programId };
    });
  }

  if (dataType === 'enrollments' && Array.isArray(payload.enrollments)) {
    payload.enrollments = payload.enrollments.map((item) => {
      if (!item || typeof item !== 'object') return item;
      if (String(item.program || '').trim()) return item;
      return { ...item, program: programId };
    });
  }

  return payload;
}

function buildValidationFingerprint({ fileChecksum, mapping, options, dataType }) {
  return hashString(stableStringify({
    fileChecksum,
    mapping,
    options,
    dataType,
  }));
}

function parseJsonMeta(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function applyUidFieldMappingToRows(rows = [], uidFieldMapping = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!uidFieldMapping || typeof uidFieldMapping !== 'object' || Object.keys(uidFieldMapping).length === 0) return rows;

  const aliasToFieldKey = new Map();
  for (const [fieldKey, entry] of Object.entries(uidFieldMapping)) {
    const canonicalKey = String(fieldKey || '').trim();
    if (!canonicalKey) continue;
    aliasToFieldKey.set(canonicalKey, canonicalKey);

    const visibleLabel = String(entry?.visibleLabel || '').trim();
    if (visibleLabel) aliasToFieldKey.set(visibleLabel, canonicalKey);
  }

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const canonical = aliasToFieldKey.get(String(key || '').trim()) || key;
      normalized[canonical] = value;
    }
    return normalized;
  });
}

function normalizeOptionToken(value) {
  return String(value || '').trim().toLowerCase();
}

function optionMatches(value, allowed = []) {
  const target = normalizeOptionToken(value);
  if (!target) return true;

  const direct = new Set(allowed.map((v) => normalizeOptionToken(v)).filter(Boolean));
  if (direct.has(target)) return true;

  // Handle common label/code variants like "CODE - Label".
  const aliases = new Set();
  for (const raw of allowed) {
    const text = String(raw || '').trim();
    if (!text) continue;
    aliases.add(normalizeOptionToken(text));
    const [head] = text.split('-').map((part) => part.trim());
    if (head) aliases.add(normalizeOptionToken(head));
  }
  return aliases.has(target);
}

function parseTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', 'yes', '1', 'y'].includes(normalized);
}

function normalizeLooseText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

function isTemplateOrgUnitPlaceholder(value) {
  const normalized = normalizeLooseText(value);
  return ORG_UNIT_PLACEHOLDER_TOKENS.has(normalized);
}

function isTemplatePeriodPlaceholder(value) {
  const normalized = normalizeLooseText(value);
  return PERIOD_PLACEHOLDER_TOKENS.has(normalized);
}

function buildOrgUnitSelectionIssues({ payload = {}, dataType = 'events' }) {
  const byType = {
    events: payload?.events || [],
    enrollments: payload?.enrollments || [],
    trackedEntities: payload?.trackedEntities || [],
    aggregate: payload?.dataValues || [],
  };

  const entries = Array.isArray(byType[dataType]) ? byType[dataType] : [];
  const issues = [];

  entries.forEach((entry, index) => {
    const raw = String(entry?.orgUnit || '').trim();
    if (!raw) {
      issues.push({
        row: index + 1,
        field: 'orgUnit',
        column: 'orgUnit',
        message: 'Organisation unit is required.',
        suggestion: 'Select a valid organisation unit and run Dry Run again.',
      });
      return;
    }

    if (isTemplateOrgUnitPlaceholder(raw)) {
      issues.push({
        row: index + 1,
        field: 'orgUnit',
        column: 'orgUnit',
        orgUnit: raw,
        orgUnitName: raw,
        message: 'Organisation unit was not selected from the dropdown.',
        suggestion: 'Choose a real organisation unit value (not the dropdown hint text) and run Dry Run again.',
      });
    }
  });

  return issues;
}

function buildPeriodSelectionIssues({ payload = {}, dataType = 'events' }) {
  if (dataType !== AGGREGATE_DATA_TYPE) return [];
  const entries = Array.isArray(payload?.dataValues) ? payload.dataValues : [];
  const issues = [];

  entries.forEach((entry, index) => {
    const raw = String(entry?.period || '').trim();
    if (!raw) {
      issues.push({
        row: index + 1,
        field: 'period',
        column: 'period',
        message: 'Period is required.',
        suggestion: 'Select a valid period and run Dry Run again.',
      });
      return;
    }

    if (isTemplatePeriodPlaceholder(raw)) {
      issues.push({
        row: index + 1,
        field: 'period',
        column: 'period',
        period: raw,
        message: 'Period was not selected from the dropdown.',
        suggestion: 'Choose a real period value (not the dropdown hint text) and run Dry Run again.',
      });
    }
  });

  return issues;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const v = String(value || '').trim();
    if (v) return v;
  }
  return '';
}

function resolveAggregateDataSetId({ payload, rows, templateMetadata, completionIntent, body }) {
  const firstDataValue = payload?.dataValues?.[0] || {};
  const firstRow = rows?.[0] || {};

  return firstNonEmpty(
    completionIntent?.dataSet,
    body?.dataSet,
    templateMetadata?.['completionIntent.ds'],
    templateMetadata?.dataSetId,
    firstRow?.dataSet,
    firstDataValue?.dataSet,
  );
}

function buildAggregateCompletionScopes({ payload, rows, templateMetadata, completionIntent, body }) {
  const dataSet = resolveAggregateDataSetId({ payload, rows, templateMetadata, completionIntent, body });
  if (!dataSet) return [];

  const scopes = [];
  const seen = new Set();
  const dataValues = Array.isArray(payload?.dataValues) ? payload.dataValues : [];

  for (const dv of dataValues) {
    const period = String(dv?.period || '').trim();
    const orgUnit = String(dv?.orgUnit || '').trim();
    if (!period || !orgUnit) continue;

    const attributeOptionCombo = String(dv?.attributeOptionCombo || '').trim();
    const key = `${dataSet}||${period}||${orgUnit}||${attributeOptionCombo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({
      dataSet,
      period,
      orgUnit,
      attributeOptionCombo,
    });
  }

  if (scopes.length === 0 && rows?.[0]) {
    const fallbackPeriod = String(rows[0].period || templateMetadata?.scopePeriod || '').trim();
    const fallbackOrgUnit = String(rows[0].orgUnit || templateMetadata?.scopeOrgUnit || '').trim();
    const fallbackAoc = String(rows[0].attributeOptionCombo || '').trim();
    if (fallbackPeriod && fallbackOrgUnit) {
      scopes.push({
        dataSet,
        period: fallbackPeriod,
        orgUnit: fallbackOrgUnit,
        attributeOptionCombo: fallbackAoc,
      });
    }
  }

  return scopes;
}

function resolveCompletionPreference({ completionIntent, body, templateMetadata }) {
  if (body?.markComplete !== undefined) {
    return parseTruthy(body.markComplete);
  }

  if (completionIntent?.completed !== undefined) {
    return parseTruthy(completionIntent.completed);
  }

  return parseTruthy(templateMetadata?.['completionIntent.completed']);
}

function resolveAlreadyCompletedAction({ completionIntent, body, templateMetadata }) {
  const direct = firstNonEmpty(
    body?.alreadyCompletedAction,
    completionIntent?.alreadyCompletedAction,
    templateMetadata?.['completionIntent.alreadyCompletedAction'],
  ).toLowerCase();

  return direct === 'continue' ? 'continue' : 'cancel';
}

function resolveSubmissionComment({ completionIntent, body, templateMetadata }) {
  return firstNonEmpty(
    body?.submissionComment,
    completionIntent?.submissionComment,
    templateMetadata?.['completionIntent.submissionComment'],
  );
}

function resolveTemplateSubmissionDecision(completionIntent = {}) {
  const raw = String(completionIntent?.submissionDecision || '').trim();
  if (!raw) {
    return {
      raw,
      normalized: null,
      markComplete: null,
      status: 'missing',
    };
  }

  const normalized = normalizeOptionToken(raw);
  if (optionMatches(normalized, ['draft'])) {
    return {
      raw,
      normalized: 'draft',
      markComplete: false,
      status: 'ok',
    };
  }

  if (optionMatches(normalized, ['submit and mark complete'])) {
    return {
      raw,
      normalized: 'submit_and_mark_complete',
      markComplete: true,
      status: 'ok',
    };
  }

  return {
    raw,
    normalized: null,
    markComplete: null,
    status: 'invalid',
  };
}

function buildAggregateSubmissionDecisionIssues({ dataType, ext, completionIntent = {} }) {
  if (dataType !== AGGREGATE_DATA_TYPE) return [];
  if (!['.xlsx', '.xls'].includes(String(ext || '').toLowerCase())) return [];

  const resolved = resolveTemplateSubmissionDecision(completionIntent);
  if (resolved.status === 'ok') return [];

  if (resolved.status === 'missing') {
    return [{
      row: 1,
      field: 'submissionDecision',
      column: 'Submission Decision',
      message: 'Submission Decision in Start Here is blank.',
      suggestion: 'Choose either Draft or Submit and Mark Complete in the Excel Start Here sheet, then run Dry Run again.',
    }];
  }

  return [{
    row: 1,
    field: 'submissionDecision',
    column: 'Submission Decision',
    message: `Submission Decision "${resolved.raw}" is invalid.`,
    suggestion: 'Use Draft or Submit and Mark Complete in the Excel Start Here sheet.',
  }];
}

function parseAggregateDataElementKeyForName(key) {
  if (typeof key !== 'string') return null;
  const match = key.match(/^de_([A-Za-z0-9]{11})(?:__coc_[A-Za-z0-9]{11})?(?:__(.+))?$/);
  if (!match) return null;

  const id = match[1];
  const safeLabel = String(match[2] || '').trim();
  const name = safeLabel
    ? safeLabel.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  return { id, name };
}

function buildAggregateDataElementNameMap(rows = []) {
  const map = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return map;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      const parsed = parseAggregateDataElementKeyForName(key);
      if (!parsed?.id) continue;
      if (!map.has(parsed.id) || parsed.name) {
        map.set(parsed.id, parsed.name || map.get(parsed.id) || '');
      }
    }
  }

  return map;
}

async function fetchResourceNameMapByIds(req, resourcePath, ids = []) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && DHIS2_UID_PATTERN.test(id)))];

  const map = new Map();
  if (uniqueIds.length === 0) return map;

  const client = createDhis2Client(req);
  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const response = await client.get(`/api/${resourcePath}/${id}`, {
        params: { fields: 'id,displayName,name' },
      });
      const label = String(response.data?.displayName || response.data?.name || '').trim();
      if (label) map.set(id, label);
    } catch {
      // Best-effort enrichment only.
    }
  }));

  return map;
}

function collectIssueFieldIds(issues = []) {
  const dataElementIds = new Set();
  const orgUnitIds = new Set();

  for (const issue of issues || []) {
    const de = String(issue?.dataElement || '').trim();
    if (de && DHIS2_UID_PATTERN.test(de)) dataElementIds.add(de);

    const ou = String(issue?.orgUnit || '').trim();
    if (ou && DHIS2_UID_PATTERN.test(ou)) orgUnitIds.add(ou);
  }

  return {
    dataElementIds: [...dataElementIds],
    orgUnitIds: [...orgUnitIds],
  };
}

function enrichIssueEntityFields(issue = {}, context = {}) {
  if (!issue || typeof issue !== 'object') return issue;

  const dataElementNameById = context?.dataElementNameById instanceof Map
    ? context.dataElementNameById
    : new Map();
  const orgUnitNameById = context?.orgUnitNameById instanceof Map
    ? context.orgUnitNameById
    : new Map();

  const enriched = { ...issue };

  const dataElementId = String(enriched.dataElement || '').trim();
  if (dataElementId) {
    const resolvedDataElementName = String(
      enriched.dataElementName || dataElementNameById.get(dataElementId) || '',
    ).trim();
    if (resolvedDataElementName) {
      enriched.dataElementName = resolvedDataElementName;
    }
  }

  const orgUnitId = String(enriched.orgUnit || '').trim();
  if (orgUnitId && DHIS2_UID_PATTERN.test(orgUnitId)) {
    const resolvedOrgUnitName = String(orgUnitNameById.get(orgUnitId) || '').trim();
    if (resolvedOrgUnitName) {
      enriched.orgUnitId = orgUnitId;
      enriched.orgUnit = resolvedOrgUnitName;
      enriched.orgUnitName = resolvedOrgUnitName;
    }
  }

  return enriched;
}

function enrichIssuesWithEntityNames(issues = [], context = {}) {
  return (Array.isArray(issues) ? issues : []).map((issue) => enrichIssueEntityFields(issue, context));
}

function applyAggregateTemplateDefaults(rows = [], templateMetadata = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const defaultAttributeOptionCombo = String(templateMetadata?.aggregateDefaultAttributeOptionCombo || '').trim();
  if (!defaultAttributeOptionCombo) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    if (String(row.attributeOptionCombo || row.aoc || '').trim()) return row;
    return {
      ...row,
      attributeOptionCombo: defaultAttributeOptionCombo,
    };
  });
}

function applyStartHereOrgUnitDefaults(rows = [], completionIntent = {}, templateMetadata = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const rawSelected = String(completionIntent?.selectedOrgUnits || '').trim();
  const selectedItems = rawSelected
    ? rawSelected
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    : [];

  const fromStartHere = selectedItems.length === 1 ? selectedItems[0] : '';
  const fromMetadata = String(templateMetadata?.scopeOrgUnit || '').trim();
  const fromRows = rows
    .map((row) => String(row?.orgUnit || '').trim())
    .find((value) => value && !isTemplateOrgUnitPlaceholder(value)) || '';

  const selectedOrgUnit = firstNonEmpty(fromStartHere, fromMetadata, fromRows);
  if (!selectedOrgUnit || isTemplateOrgUnitPlaceholder(selectedOrgUnit)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const currentOrgUnit = String(row.orgUnit || '').trim();
    if (currentOrgUnit && !isTemplateOrgUnitPlaceholder(currentOrgUnit)) return row;
    return {
      ...row,
      orgUnit: selectedOrgUnit,
    };
  });
}

function applyStartHerePeriodDefaults(rows = [], completionIntent = {}, templateMetadata = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const fromStartHere = String(completionIntent?.period || '').trim();
  const fromMetadata = String(templateMetadata?.scopePeriod || '').trim();
  const fromRows = rows
    .map((row) => String(row?.period || '').trim())
    .find((value) => value && !isTemplatePeriodPlaceholder(value)) || '';

  const selectedPeriod = firstNonEmpty(fromStartHere, fromMetadata, fromRows);
  if (!selectedPeriod || isTemplatePeriodPlaceholder(selectedPeriod)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const currentPeriod = String(row.period || '').trim();
    if (currentPeriod && !isTemplatePeriodPlaceholder(currentPeriod)) return row;
    return {
      ...row,
      period: selectedPeriod,
    };
  });
}

function applyAggregateRequestScopeDefaultsToRows(rows = [], body = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const bodyOrgUnit = String(body?.orgUnit || '').trim();
  const bodyPeriod = String(body?.period || '').trim();

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;

    const currentOrgUnit = String(row.orgUnit || '').trim();
    const currentPeriod = String(row.period || '').trim();

    const next = { ...row };
    if ((!currentOrgUnit || isTemplateOrgUnitPlaceholder(currentOrgUnit)) && bodyOrgUnit && !isTemplateOrgUnitPlaceholder(bodyOrgUnit)) {
      next.orgUnit = bodyOrgUnit;
    }
    if ((!currentPeriod || isTemplatePeriodPlaceholder(currentPeriod)) && bodyPeriod && !isTemplatePeriodPlaceholder(bodyPeriod)) {
      next.period = bodyPeriod;
    }

    return next;
  });
}

function applyAggregateRequestScopeDefaultsToPayload(payload = {}, body = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.dataValues) || payload.dataValues.length === 0) return payload;

  const bodyOrgUnit = String(body?.orgUnit || '').trim();
  const bodyPeriod = String(body?.period || '').trim();

  payload.dataValues = payload.dataValues.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;

    const currentOrgUnit = String(entry.orgUnit || '').trim();
    const currentPeriod = String(entry.period || '').trim();

    return {
      ...entry,
      orgUnit: (!currentOrgUnit || isTemplateOrgUnitPlaceholder(currentOrgUnit)) && bodyOrgUnit && !isTemplateOrgUnitPlaceholder(bodyOrgUnit)
        ? bodyOrgUnit
        : entry.orgUnit,
      period: (!currentPeriod || isTemplatePeriodPlaceholder(currentPeriod)) && bodyPeriod && !isTemplatePeriodPlaceholder(bodyPeriod)
        ? bodyPeriod
        : entry.period,
    };
  });

  return payload;
}

// --- Idempotent import: UID injection and deterministic key generation ---

/**
 * Inject UIDs from the hidden Excel UID Mapping sheet into rows before payload building.
 * Rows with a matching stable key reuse their stored DHIS2 UID so re-imports update
 * existing records instead of creating duplicates.
 */
function injectUidsFromMapping(rows, uidMapping, dataType) {
  if (!uidMapping || typeof uidMapping !== 'object') return rows;
  if (Object.keys(uidMapping).length === 0) return rows;
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  if (dataType === 'events') {
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const key = buildEventStableKey({
        program: row.program, programStage: row.programStage,
        orgUnit: row.orgUnit, occurredAt: row.occurredAt || row.eventDate,
        trackedEntity: row.trackedEntity,
      });
      const entry = uidMapping[key];
      if (!entry) return row;
      const next = { ...row };
      const mappedUid = String(entry.dhis2uid || entry.eventuid || '').trim();
      if (mappedUid && STRICT_DHIS2_UID_PATTERN.test(mappedUid)) next.event = mappedUid;
      const mappedTeUid = String(entry.trackedentityuid || '').trim();
      if (mappedTeUid && STRICT_DHIS2_UID_PATTERN.test(mappedTeUid) && !STRICT_DHIS2_UID_PATTERN.test(String(next.trackedEntity || '').trim())) next.trackedEntity = mappedTeUid;
      const mappedEnrollUid = String(entry.enrollmentuid || '').trim();
      if (mappedEnrollUid && STRICT_DHIS2_UID_PATTERN.test(mappedEnrollUid) && !STRICT_DHIS2_UID_PATTERN.test(String(next.enrollment || '').trim())) next.enrollment = mappedEnrollUid;
      return next;
    });
  }

  if (dataType === 'enrollments') {
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const key = buildEnrollmentStableKey({
        program: row.program, orgUnit: row.orgUnit, trackedEntity: row.trackedEntity,
        enrolledAt: row.enrolledAt || row.enrollmentDate,
        occurredAt: row.occurredAt || row.incidentDate,
      });
      const entry = uidMapping[key];
      if (!entry) return row;
      const next = { ...row };
      const mappedUid = String(entry.dhis2uid || entry.enrollmentuid || '').trim();
      if (mappedUid && STRICT_DHIS2_UID_PATTERN.test(mappedUid)) next.enrollment = mappedUid;
      const mappedTeUid = String(entry.trackedentityuid || '').trim();
      if (mappedTeUid && STRICT_DHIS2_UID_PATTERN.test(mappedTeUid) && !STRICT_DHIS2_UID_PATTERN.test(String(next.trackedEntity || '').trim())) next.trackedEntity = mappedTeUid;
      return next;
    });
  }

  if (dataType === 'trackedEntities') {
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const key = buildTrackedEntityStableKey({ trackedEntityType: row.trackedEntityType, orgUnit: row.orgUnit });
      const entry = uidMapping[key];
      if (!entry) return row;
      const mappedUid = String(entry.dhis2uid || entry.trackedentityuid || '').trim();
      if (!mappedUid || !STRICT_DHIS2_UID_PATTERN.test(mappedUid)) return row;
      return { ...row, trackedEntity: mappedUid };
    });
  }

  return rows;
}

/**
 * Generate deterministic UIDs for tracker rows that have AUTO/missing UIDs.
 * The same natural key always yields the same UID so re-uploading the same data
 * triggers an update rather than a duplicate create.
 */
function applyDeterministicUids(rows, dataType) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  if (dataType === 'events') {
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const eventId = String(row.event || '').trim();
      if (eventId && eventId.toUpperCase() !== 'AUTO' && STRICT_DHIS2_UID_PATTERN.test(eventId)) return row;
      if (!isEventKeyComplete(row)) return row;
      const stableKey = buildEventStableKey({
        program: row.program, programStage: row.programStage,
        orgUnit: row.orgUnit, occurredAt: row.occurredAt || row.eventDate,
        trackedEntity: row.trackedEntity,
      });
      return { ...row, event: generateStableDhis2Uid(stableKey) };
    });
  }

  if (dataType === 'enrollments') {
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const enrollId = String(row.enrollment || '').trim();
      if (enrollId && enrollId.toUpperCase() !== 'AUTO' && STRICT_DHIS2_UID_PATTERN.test(enrollId)) return row;
      if (!isEnrollmentKeyComplete(row)) return row;
      const stableKey = buildEnrollmentStableKey({
        program: row.program, orgUnit: row.orgUnit, trackedEntity: row.trackedEntity,
        enrolledAt: row.enrolledAt || row.enrollmentDate,
        occurredAt: row.occurredAt || row.incidentDate,
      });
      return { ...row, enrollment: generateStableDhis2Uid(stableKey) };
    });
  }

  return rows;
}

/**
 * Summarise how UIDs were resolved so the response can explain create vs update.
 */
function countUidResolutions(rows, dataType, uidMapping = {}) {
  const uidFields = { events: 'event', enrollments: 'enrollment', trackedEntities: 'trackedEntity' };
  const uidField = uidFields[dataType];
  if (!uidField || !Array.isArray(rows)) return null;

  let fromMapping = 0;
  let deterministic = 0;
  let newRandom = 0;
  let existingUid = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const uid = String(row[uidField] || '').trim();
    if (!uid || uid.toUpperCase() === 'AUTO' || !STRICT_DHIS2_UID_PATTERN.test(uid)) {
      newRandom++;
      continue;
    }

    let stableKey;
    if (dataType === 'events') {
      stableKey = buildEventStableKey({ program: row.program, programStage: row.programStage, orgUnit: row.orgUnit, occurredAt: row.occurredAt || row.eventDate, trackedEntity: row.trackedEntity });
    } else if (dataType === 'enrollments') {
      stableKey = buildEnrollmentStableKey({ program: row.program, orgUnit: row.orgUnit, trackedEntity: row.trackedEntity, enrolledAt: row.enrolledAt, occurredAt: row.occurredAt });
    } else {
      stableKey = buildTrackedEntityStableKey({ trackedEntityType: row.trackedEntityType, orgUnit: row.orgUnit });
    }

    const entry = uidMapping[stableKey];
    const mappedUid = entry ? String(entry.dhis2uid || entry.eventuid || entry.enrollmentuid || entry.trackedentityuid || '').trim() : '';
    if (mappedUid && mappedUid === uid) {
      fromMapping++;
    } else if (stableKey) {
      try {
        fromMapping += (generateStableDhis2Uid(stableKey) === uid) ? 1 : 0;
        if (generateStableDhis2Uid(stableKey) === uid) { deterministic++; } else { existingUid++; }
      } catch { existingUid++; }
    } else {
      existingUid++;
    }
  }

  // Correct over-counting (fromMapping incremented twice above for deterministic path)
  fromMapping = Math.max(0, fromMapping - deterministic);

  return { fromMapping, deterministic, newRandom, existingUid, total: rows.length };
}

function buildMissingAggregateDataValueIssues({ payload = {} }) {
  const dataValues = Array.isArray(payload?.dataValues) ? payload.dataValues : [];
  if (dataValues.length > 0) return [];

  return [{
    row: 1,
    field: 'dataValues',
    column: 'Data Entry',
    message: 'No aggregate data values were found in the uploaded file.',
    suggestion: 'Enter at least one value in a data element column, keep org unit/period selected, and run Dry Run again.',
  }];
}

function isAggregateImportSuccessful(result = {}) {
  const topStatus = String(result?.status || '').trim().toUpperCase();
  const summaryStatus = String(result?.importSummary?.status || '').trim().toUpperCase();
  const responseStatus = String(result?.response?.status || '').trim().toUpperCase();
  const statusPool = [topStatus, summaryStatus, responseStatus].filter(Boolean);

  if (statusPool.some((status) => ['ERROR', 'FAILED', 'FAILURE'].includes(status))) {
    return false;
  }

  const conflicts = Array.isArray(result?.conflicts)
    ? result.conflicts
    : Array.isArray(result?.importSummary?.conflicts)
      ? result.importSummary.conflicts
      : [];

  return conflicts.length === 0;
}

function isAutoLikeEventId(value) {
  const v = String(value || '').trim().toUpperCase();
  return !v || v === 'AUTO' || v === 'AUTO-GENERATED';
}

function mappedFieldValue(row, mapping, field) {
  const mappedKey = mapping && typeof mapping === 'object' ? mapping[field] : null;
  if (mappedKey && Object.prototype.hasOwnProperty.call(row, mappedKey)) return row[mappedKey];
  return row[field];
}

function buildUpdateIdentityIssues({ dataType, importStrategy, rows = [], mapping = {}, payload = null }) {
  if (String(importStrategy || '').toUpperCase() !== 'UPDATE') return [];

  const byType = {
    events: {
      field: 'event',
      label: 'Event ID',
      listKey: 'events',
      message: 'Event ID must be a real existing DHIS2 Event UID for UPDATE strategy.',
    },
    enrollments: {
      field: 'enrollment',
      label: 'Enrollment ID',
      listKey: 'enrollments',
      message: 'Enrollment ID must be a real existing DHIS2 Enrollment UID for UPDATE strategy.',
    },
    trackedEntities: {
      field: 'trackedEntity',
      label: 'Tracked Entity ID',
      listKey: 'trackedEntities',
      message: 'Tracked Entity ID must be a real existing DHIS2 Tracked Entity UID for UPDATE strategy.',
    },
  };

  const cfg = byType[dataType];
  if (!cfg) return [];

  const issues = [];

  if (Array.isArray(rows) && rows.length > 0) {
    rows.forEach((row, index) => {
      const rowValue = mappedFieldValue(row || {}, mapping, cfg.field);
      const raw = String(rowValue || '').trim();
      if (isAutoLikeEventId(raw) || !STRICT_DHIS2_UID_PATTERN.test(raw)) {
        issues.push({
          row: index + 1,
          field: cfg.field,
          message: cfg.message,
          suggestion: `Use a pre-populated template or paste valid ${cfg.label}s before uploading.`,
        });
      }
    });
    return issues;
  }

  const items = payload?.[cfg.listKey] || [];
  items.forEach((item, index) => {
    const raw = String(item?.[cfg.field] || '').trim();
    if (isAutoLikeEventId(raw) || !STRICT_DHIS2_UID_PATTERN.test(raw)) {
      issues.push({
        row: index + 1,
        field: cfg.field,
        message: cfg.message,
        suggestion: `Provide valid ${cfg.label}s; AUTO/blank values are not allowed for UPDATE.`,
      });
    }
  });

  return issues;
}

function buildAggregateOptionsIssues({ dataType, options }) {
  if (dataType !== AGGREGATE_DATA_TYPE) return [];

  const issues = [];
  if (options?.async) {
    issues.push({
      row: 1,
      field: 'async',
      message: 'Aggregate import currently supports synchronous submission only.',
      suggestion: 'Disable async import and retry.',
    });
  }
  return issues;
}

/**
 * Early identity validation against the hidden metadata in the uploaded Excel template.
 * Returns blocking errors (dataset/program mismatch) and non-blocking warnings
 * (period/orgUnit/AOC drift) before any payload building or DHIS2 calls.
 */
function buildTemplateIdentityMismatchIssues(templateMetadata = {}, { dataType, body = {}, selectedModel = {} }) {
  const errors = [];
  const warnings = [];

  const templateLayout = String(templateMetadata?.selectedLayout || templateMetadata?.layout || '').trim().toLowerCase();
  const requestedLayout = String(body?.layout || '').trim().toLowerCase();
  if (templateLayout && requestedLayout && templateLayout !== requestedLayout) {
    errors.push({
      code: 'TEMPLATE_LAYOUT_MISMATCH',
      field: 'layout',
      uploadedLayout: templateLayout,
      selectedLayout: requestedLayout,
      message: `This Excel template was generated for ${templateLayout} layout, but ${requestedLayout} was selected for upload validation/import.`,
      suggestion: 'Use a template generated with the same layout type, or select the matching layout.',
    });
  }

  if (dataType === AGGREGATE_DATA_TYPE) {
    const templateDataSetId = String(templateMetadata?.dataSetId || '').trim();
    const selectedDataSetId = String(selectedModel?.dataSetId || body?.dataSetId || body?.dataSet || '').trim();

    if (templateDataSetId && selectedDataSetId && templateDataSetId !== selectedDataSetId) {
      errors.push({
        code: 'DATASET_MISMATCH',
        field: 'dataSetId',
        uploadedDatasetId: templateDataSetId,
        uploadedDatasetName: String(templateMetadata?.dataSetName || '').trim(),
        selectedDatasetId: selectedDataSetId,
        message: `This Excel template was generated for a different dataset (${templateDataSetId}). Selected dataset: ${selectedDataSetId}.`,
        suggestion: 'Download the correct template for the selected dataset, or change the selected dataset to match this template.',
      });
      return { errors, warnings, hasBlockingMismatch: true };
    }

    const templatePeriod = String(templateMetadata?.scopePeriod || '').trim();
    const requestedPeriod = String(body?.period || '').trim();
    if (templatePeriod && requestedPeriod && templatePeriod !== requestedPeriod) {
      errors.push({
        code: 'PERIOD_MISMATCH',
        field: 'period',
        uploadedPeriod: templatePeriod,
        selectedPeriod: requestedPeriod,
        message: `Template period (${templatePeriod}) differs from the requested import period (${requestedPeriod}).`,
        suggestion: 'Use a template with the same period context, or change the selected period to match this template.',
      });
    }

    const templateOrgUnit = String(templateMetadata?.scopeOrgUnit || '').trim();
    const requestedOrgUnit = String(body?.orgUnit || '').trim();
    if (templateOrgUnit && requestedOrgUnit && templateOrgUnit !== requestedOrgUnit) {
      errors.push({
        code: 'ORGUNIT_MISMATCH',
        field: 'orgUnit',
        uploadedOrgUnit: templateOrgUnit,
        selectedOrgUnit: requestedOrgUnit,
        message: `Template org unit (${templateOrgUnit}) differs from the requested import org unit (${requestedOrgUnit}).`,
        suggestion: 'Use a template generated for the selected organisation unit, or change the selection to match this template.',
      });
    }

    const templateOrgUnitIds = parseJsonMeta(templateMetadata?.orgUnitIds, []);
    if (Array.isArray(templateOrgUnitIds) && templateOrgUnitIds.length > 1 && requestedOrgUnit && !templateOrgUnitIds.includes(requestedOrgUnit)) {
      errors.push({
        code: 'ORGUNIT_MISMATCH',
        field: 'orgUnit',
        uploadedOrgUnitIds: templateOrgUnitIds,
        selectedOrgUnit: requestedOrgUnit,
        message: `Selected org unit (${requestedOrgUnit}) is not part of the template org unit selection.`,
        suggestion: 'Select an organisation unit that was included when this template was downloaded.',
      });
    }

    const templateAoc = String(templateMetadata?.aggregateDefaultAttributeOptionCombo || '').trim();
    const requestedAoc = String(body?.attributeOptionCombo || '').trim();
    if (templateAoc && requestedAoc && templateAoc !== requestedAoc) {
      errors.push({
        code: 'ATTRIBUTE_OPTION_COMBO_MISMATCH',
        field: 'attributeOptionCombo',
        uploadedAoc: templateAoc,
        selectedAoc: requestedAoc,
        message: `Template attribute option combo (${templateAoc}) differs from the requested value (${requestedAoc}).`,
        suggestion: 'Use the same attribute option combo used when downloading this template.',
      });
    }
  }

  if (['events', 'enrollments', 'trackedEntities'].includes(dataType)) {
    const templateProgramId = String(templateMetadata?.programId || '').trim();
    const selectedProgramId = String(selectedModel?.programId || body?.programId || '').trim();

    if (templateProgramId && selectedProgramId && templateProgramId !== selectedProgramId) {
      errors.push({
        code: 'PROGRAM_MISMATCH',
        field: 'programId',
        uploadedProgramId: templateProgramId,
        uploadedProgramName: String(templateMetadata?.programName || '').trim(),
        selectedProgramId: selectedProgramId,
        message: `This Excel template was generated for a different program (${templateProgramId}). Selected program: ${selectedProgramId}.`,
        suggestion: 'Download the correct template for the selected program, or change the selected program to match this template.',
      });
      return { errors, warnings, hasBlockingMismatch: true };
    }

    if (dataType === 'events') {
      const templateStageId = String(templateMetadata?.programStageId || '').trim();
      const selectedStageId = String(body?.programStageId || '').trim();
      if (templateStageId && selectedStageId && templateStageId !== selectedStageId) {
        errors.push({
          code: 'PROGRAM_STAGE_MISMATCH',
          field: 'programStageId',
          uploadedProgramStageId: templateStageId,
          selectedProgramStageId: selectedStageId,
          message: `This Excel template was generated for a different program stage (${templateStageId}). Selected stage: ${selectedStageId}.`,
          suggestion: 'Download the correct template for the selected program stage, or change the selected stage to match this template.',
        });
        return { errors, warnings, hasBlockingMismatch: true };
      }
    }
  }

  return { errors, warnings, hasBlockingMismatch: errors.length > 0 };
}

function buildSelectedModelIssues({
  dataType,
  payload = {},
  rows = [],
  templateMetadata = {},
  completionIntent = {},
  body = {},
  selectedModel = {},
}) {
  const issues = [];
  const selectedProgramId = String(selectedModel?.programId || body?.programId || '').trim();
  const selectedDataSetId = String(selectedModel?.dataSetId || body?.dataSetId || body?.dataSet || '').trim();

  if (dataType === AGGREGATE_DATA_TYPE) {
    if (!selectedDataSetId) return issues;
    const firstDataValue = payload?.dataValues?.[0] || {};
    const firstRow = rows?.[0] || {};
    const resolvedDataSetId = firstNonEmpty(
      completionIntent?.dataSet,
      templateMetadata?.['completionIntent.ds'],
      templateMetadata?.dataSetId,
      templateMetadata?.datasetId,
      templateMetadata?.dataSet,
      firstRow?.dataSet,
      firstDataValue?.dataSet,
    );

    if (!resolvedDataSetId) {
      issues.push({
        row: 1,
        field: 'dataSetId',
        message: 'This file does not contain dataset ID metadata, so selected dataset cannot be verified.',
        suggestion: 'Re-download a dataset-specific template, fill it, and run Dry Run again.',
      });
      return issues;
    }

    if (resolvedDataSetId && resolvedDataSetId !== selectedDataSetId) {
      issues.push({
        row: 1,
        field: 'dataSetId',
        message: `Selected dataset (${selectedDataSetId}) does not match file dataset (${resolvedDataSetId}).`,
        suggestion: 'Choose the matching dataset or use a file generated for the selected dataset.',
      });
    }
    return issues;
  }

  if (!selectedProgramId || !['events', 'enrollments'].includes(dataType)) return issues;

  const entries = dataType === 'events'
    ? (payload?.events || [])
    : (payload?.enrollments || []);
  const mismatches = entries
    .map((item, index) => ({
      row: index + 1,
      programId: String(item?.program || '').trim(),
    }))
    .filter((item) => item.programId && item.programId !== selectedProgramId);

  if (mismatches.length > 0) {
    issues.push({
      row: mismatches[0].row,
      field: 'programId',
      message: `Selected program (${selectedProgramId}) does not match one or more file rows (first mismatch: ${mismatches[0].programId}).`,
      suggestion: 'Choose the matching program or correct the program values in the file.',
    });
  }

  return issues;
}

function toRowIssuePayload(errors = [], warnings = []) {
  return {
    errors: errors.map((issue) => ({ severity: 'error', ...issue })),
    warnings: warnings.map((issue) => ({ severity: 'warning', ...issue })),
  };
}

function extractFieldFromValidationDetail(detail = '') {
  const match = String(detail).match(/'([^']+)'/);
  return match?.[1] || '';
}

function extractValidationPath(errorText = '') {
  const match = String(errorText).match(/^([a-zA-Z]+)\[(\d+)\]:\s*(.*)$/);
  if (!match) return null;
  return {
    collection: match[1],
    index: Number(match[2]),
    detail: match[3] || String(errorText),
  };
}

function enrichValidationErrors(errors = [], payload = {}, context = {}) {
  const dataElementNameById = context?.dataElementNameById instanceof Map
    ? context.dataElementNameById
    : new Map();
  const orgUnitNameById = context?.orgUnitNameById instanceof Map
    ? context.orgUnitNameById
    : new Map();

  return (Array.isArray(errors) ? errors : [errors]).map((error) => {
    if (!error) {
      return {
        message: 'Unknown validation error',
      };
    }

    if (typeof error !== 'string') {
      if (typeof error === 'object' && error.message) return error;
      return {
        message: String(error),
        raw: error,
      };
    }

    const parsed = extractValidationPath(error);
    if (!parsed) {
      return {
        message: error,
        raw: error,
      };
    }

    const entry = Array.isArray(payload?.[parsed.collection])
      ? payload[parsed.collection][parsed.index]
      : null;
    const field = extractFieldFromValidationDetail(parsed.detail);
    const dataElementId = String(entry?.dataElement || '').trim();
    const dataElementName = dataElementId ? String(dataElementNameById.get(dataElementId) || '').trim() : '';

    return {
      message: parsed.detail || error,
      raw: error,
      collection: parsed.collection,
      index: parsed.index,
      row: parsed.index + 2,
      field,
      dataElement: dataElementId,
      dataElementName,
      orgUnit: entry?.orgUnit || '',
      period: entry?.period || '',
      categoryOptionCombo: entry?.categoryOptionCombo || '',
      attributeOptionCombo: entry?.attributeOptionCombo || '',
      value: entry?.value,
      program: entry?.program || '',
      programStage: entry?.programStage || '',
      trackedEntityType: entry?.trackedEntityType || '',
      event: entry?.event || '',
      enrollment: entry?.enrollment || '',
      trackedEntity: entry?.trackedEntity || '',
    };
  }).map((issue) => enrichIssueEntityFields(issue, {
    dataElementNameById,
    orgUnitNameById,
  }));
}

function collectSelectionFromPayload(payload = {}, dataType = 'events') {
  const programIds = new Set();
  const programStageIds = new Set();
  const programStagePairs = [];
  const orgUnitIds = new Set();

  if (dataType === AGGREGATE_DATA_TYPE) {
    for (const row of payload.dataValues || []) {
      if (row?.orgUnit) orgUnitIds.add(String(row.orgUnit));
    }
  }

  for (const row of payload.events || []) {
    if (row?.program) programIds.add(String(row.program));
    if (row?.programStage) programStageIds.add(String(row.programStage));
    if (row?.program && row?.programStage) {
      programStagePairs.push({ programId: String(row.program), programStageId: String(row.programStage) });
    }
    if (row?.orgUnit) orgUnitIds.add(String(row.orgUnit));
  }

  for (const row of payload.enrollments || []) {
    if (row?.program) programIds.add(String(row.program));
    if (row?.orgUnit) orgUnitIds.add(String(row.orgUnit));
  }

  for (const row of payload.trackedEntities || []) {
    if (row?.orgUnit) orgUnitIds.add(String(row.orgUnit));
  }

  return {
    programIds: [...programIds],
    programStageIds: [...programStageIds],
    programStagePairs,
    orgUnitIds: [...orgUnitIds],
  };
}

async function buildCompatibilityReport(req, { rows, metadata = {}, dataType }) {
  const report = {
    passedChecks: [],
    warnings: [],
    blockingIssues: [],
    rowIssues: [],
  };

  if (!metadata.templateVersion) {
    report.warnings.push('Template metadata not found. Compatibility checks are limited.');
    return report;
  }

  if (metadata.templateVersion === TEMPLATE_SCHEMA_VERSION) {
    report.passedChecks.push(`Template schema version ${metadata.templateVersion} is supported.`);
  } else {
    report.blockingIssues.push(
      `Template schema version ${metadata.templateVersion} is not supported by server version ${TEMPLATE_SCHEMA_VERSION}. Please re-download the latest template.`,
    );
  }

  const programId = String(metadata.programId || '').trim();
  const programStageId = String(metadata.programStageId || '').trim();
  if (!programId) {
    report.warnings.push('Program metadata missing in template. Program drift checks were skipped.');
    return report;
  }

  let programMeta;
  try {
    programMeta = await fetchProgramTemplateMetadata(req, programId);
    report.passedChecks.push('Program metadata is reachable in DHIS2.');
  } catch {
    report.blockingIssues.push('Program in template could not be resolved in DHIS2. Re-download template.');
    return report;
  }

  if (programStageId && !(programMeta.programStages || []).some((stage) => stage.id === programStageId)) {
    report.blockingIssues.push('Program stage in template no longer exists in DHIS2. Re-download template.');
  } else if (programStageId) {
    report.passedChecks.push('Program stage exists in DHIS2.');
  }

  const fieldKeys = parseJsonMeta(metadata.fieldKeys, []);
  if (Array.isArray(fieldKeys) && fieldKeys.length > 0) {
    const layout = buildProgramTemplateLayout(programMeta, dataType, programStageId);
    const currentKeys = new Set();
    for (const section of layout) {
      for (const q of section.questions || []) {
        currentKeys.add(q.key);
      }
    }
    const missingKeys = fieldKeys.filter((key) => typeof key === 'string' && (key.startsWith('de_') || key.startsWith('attr_')) && !currentKeys.has(key));
    if (missingKeys.length > 0) {
      report.blockingIssues.push(`Template fields not found in latest DHIS2 metadata: ${missingKeys.slice(0, 8).join(', ')}${missingKeys.length > 8 ? ' ...' : ''}`);
    } else {
      report.passedChecks.push('Template field snapshot matches latest DHIS2 metadata.');
    }
  }

  const optionMap = parseJsonMeta(metadata.optionMap, {});
  if (optionMap && typeof optionMap === 'object') {
    const optionIssues = [];
    rows.forEach((row, index) => {
      for (const [key, allowed] of Object.entries(optionMap)) {
        if (!Array.isArray(allowed) || allowed.length === 0) continue;
        const value = String(row?.[key] || '').trim();
        if (!value) continue;
        if (!optionMatches(value, allowed)) {
          optionIssues.push({ row: index + 1, field: key, value, allowed: allowed.slice(0, 10) });
        }
      }
    });
    if (optionIssues.length > 0) {
      report.rowIssues.push(...optionIssues.map((issue) => ({
        row: issue.row,
        field: issue.field,
        message: `Value '${issue.value}' is not in allowed options`,
        suggestion: `Allowed values include: ${issue.allowed.join(', ')}`,
      })));
      report.blockingIssues.push('Some rows contain values outside allowed option sets.');
    } else {
      report.passedChecks.push('Option set values are valid for the uploaded rows.');
    }
  }

  const requiredFieldKeys = parseJsonMeta(metadata.requiredFieldKeys, []);
  if (Array.isArray(requiredFieldKeys) && requiredFieldKeys.length > 0) {
    const missingRequired = [];
    rows.forEach((row, index) => {
      for (const key of requiredFieldKeys) {
        const value = row?.[key];
        if (value === null || value === undefined || String(value).trim() === '') {
          missingRequired.push({ row: index + 1, field: key });
        }
      }
    });

    if (missingRequired.length > 0) {
      report.rowIssues.push(...missingRequired.slice(0, 200).map((issue) => ({
        row: issue.row,
        field: issue.field,
        message: `Missing required template field '${issue.field}'`,
        suggestion: 'Fill all required fields highlighted in the template.',
      })));
      report.blockingIssues.push('Required template fields are missing in one or more rows.');
    } else {
      report.passedChecks.push('Required template fields are populated.');
    }
  }

  return report;
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
    const dataSetId = req.query.dataSetId ? String(req.query.dataSetId) : null;
    const period = req.query.period ? String(req.query.period) : null;
    const periodFrequency = req.query.periodFrequency ? String(req.query.periodFrequency).toLowerCase() : null;
    const startPeriod = req.query.startPeriod ? String(req.query.startPeriod) : null;
    const endPeriod = req.query.endPeriod ? String(req.query.endPeriod) : null;
    const programStageId = req.query.programStageId ? String(req.query.programStageId) : null;
    const language = normalizeLanguageCode(req.query.language || 'en');
    const orgUnitScope = String(req.query.orgUnitScope || 'all');
    const orgUnitIds = req.query.orgUnitIds ? String(req.query.orgUnitIds).split(',').map((v) => v.trim()).filter(Boolean) : [];
    const layout = String(req.query.layout || 'horizontal').toLowerCase();

    await ensureSelectionAccess(req, {
      programId,
      programStageId,
      dataSetId,
      orgUnitIds,
    });

    if (!ALLOWED_TEMPLATE_TYPES.has(dataType)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_TYPE',
        message: 'Invalid dataType for template download',
        hint: 'Use one of: events, enrollments, trackedEntities, aggregate.',
      });
    }

    if (!ALLOWED_TEMPLATE_FORMATS.has(format)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_FORMAT',
        message: 'Invalid format for template download',
        hint: 'Use one of: json, csv, xlsx.',
      });
    }

    if (!ALLOWED_TEMPLATE_VARIANTS.has(variant)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_VARIANT',
        message: 'Invalid variant for template download',
        hint: 'Use one of: empty, prepopulated.',
      });
    }

    if (!ALLOWED_TEMPLATE_LAYOUTS.has(layout)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_LAYOUT',
        message: 'Invalid layout for template download',
        hint: 'Use one of: horizontal, vertical.',
      });
    }

    const bundle = await resolveTemplateBundle(req, {
      dataType,
      variant,
      programId,
      dataSetId,
      period,
      periodFrequency,
      startPeriod,
      endPeriod,
      programStageId,
      language,
      orgUnitIds,
    });
    const orgUnitEntries = await fetchOrgUnitEntries(req, orgUnitIds, orgUnitScope);

    await sendTemplateFile(res, {
      ...bundle,
      dataType,
      variant,
      format,
      settings: {
        period,
        dataSetId,
        orgUnitScope,
        orgUnitIds,
        orgUnitNames: orgUnitEntries.map((entry) => entry.name).filter(Boolean),
        orgUnitEntries,
        programStageName: bundle?.programMeta?.programStages?.find((stage) => stage.id === programStageId)?.displayName || '',
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
    const dataSetId = req.query.dataSetId ? String(req.query.dataSetId) : null;
    const period = req.query.period ? String(req.query.period) : null;
    const periodFrequency = req.query.periodFrequency ? String(req.query.periodFrequency).toLowerCase() : null;
    const startPeriod = req.query.startPeriod ? String(req.query.startPeriod) : null;
    const endPeriod = req.query.endPeriod ? String(req.query.endPeriod) : null;
    const programStageId = req.query.programStageId ? String(req.query.programStageId) : null;
    const language = normalizeLanguageCode(req.query.language || 'en');

    await ensureSelectionAccess(req, {
      programId,
      programStageId,
      dataSetId,
    });

    if (!ALLOWED_TEMPLATE_TYPES.has(dataType)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_TYPE',
        message: 'Invalid dataType for template preview',
      });
    }

    if (!ALLOWED_TEMPLATE_VARIANTS.has(variant)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_TEMPLATE_VARIANT',
        message: 'Invalid variant for template preview',
      });
    }

    const bundle = await resolveTemplateBundle(req, {
      dataType,
      variant,
      programId,
      dataSetId,
      period,
      periodFrequency,
      startPeriod,
      endPeriod,
      programStageId,
      language,
    });

    const sampleRow = bundle.rows[0] || {};
    res.json({
      columns: Object.keys(sampleRow),
      sampleRow,
      sections: bundle.sections,
      dataType,
      variant,
      programId,
      dataSetId,
      period,
      periodFrequency,
      startPeriod,
      endPeriod,
      programStageId,
      language,
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
      throw createAppError({
        status: 400,
        code: 'MISSING_IMPORT_FILE',
        message: 'No file uploaded',
        hint: 'Attach a CSV, JSON, or Excel file and retry.',
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const options = {
      importStrategy: req.body.importStrategy || 'CREATE_AND_UPDATE',
      atomicMode: req.body.atomicMode || 'ALL',
      async: req.body.async === 'true',
    };
    const dataType = req.body.dataType || 'events';
    const mapping = parseMapping(req.body.mapping);
    const selectedModel = {
      programId: String(req.body.programId || '').trim(),
      dataSetId: String(req.body.dataSetId || '').trim(),
    };
    const validationToken = String(req.body.validationToken || '').trim();
    const fileChecksum = hashBuffer(req.file.buffer);
    const validationOptions = normalizeValidationOptions(req.body, dataType);
    const validationFingerprint = buildValidationFingerprint({
      fileChecksum,
      mapping,
      options: validationOptions,
      dataType,
    });
    const sessionId = req.authSession?.id || 'anonymous';

    const tokenCheck = verifyValidationToken({
      token: validationToken,
      sessionId,
      fingerprint: validationFingerprint,
    });
    if (!tokenCheck.valid) {
      return res.status(409).json({
        error: 'Import blocked: run Validate first for this exact file, mapping, and options.',
        validationGate: {
          ok: false,
          reason: tokenCheck.reason,
        },
      });
    }

    let payload;
    let rows = [];
    let templateMetadata = {};
    let completionIntent = {};
    let fileUidMapping = {};
    let fileUidFieldMapping = {};

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json, dataType);
      payload = applySelectedModelDefaultsToPayload(payload, dataType, selectedModel);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      rows = applySelectedModelDefaultsToRows(rows, dataType, selectedModel);
      if (dataType !== AGGREGATE_DATA_TYPE) {
        rows = applyDeterministicUids(rows, dataType);
      }
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const envelope = await excelToJsonWithMetadata(req.file.buffer, { includeRows: false });
      // Dataset / program identity check — fires before any heavy processing or DHIS2 calls
      const earlyMismatch = buildTemplateIdentityMismatchIssues(envelope.metadata || {}, { dataType, body: req.body, selectedModel });
      if (earlyMismatch.hasBlockingMismatch) {
        const primaryErr = earlyMismatch.errors[0];
        return res.status(422).json({
          code: primaryErr.code,
          error: primaryErr.message,
          uploadedDatasetId: primaryErr.uploadedDatasetId || null,
          uploadedDatasetName: primaryErr.uploadedDatasetName || null,
          selectedDatasetId: primaryErr.selectedDatasetId || null,
          uploadedProgramId: primaryErr.uploadedProgramId || null,
          uploadedProgramName: primaryErr.uploadedProgramName || null,
          selectedProgramId: primaryErr.selectedProgramId || null,
          mismatchDetails: primaryErr,
          mismatchWarnings: earlyMismatch.warnings,
          rowIssues: toRowIssuePayload(earlyMismatch.errors, earlyMismatch.warnings),
        });
      }
      const parsed = await excelToJsonWithMetadata(req.file.buffer, { includeRows: true });
      rows = applyAggregateTemplateDefaults(parsed.rows, parsed.metadata || {});
      rows = applyUidFieldMappingToRows(rows, parsed.uidFieldMapping || {});
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyStartHereOrgUnitDefaults(rows, parsed.completionIntent || {}, parsed.metadata || {})
        : rows;
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyStartHerePeriodDefaults(rows, parsed.completionIntent || {}, parsed.metadata || {})
        : rows;
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyAggregateRequestScopeDefaultsToRows(rows, req.body)
        : rows;
      rows = applySelectedModelDefaultsToRows(rows, dataType, selectedModel);
      templateMetadata = parsed.metadata || {};
      completionIntent = parsed.completionIntent || {};
      fileUidMapping = parsed.uidMapping || {};
      fileUidFieldMapping = parsed.uidFieldMapping || {};
      if (dataType !== AGGREGATE_DATA_TYPE) {
        rows = injectUidsFromMapping(rows, fileUidMapping, dataType);
        rows = applyDeterministicUids(rows, dataType);
      }
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      throw createAppError({
        status: 400,
        code: 'UNSUPPORTED_IMPORT_FORMAT',
        message: 'Unsupported file format',
        hint: 'Use .csv, .json, .xlsx, or .xls files.',
      });
    }

    if (dataType === AGGREGATE_DATA_TYPE) {
      payload = applyAggregateRequestScopeDefaultsToPayload(payload, req.body);
    }

    const selectedModelIssues = buildSelectedModelIssues({
      dataType,
      payload,
      rows,
      templateMetadata,
      completionIntent,
      body: req.body,
      selectedModel,
    });
    if (selectedModelIssues.length > 0) {
      return res.status(422).json({
        error: 'Selected model does not match file content',
        rowIssues: toRowIssuePayload(selectedModelIssues),
      });
    }

    const selection = collectSelectionFromPayload(payload, dataType);
    const missingAggregateDataValueIssues = buildMissingAggregateDataValueIssues({ payload });
    if (missingAggregateDataValueIssues.length > 0) {
      return res.status(422).json({
        error: 'Aggregate data entry is empty',
        rowIssues: toRowIssuePayload(missingAggregateDataValueIssues),
      });
    }
    const orgUnitSelectionIssues = buildOrgUnitSelectionIssues({ payload, dataType });
    if (orgUnitSelectionIssues.length > 0) {
      return res.status(422).json({
        error: 'Organisation unit selection is invalid',
        rowIssues: toRowIssuePayload(orgUnitSelectionIssues),
      });
    }
    const periodSelectionIssues = buildPeriodSelectionIssues({ payload, dataType });
    if (periodSelectionIssues.length > 0) {
      return res.status(422).json({
        error: 'Period selection is invalid',
        rowIssues: toRowIssuePayload(periodSelectionIssues),
      });
    }

    for (const programId of selection.programIds) {
      await ensureSelectionAccess(req, {
        programId,
        orgUnitIds: selection.orgUnitIds,
      });
    }
    for (const pair of selection.programStagePairs) {
      await ensureSelectionAccess(req, {
        programId: pair.programId,
        programStageId: pair.programStageId,
      });
    }
    if (selection.programIds.length === 0) {
      await ensureSelectionAccess(req, {
        orgUnitIds: selection.orgUnitIds,
      });
    }

    const aggregateScopes = dataType === AGGREGATE_DATA_TYPE
      ? buildAggregateCompletionScopes({
        payload,
        rows,
        templateMetadata,
        completionIntent,
        body: req.body,
      })
      : [];
    const completionRequested = dataType === AGGREGATE_DATA_TYPE
      ? resolveCompletionPreference({
        completionIntent,
        body: req.body,
        templateMetadata,
      })
      : false;
    const alreadyCompletedAction = dataType === AGGREGATE_DATA_TYPE
      ? resolveAlreadyCompletedAction({
        completionIntent,
        body: req.body,
        templateMetadata,
      })
      : 'cancel';
    const submissionComment = dataType === AGGREGATE_DATA_TYPE
      ? resolveSubmissionComment({
        completionIntent,
        body: req.body,
        templateMetadata,
      })
      : '';

    if (dataType === AGGREGATE_DATA_TYPE && aggregateScopes.length > 0) {
      await ensureSelectionAccess(req, {
        dataSetId: aggregateScopes[0].dataSet,
        orgUnitIds: aggregateScopes.map((scope) => scope.orgUnit).filter(Boolean),
      });
    }

    const updateEventIssues = buildUpdateIdentityIssues({
      dataType,
      importStrategy: options.importStrategy,
      rows,
      mapping,
      payload,
    });
    const aggregateOptionIssues = buildAggregateOptionsIssues({ dataType, options });
    if (updateEventIssues.length > 0) {
      return res.status(422).json({
        error: 'UPDATE strategy requires real DHIS2 IDs for the selected tracker model',
        rowIssues: toRowIssuePayload(updateEventIssues),
      });
    }
    if (aggregateOptionIssues.length > 0) {
      return res.status(422).json({
        error: 'Aggregate import options are invalid',
        rowIssues: toRowIssuePayload(aggregateOptionIssues),
      });
    }

    const compatibility = await buildCompatibilityReport(req, {
      rows,
      metadata: templateMetadata,
      dataType,
    });
    if (compatibility.blockingIssues.length > 0) {
      return res.status(422).json({
        error: 'Template compatibility checks failed',
        compatibility,
      });
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
        compatibility,
      });
    }

    const result = dataType === AGGREGATE_DATA_TYPE
      ? await importAggregateData(req, payload)
      : await importTrackerData(req, payload, options);

    if (dataType !== AGGREGATE_DATA_TYPE && !options.async && result?.importReport?.hasBlockingErrors) {
      addHistoryEntry(sessionId, {
        type: 'import',
        status: 'failed',
        mode: 'sync',
        dataType,
        details: 'Import blocked by DHIS2 tracker blocking errors',
        metadata: {
          importStrategy: options.importStrategy,
          atomicMode: options.atomicMode,
          importReport: result.importReport,
        },
      });

      return res.status(422).json({
        error: 'Import blocked by DHIS2 tracker errors',
        importReport: result.importReport,
        result,
      });
    }

    const importCount = result?.importSummary?.importCount || result?.stats || {};
    const totalCount = dataType === AGGREGATE_DATA_TYPE
      ? (payload.dataValues ? payload.dataValues.length : 0)
      : (importCount.created || 0) + (importCount.updated || 0) + (importCount.deleted || 0) + (importCount.ignored || 0);
    if (options.async) {
      const jobId = extractImportJobId(result);
      if (jobId) {
        registerImportJob({
          sessionId,
          jobId,
          dataType,
          status: result?.status || 'PENDING',
          metadata: {
            importStrategy: options.importStrategy,
            atomicMode: options.atomicMode,
          },
        });
      }

      addHistoryEntry(sessionId, {
        type: 'import',
        status: (result?.status || 'running').toLowerCase(),
        mode: 'async',
        dataType,
        count: totalCount,
        details: 'Async import job accepted',
        metadata: {
          jobId: jobId || null,
          importStrategy: options.importStrategy,
          atomicMode: options.atomicMode,
        },
      });
    } else {
      addHistoryEntry(sessionId, {
        type: 'import',
        status: 'success',
        mode: 'sync',
        dataType,
        count: totalCount,
        details: 'Import completed successfully',
        metadata: {
          importStrategy: options.importStrategy,
          atomicMode: options.atomicMode,
          aggregateScopes,
          submissionDecision: completionRequested ? 'submit_and_mark_complete' : 'draft',
          submissionComment,
        },
      });
    }

    let completion = dataType === AGGREGATE_DATA_TYPE
      ? {
        status: 'not_completed',
        reason: completionRequested ? 'pending-checks' : 'draft',
        scopes: aggregateScopes,
      }
      : null;
    if (dataType === AGGREGATE_DATA_TYPE && completionRequested) {
      if (!isAggregateImportSuccessful(result)) {
        addHistoryEntry(sessionId, {
          type: 'completion',
          status: 'not-attempted',
          mode: 'sync',
          dataType,
          details: 'Dataset completion was not attempted because aggregate import did not succeed',
          metadata: {
            action: 'complete',
            scopes: aggregateScopes,
            submissionDecision: 'submit_and_mark_complete',
            submissionComment,
          },
        });

        completion = {
          status: 'not_completed',
          reason: 'import-not-successful',
          scopes: aggregateScopes,
        };
      } else {
        if (aggregateScopes.length === 0) {
          completion = {
            status: 'not_completed',
            reason: 'missing-scope',
            scopes: [],
          };
        } else {
          const completionDate = firstNonEmpty(
            completionIntent?.completionDate,
            req.body?.completionDate,
            templateMetadata?.['completionIntent.completionDate'],
          );

          // GATE: Run DHIS2 dataset validation after import before marking complete.
          // Controlled by ALLOW_COMPLETION_WHEN_VALIDATION_UNAVAILABLE (default false for safety).
          const allowWhenUnavailable = process.env.ALLOW_COMPLETION_WHEN_VALIDATION_UNAVAILABLE === 'true';
          let postImportViolationCount = 0;
          let postImportValidationUnavailable = false;
          const scopeValidationResults = [];

          for (const scope of aggregateScopes) {
            try {
              const scopeVal = await runDataSetValidation(req, {
                dataSet: scope.dataSet,
                orgUnit: scope.orgUnit,
                period: scope.period,
              });
              scopeValidationResults.push({ scope, validation: scopeVal });
              if (scopeVal.unavailable) postImportValidationUnavailable = true;
              postImportViolationCount += Number(scopeVal.violationCount || 0);
            } catch {
              postImportValidationUnavailable = true;
              scopeValidationResults.push({ scope, validation: { unavailable: true, violationCount: 0, violations: [] } });
            }
          }

          const postImportViolations = scopeValidationResults.flatMap((r) => r.validation?.violations || []);

          if (postImportViolationCount > 0) {
            // Block completion: violations found after import
            addHistoryEntry(sessionId, {
              type: 'completion',
              status: 'blocked',
              mode: 'sync',
              dataType,
              details: `Dataset completion blocked: ${postImportViolationCount} post-import validation violation(s)`,
              metadata: { action: 'complete', scopes: aggregateScopes, violationCount: postImportViolationCount },
            });

            completion = {
              status: 'blocked',
              reason: 'validation-violations',
              violationCount: postImportViolationCount,
              validationViolations: postImportViolations,
              scopes: aggregateScopes,
            };
          } else if (postImportValidationUnavailable && !allowWhenUnavailable) {
            // Block completion: validation endpoint unavailable
            addHistoryEntry(sessionId, {
              type: 'completion',
              status: 'blocked',
              mode: 'sync',
              dataType,
              details: 'Dataset completion blocked: DHIS2 dataset validation endpoint unavailable',
              metadata: { action: 'complete', scopes: aggregateScopes, validationUnavailable: true },
            });

            completion = {
              status: 'blocked',
              reason: 'validation-unavailable',
              validationUnavailable: true,
              scopes: aggregateScopes,
            };
          } else {
            // All validation gates passed — proceed to register completion
            const attempted = [];
            const completed = [];
            const alreadyCompleted = [];
            const failed = [];

            for (const scope of aggregateScopes) {
              const precheck = await getDataSetCompletionStatus(req, scope);
              attempted.push({ scope, precheck });

              if (precheck.isCompleted) {
                alreadyCompleted.push({ scope, precheck });
                continue;
              }

              try {
                const response = await registerDataSetCompletion(req, scope, { completionDate });
                completed.push({ scope, response });
              } catch (completionErr) {
                failed.push({
                  scope,
                  error: completionErr?.response?.data || completionErr?.message || 'Unknown DHIS2 completion error',
                });
              }
            }

            const summary = {
              requestedScopeCount: aggregateScopes.length,
              completedCount: completed.length,
              alreadyCompletedCount: alreadyCompleted.length,
              failedCount: failed.length,
            };

            if (failed.length > 0) {
              completion = {
                status: 'completion_failed',
                completionDate,
                summary,
                completed,
                alreadyCompleted,
                failed,
              };
            } else if (completed.length > 0) {
              completion = {
                status: 'completed_successfully',
                completionDate,
                summary,
                completed,
                alreadyCompleted,
              };
            } else {
              completion = {
                status: 'already_completed',
                completionDate,
                summary,
                alreadyCompleted,
              };
            }

            addHistoryEntry(sessionId, {
              type: 'completion',
              status: failed.length > 0 ? 'failed' : 'success',
              mode: 'sync',
              dataType,
              details: failed.length > 0
                ? 'Dataset completion failed for one or more imported scopes'
                : 'Dataset completion processed for all imported scopes',
              metadata: {
                action: 'complete',
                completionDate,
                completionResponse: summary,
                submissionDecision: 'submit_and_mark_complete',
                submissionComment,
                alreadyCompletedAction,
              },
            });
          }
        }
      }
    }

    // Build structured response contract
    const importSucceeded = dataType === AGGREGATE_DATA_TYPE
      ? isAggregateImportSuccessful(result)
      : !hasBlockingImportErrors(result?.importReport);

    const importStatus = (() => {
      if (!importSucceeded) return 'failed';
      const report = result?.importReport || {};
      if ((report.warnings?.length > 0) || Number(report.stats?.ignored || 0) > 0) return 'warning';
      return 'imported';
    })();

    const postImportValidationStatus = (() => {
      if (dataType !== AGGREGATE_DATA_TYPE) return 'not_run';
      if (completion?.reason === 'validation-unavailable') return 'unavailable';
      if (completion?.reason === 'validation-violations') return 'failed';
      if (completionRequested && completion?.status !== 'not_completed') return 'passed';
      return 'not_run';
    })();

    const completionStatusCode = (() => {
      if (!completionRequested || dataType !== AGGREGATE_DATA_TYPE) return 'not_requested';
      if (!completion) return 'not_requested';
      if (['completed_successfully', 'already_completed'].includes(completion.status)) return 'completed';
      if (completion.status === 'completion_failed') return 'failed';
      if (completion.status === 'blocked') return 'blocked';
      return 'blocked';
    })();

    const canMarkComplete = importSucceeded
      && completionStatusCode !== 'blocked'
      && completionStatusCode !== 'failed'
      && postImportValidationStatus !== 'failed'
      && postImportValidationStatus !== 'unavailable';

    const nextAction = (() => {
      if (importStatus === 'failed') return 'Fix import errors and retry.';
      if (completionStatusCode === 'blocked' && completion?.reason === 'validation-violations') {
        return `Fix ${completion.violationCount} DHIS2 validation violation(s) before marking complete.`;
      }
      if (completionStatusCode === 'blocked' && completion?.reason === 'validation-unavailable') {
        return 'DHIS2 dataset validation endpoint is unavailable. Contact your system administrator.';
      }
      if (completionStatusCode === 'completed') return 'Import and dataset completion successful.';
      if (completionStatusCode === 'failed') return 'Import succeeded but dataset completion failed. Retry from the Completion page.';
      if (importStatus === 'warning') return 'Import completed with warnings. Review before proceeding.';
      return 'Import completed successfully.';
    })();

    res.json({
      success: importSucceeded,
      importStatus,
      validationStatus: postImportValidationStatus,
      completionStatus: completionStatusCode,
      canMarkComplete,
      completionRequested,
      errors: [],
      warnings: validation.warnings,
      validationViolations: completion?.validationViolations || [],
      importReport: result?.importReport || null,
      completionResult: completion || null,
      nextAction,
      identityResolution: dataType !== AGGREGATE_DATA_TYPE
        ? countUidResolutions(rows, dataType, fileUidMapping)
        : null,
      // Legacy fields for backward compatibility
      result,
      compatibility,
      completion,
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
      throw createAppError({
        status: 400,
        code: 'MISSING_IMPORT_FILE',
        message: 'No file uploaded',
        hint: 'Attach a CSV, JSON, or Excel file and retry.',
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const dataType = req.body.dataType || 'events';
    const importStrategy = req.body.importStrategy || 'CREATE_AND_UPDATE';
    const mapping = parseMapping(req.body.mapping);
    const selectedModel = {
      programId: String(req.body.programId || '').trim(),
      dataSetId: String(req.body.dataSetId || '').trim(),
    };
    const fileChecksum = hashBuffer(req.file.buffer);
    const validationOptions = normalizeValidationOptions(req.body, dataType);
    const validationFingerprint = buildValidationFingerprint({
      fileChecksum,
      mapping,
      options: validationOptions,
      dataType,
    });
    const sessionId = req.authSession?.id || 'anonymous';

    let payload;
    let rows = [];
    let templateMetadata = {};
    let completionIntent = {};
    let fileUidMapping = {};

    if (ext === '.json') {
      const json = JSON.parse(req.file.buffer.toString('utf8'));
      payload = convertToTracker(json, dataType);
      payload = applySelectedModelDefaultsToPayload(payload, dataType, selectedModel);
    } else if (ext === '.csv') {
      rows = csvToJson(req.file.buffer);
      rows = applySelectedModelDefaultsToRows(rows, dataType, selectedModel);
      if (dataType !== AGGREGATE_DATA_TYPE) {
        rows = applyDeterministicUids(rows, dataType);
      }
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const envelope = await excelToJsonWithMetadata(req.file.buffer, { includeRows: false });
      // Dataset / program identity check — fires before any heavy processing or DHIS2 calls
      const earlyMismatch = buildTemplateIdentityMismatchIssues(envelope.metadata || {}, { dataType, body: req.body, selectedModel });
      if (earlyMismatch.hasBlockingMismatch) {
        const primaryErr = earlyMismatch.errors[0];
        return res.status(422).json({
          code: primaryErr.code,
          error: primaryErr.message,
          uploadedDatasetId: primaryErr.uploadedDatasetId || null,
          uploadedDatasetName: primaryErr.uploadedDatasetName || null,
          selectedDatasetId: primaryErr.selectedDatasetId || null,
          uploadedProgramId: primaryErr.uploadedProgramId || null,
          uploadedProgramName: primaryErr.uploadedProgramName || null,
          selectedProgramId: primaryErr.selectedProgramId || null,
          mismatchDetails: primaryErr,
          mismatchWarnings: earlyMismatch.warnings,
          rowIssues: toRowIssuePayload(earlyMismatch.errors, earlyMismatch.warnings),
        });
      }
      const parsed = await excelToJsonWithMetadata(req.file.buffer, { includeRows: true });
      rows = applyAggregateTemplateDefaults(parsed.rows, parsed.metadata || {});
      rows = applyUidFieldMappingToRows(rows, parsed.uidFieldMapping || {});
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyStartHereOrgUnitDefaults(rows, parsed.completionIntent || {}, parsed.metadata || {})
        : rows;
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyStartHerePeriodDefaults(rows, parsed.completionIntent || {}, parsed.metadata || {})
        : rows;
      rows = dataType === AGGREGATE_DATA_TYPE
        ? applyAggregateRequestScopeDefaultsToRows(rows, req.body)
        : rows;
      rows = applySelectedModelDefaultsToRows(rows, dataType, selectedModel);
      templateMetadata = parsed.metadata || {};
      completionIntent = parsed.completionIntent || {};
      fileUidMapping = parsed.uidMapping || {};
      if (dataType !== AGGREGATE_DATA_TYPE) {
        rows = injectUidsFromMapping(rows, fileUidMapping, dataType);
        rows = applyDeterministicUids(rows, dataType);
      }
      rows = await resolveOrgUnitNamesToIds(req, rows);
      payload = buildTrackerPayload(rows, mapping, dataType);
    } else {
      throw createAppError({
        status: 400,
        code: 'UNSUPPORTED_IMPORT_FORMAT',
        message: 'Unsupported file format',
        hint: 'Use .csv, .json, .xlsx, or .xls files.',
      });
    }

    if (dataType === AGGREGATE_DATA_TYPE) {
      payload = applyAggregateRequestScopeDefaultsToPayload(payload, req.body);
    }

    const selectedModelIssues = buildSelectedModelIssues({
      dataType,
      payload,
      rows,
      templateMetadata,
      completionIntent,
      body: req.body,
      selectedModel,
    });
    if (selectedModelIssues.length > 0) {
      return res.status(422).json({
        error: 'Selected model does not match file content',
        rowIssues: toRowIssuePayload(selectedModelIssues),
      });
    }

    const selection = collectSelectionFromPayload(payload, dataType);
    const missingAggregateDataValueIssues = buildMissingAggregateDataValueIssues({ payload });
    if (missingAggregateDataValueIssues.length > 0) {
      return res.status(422).json({
        error: 'Aggregate data entry is empty',
        rowIssues: toRowIssuePayload(missingAggregateDataValueIssues),
      });
    }
    const orgUnitSelectionIssues = buildOrgUnitSelectionIssues({ payload, dataType });
    if (orgUnitSelectionIssues.length > 0) {
      return res.status(422).json({
        error: 'Organisation unit selection is invalid',
        rowIssues: toRowIssuePayload(orgUnitSelectionIssues),
      });
    }
    const periodSelectionIssues = buildPeriodSelectionIssues({ payload, dataType });
    if (periodSelectionIssues.length > 0) {
      return res.status(422).json({
        error: 'Period selection is invalid',
        rowIssues: toRowIssuePayload(periodSelectionIssues),
      });
    }

    for (const programId of selection.programIds) {
      await ensureSelectionAccess(req, {
        programId,
        orgUnitIds: selection.orgUnitIds,
      });
    }
    for (const pair of selection.programStagePairs) {
      await ensureSelectionAccess(req, {
        programId: pair.programId,
        programStageId: pair.programStageId,
      });
    }
    if (selection.programIds.length === 0) {
      await ensureSelectionAccess(req, {
        orgUnitIds: selection.orgUnitIds,
      });
    }

    const aggregateScopes = dataType === AGGREGATE_DATA_TYPE
      ? buildAggregateCompletionScopes({
        payload,
        rows,
        templateMetadata,
        completionIntent,
        body: req.body,
      })
      : [];
    const aggregateScope = aggregateScopes[0] || null;
    if (dataType === AGGREGATE_DATA_TYPE && aggregateScope?.dataSet) {
      await ensureSelectionAccess(req, {
        dataSetId: aggregateScope.dataSet,
        orgUnitIds: aggregateScopes.map((scope) => scope.orgUnit).filter(Boolean),
      });
    }

    const updateEventIssues = buildUpdateIdentityIssues({
      dataType,
      importStrategy,
      rows,
      mapping,
      payload,
    });
    const aggregateOptionIssues = buildAggregateOptionsIssues({
      dataType,
      options: {
        async: req.body.async === 'true',
      },
    });
    const aggregateSubmissionDecisionIssues = buildAggregateSubmissionDecisionIssues({
      dataType,
      ext,
      completionIntent,
    });

    const compatibility = await buildCompatibilityReport(req, {
      rows,
      metadata: templateMetadata,
      dataType,
    });

    const validation = validateTrackerPayload(payload);
    const issueReport = buildIssueReport(rows, mapping, dataType);
    let aggregateValidation = null;
    if (dataType === AGGREGATE_DATA_TYPE) {
      aggregateValidation = await runDataSetValidation(req, aggregateScope || {});
    }

    const completionAllowed = !(aggregateValidation && aggregateValidation.violationCount > 0);
    const rowLevelErrors = [
      ...(issueReport.errors || []),
      ...updateEventIssues,
      ...selectedModelIssues,
      ...aggregateOptionIssues,
      ...aggregateSubmissionDecisionIssues,
    ];
    const hasUpdateIdentityIssues = updateEventIssues.length > 0;
    const hasAggregateOptionIssues = aggregateOptionIssues.length > 0;
    const hasCompatibilityBlockingIssues = (compatibility?.blockingIssues?.length || 0) > 0;
    const hasRowLevelErrors = rowLevelErrors.length > 0;
    const finalValid = Boolean(validation.valid)
      && !hasRowLevelErrors
      && !hasUpdateIdentityIssues
      && selectedModelIssues.length === 0
      && !hasAggregateOptionIssues
      && !hasCompatibilityBlockingIssues;
    let dataElementNameById = dataType === AGGREGATE_DATA_TYPE
      ? buildAggregateDataElementNameMap(rows)
      : new Map();
    const issueFieldIds = collectIssueFieldIds([
      ...rowLevelErrors,
      ...(issueReport.warnings || []),
    ]);

    if (issueFieldIds.dataElementIds.length > 0) {
      const fromApi = await fetchResourceNameMapByIds(req, 'dataElements', issueFieldIds.dataElementIds);
      if (fromApi.size > 0) {
        dataElementNameById = new Map([...fromApi, ...dataElementNameById]);
      }
    }

    const orgUnitNameById = issueFieldIds.orgUnitIds.length > 0
      ? await fetchResourceNameMapByIds(req, 'organisationUnits', issueFieldIds.orgUnitIds)
      : new Map();

    const enrichedErrors = enrichValidationErrors(validation.errors, payload, {
      dataElementNameById,
      orgUnitNameById,
    });
    const enrichedRowErrors = enrichIssuesWithEntityNames(rowLevelErrors, {
      dataElementNameById,
      orgUnitNameById,
    });
    const enrichedRowWarnings = enrichIssuesWithEntityNames(issueReport.warnings || [], {
      dataElementNameById,
      orgUnitNameById,
    });
    const counts = {
      events: payload.events ? payload.events.length : 0,
      enrollments: payload.enrollments ? payload.enrollments.length : 0,
      trackedEntities: payload.trackedEntities ? payload.trackedEntities.length : 0,
      aggregate: payload.dataValues ? payload.dataValues.length : 0,
    };

    const validationToken = issueValidationToken({
      sessionId,
      fingerprint: validationFingerprint,
      context: {
        dataType,
        options: validationOptions,
      },
    });

    addHistoryEntry(sessionId, {
      type: 'validation-run',
      status: finalValid ? 'success' : 'failed',
      mode: 'sync',
      dataType,
      count: counts.aggregate + counts.events + counts.enrollments + counts.trackedEntities,
      details: finalValid
        ? 'Validation completed successfully'
        : 'Validation completed with blocking issues',
      metadata: {
        errors: validation.errors?.length || 0,
        rowErrors: rowLevelErrors.length,
        warnings: validation.warnings?.length || 0,
        updateIdentityIssues: updateEventIssues.length,
        selectedModelIssues: selectedModelIssues.length,
        aggregateOptionIssues: aggregateOptionIssues.length,
        aggregateSubmissionDecisionIssues: aggregateSubmissionDecisionIssues.length,
        compatibilityBlockingIssues: compatibility?.blockingIssues?.length || 0,
        aggregateViolationCount: aggregateValidation?.violationCount || 0,
      },
    });

    const templateCompletionIntent = dataType === AGGREGATE_DATA_TYPE
      ? resolveTemplateSubmissionDecision(completionIntent)
      : null;

    res.json({
      valid: finalValid,
      errors: enrichedErrors,
      warnings: validation.warnings,
      rowIssues: toRowIssuePayload(
        enrichedRowErrors,
        enrichedRowWarnings,
      ),
      compatibility,
      aggregateValidation,
      completionPolicy: {
        completionAllowed,
        reason: completionAllowed
          ? 'Dataset validation passed'
          : 'Dataset validation has violations. Aggregate import can continue, but completion may require explicit confirmation.',
      },
      templateCompletionIntent,
      identityResolution: dataType !== AGGREGATE_DATA_TYPE
        ? countUidResolutions(rows, dataType, fileUidMapping)
        : null,
      validationToken,
      validationFingerprint,
      counts,
      preview: {
        events: payload.events ? payload.events.slice(0, 5) : [],
        enrollments: payload.enrollments ? payload.enrollments.slice(0, 5) : [],
        trackedEntities: payload.trackedEntities ? payload.trackedEntities.slice(0, 5) : [],
        aggregate: payload.dataValues ? payload.dataValues.slice(0, 5) : [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/aggregate/completion/check
 * Pre-check whether a dataset scope is already completed.
 */
router.post('/aggregate/completion/check', importLimiter, async (req, res, next) => {
  try {
    const scope = {
      dataSet: String(req.body?.dataSet || '').trim(),
      period: String(req.body?.period || '').trim(),
      orgUnit: String(req.body?.orgUnit || '').trim(),
      attributeOptionCombo: String(req.body?.attributeOptionCombo || '').trim(),
    };

    if (!scope.dataSet || !scope.period || !scope.orgUnit) {
      throw createAppError({
        status: 400,
        code: 'MISSING_COMPLETION_SCOPE',
        message: 'Completion scope requires dataSet, period, and orgUnit',
      });
    }

    await ensureSelectionAccess(req, {
      dataSetId: scope.dataSet,
      orgUnitIds: [scope.orgUnit],
    });

    const precheck = await getDataSetCompletionStatus(req, scope);
    return res.json({
      success: true,
      status: precheck.isCompleted ? 'already_completed' : 'not_completed',
      precheck,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/aggregate/completion
 * Explicitly complete or un-complete an aggregate dataset scope.
 */
router.post('/aggregate/completion', importLimiter, async (req, res, next) => {
  try {
    const action = String(req.body?.action || 'complete').toLowerCase();
    const scope = {
      dataSet: String(req.body?.dataSet || '').trim(),
      period: String(req.body?.period || '').trim(),
      orgUnit: String(req.body?.orgUnit || '').trim(),
      attributeOptionCombo: String(req.body?.attributeOptionCombo || '').trim(),
    };
    const completionDate = String(req.body?.completionDate || '').trim();

    if (!scope.dataSet || !scope.period || !scope.orgUnit) {
      throw createAppError({
        status: 400,
        code: 'MISSING_COMPLETION_SCOPE',
        message: 'Completion scope requires dataSet, period, and orgUnit',
      });
    }
    if (!['complete', 'uncomplete'].includes(action)) {
      throw createAppError({
        status: 400,
        code: 'INVALID_COMPLETION_ACTION',
        message: 'Invalid completion action',
        hint: 'Use complete or uncomplete.',
      });
    }

    await ensureSelectionAccess(req, {
      dataSetId: scope.dataSet,
      orgUnitIds: [scope.orgUnit],
    });

    const sessionId = req.authSession?.id || 'anonymous';

    if (action === 'complete') {
      const finalValidation = await runDataSetValidation(req, scope);
      addHistoryEntry(sessionId, {
        type: 'validation-run',
        status: finalValidation.violationCount > 0 ? 'failed' : 'success',
        mode: 'sync',
        dataType: AGGREGATE_DATA_TYPE,
        details: finalValidation.violationCount > 0
          ? `Dataset validation failed with ${finalValidation.violationCount} violation(s)`
          : 'Dataset validation passed with zero violations',
        metadata: {
          scope: finalValidation.scope,
          violationCount: finalValidation.violationCount,
          violations: finalValidation.violations,
          source: 'explicit-completion',
        },
      });

      if (finalValidation.violationCount > 0) {
        addHistoryEntry(sessionId, {
          type: 'completion',
          status: 'blocked',
          mode: 'sync',
          dataType: AGGREGATE_DATA_TYPE,
          details: 'Dataset completion blocked due to validation violations',
          metadata: {
            action,
            scope,
            violationCount: finalValidation.violationCount,
            violations: finalValidation.violations,
          },
        });

        return res.status(409).json({
          success: false,
          action,
          status: 'blocked',
          reason: 'validation-violations',
          validation: finalValidation,
        });
      }

      const response = await registerDataSetCompletion(req, scope, { completionDate });
      addHistoryEntry(sessionId, {
        type: 'completion',
        status: 'success',
        mode: 'sync',
        dataType: AGGREGATE_DATA_TYPE,
        details: 'Dataset completion registered in DHIS2',
        metadata: {
          action: 'complete',
          scope,
          completionDate,
        },
      });

      return res.json({
        success: true,
        action,
        status: 'registered',
        scope,
        response,
      });
    }

    const response = await unregisterDataSetCompletion(req, scope);
    addHistoryEntry(sessionId, {
      type: 'completion',
      status: 'success',
      mode: 'sync',
      dataType: AGGREGATE_DATA_TYPE,
      details: 'Dataset completion was unregistered in DHIS2',
      metadata: {
        action: 'uncomplete',
        scope,
      },
    });

    return res.json({
      success: true,
      action,
      status: 'unregistered',
      scope,
      response,
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
    const sessionId = req.authSession?.id || 'anonymous';
    const status = await getJobStatus(req, req.params.jobId);
    const normalizedStatus = status?.expired
      ? 'expired'
      : (status?.status?.toLowerCase?.() || (status?.hasBlockingErrors ? 'failed' : 'running'));

    const updated = updateHistoryByJobId(sessionId, req.params.jobId, {
      status: normalizedStatus,
      details: status?.expired
        ? 'Async import job status expired after retention TTL'
        : `Async import ${normalizedStatus}`,
    });

    if (!updated) {
      addHistoryEntry(sessionId, {
        type: 'import',
        status: normalizedStatus,
        mode: 'async',
        dataType: 'tracker',
        details: status?.expired
          ? 'Async import job status expired after retention TTL'
          : `Checked import job status for ${req.params.jobId}`,
        metadata: { jobId: req.params.jobId },
      });
    }

    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
