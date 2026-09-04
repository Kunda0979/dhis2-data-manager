const crypto = require('crypto');

/**
 * Build a DHIS2 import payload from flat row data.
 * Supports tracker payloads plus aggregate data value sets.
 *
 * @param {Array} rows - flat data rows (from CSV/Excel)
 * @param {object} mapping - column mapping { dhis2Field: columnName }
 * @param {string} dataType - 'events' | 'enrollments' | 'trackedEntities' | 'aggregate'
 */
function buildTrackerPayload(rows, mapping, dataType) {
  const payload = {
    trackedEntities: [],
    enrollments: [],
    events: [],
    dataValues: [],
  };

  for (const row of rows) {
    const mapped = applyMapping(row, mapping);

    if (dataType === 'events') {
      payload.events.push(buildEvent(mapped));
    } else if (dataType === 'enrollments') {
      payload.enrollments.push(buildEnrollment(mapped));
    } else if (dataType === 'trackedEntities') {
      payload.trackedEntities.push(buildTrackedEntity(mapped));
    } else if (dataType === 'aggregate') {
      payload.dataValues.push(...buildAggregateDataValuesFromRow(mapped));
    }
  }

  return payload;
}

/**
 * Convert a raw JSON payload to the correct DHIS2 import structure.
 */
function convertToTracker(rawPayload, dataType = 'events') {
  if (rawPayload.trackedEntities || rawPayload.enrollments || rawPayload.events || rawPayload.dataValues) {
    return rawPayload;
  }
  // If it's an array, use the selected type to place the rows.
  if (Array.isArray(rawPayload)) {
    if (dataType === 'aggregate') {
      return { dataValues: rawPayload };
    }
    return { events: rawPayload };
  }
  return rawPayload;
}

function applyMapping(row, mapping) {
  const result = Object.create(null);
  for (const [dhis2Field, colName] of Object.entries(mapping)) {
    if (!isSafeObjectKey(dhis2Field)) continue;
    result[dhis2Field] = row[colName] !== undefined ? row[colName] : row[dhis2Field];
  }
  // Also copy any unmapped fields
  for (const [key, val] of Object.entries(row)) {
    if (!isSafeObjectKey(key)) continue;
    if (!(key in result)) result[key] = val;
  }
  return result;
}

function isSafeObjectKey(key) {
  return !['__proto__', 'constructor', 'prototype'].includes(key);
}

const DHIS2_UID_LENGTH = 11;
const DHIS2_UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/;

function generateDhis2Uid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const firstChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  let uid = firstChars[crypto.randomInt(firstChars.length)];
  for (let i = 1; i < DHIS2_UID_LENGTH; i += 1) {
    uid += chars[crypto.randomInt(chars.length)];
  }
  return uid;
}

function resolveEventId(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toUpperCase() === 'AUTO' || raw.toUpperCase() === 'AUTO-GENERATED') {
    return generateDhis2Uid();
  }
  if (DHIS2_UID_REGEX.test(raw)) return raw;
  return generateDhis2Uid();
}

function parseTrackedIdFromKey(key, prefix) {
  if (typeof key !== 'string') return null;
  if (!key.startsWith(`${prefix}_`)) return null;
  const rest = key.slice(prefix.length + 1);
  const rawId = rest.split('__')[0];
  return /^[A-Za-z0-9]{11}$/.test(rawId) ? rawId : null;
}

function buildEvent(row) {
  const dataValues = [];
  for (const [key, value] of Object.entries(row)) {
    const dataElementId = parseTrackedIdFromKey(key, 'de');
    if (dataElementId || (key.length === DHIS2_UID_LENGTH && /^[A-Za-z0-9]+$/.test(key))) {
      const dataElement = dataElementId || key;
      dataValues.push({ dataElement, value });
    }
  }

  return {
    event: resolveEventId(row.event),
    status: row.status || 'ACTIVE',
    program: row.program,
    programStage: row.programStage,
    orgUnit: row.orgUnit,
    occurredAt: row.occurredAt || row.eventDate,
    scheduledAt: row.scheduledAt,
    enrollment: row.enrollment,
    trackedEntity: row.trackedEntity,
    dataValues,
  };
}

function buildEnrollment(row) {
  return {
    enrollment: row.enrollment || undefined,
    trackedEntity: row.trackedEntity,
    program: row.program,
    orgUnit: row.orgUnit,
    enrolledAt: row.enrolledAt || row.enrollmentDate,
    occurredAt: row.occurredAt || row.incidentDate,
    status: row.status || 'ACTIVE',
  };
}

function buildTrackedEntity(row) {
  const attributes = [];
  for (const [key, value] of Object.entries(row)) {
    const attrId = parseTrackedIdFromKey(key, 'attr');
    const teaId = parseTrackedIdFromKey(key, 'tea');
    if (attrId || teaId) {
      const attribute = attrId || teaId;
      attributes.push({ attribute, value });
    }
  }

  return {
    trackedEntity: row.trackedEntity || undefined,
    trackedEntityType: row.trackedEntityType,
    orgUnit: row.orgUnit,
    attributes,
  };
}

function buildDataValue(row) {
  return {
    dataElement: row.dataElement,
    period: row.period,
    orgUnit: row.orgUnit,
    categoryOptionCombo: row.categoryOptionCombo || row.coc || undefined,
    attributeOptionCombo: row.attributeOptionCombo || row.aoc || undefined,
    value: row.value,
    comment: row.comment || undefined,
    storedBy: row.storedBy || undefined,
  };
}

function parseAggregateDataElementKey(key) {
  if (typeof key !== 'string') return null;
  const match = key.match(/^de_([A-Za-z0-9]{11})(?:__coc_([A-Za-z0-9]{11}))?(?:__.*)?$/);
  if (!match) return null;

  return {
    dataElement: match[1],
    categoryOptionCombo: match[2] || null,
  };
}

function buildAggregateDataValuesFromRow(row) {
  if (!row || typeof row !== 'object') return [];

  // Backwards-compatible long format row.
  if (String(row.dataElement || '').trim()) {
    const legacy = buildDataValue(row);
    if (legacy.value === undefined || legacy.value === null || String(legacy.value).trim() === '') {
      return [];
    }
    return [legacy];
  }

  const values = [];
  const period = row.period;
  const orgUnit = row.orgUnit;
  const attributeOptionCombo = row.attributeOptionCombo || row.aoc || undefined;
  const fallbackCategoryOptionCombo = row.categoryOptionCombo || row.coc || undefined;

  for (const [key, rawValue] of Object.entries(row)) {
    const parsed = parseAggregateDataElementKey(key);
    if (!parsed) continue;
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;

    values.push({
      dataElement: parsed.dataElement,
      period,
      orgUnit,
      categoryOptionCombo: parsed.categoryOptionCombo || fallbackCategoryOptionCombo,
      attributeOptionCombo,
      value: rawValue,
      comment: row.comment || undefined,
      storedBy: row.storedBy || undefined,
    });
  }

  return values;
}

module.exports = { buildTrackerPayload, convertToTracker };
