/**
 * Build a DHIS2 tracker payload from flat row data.
 * Supports building events, enrollments, and tracked entities.
 *
 * @param {Array} rows - flat data rows (from CSV/Excel)
 * @param {object} mapping - column mapping { dhis2Field: columnName }
 * @param {string} dataType - 'events' | 'enrollments' | 'trackedEntities'
 */
function buildTrackerPayload(rows, mapping, dataType) {
  const payload = {
    trackedEntities: [],
    enrollments: [],
    events: [],
  };

  for (const row of rows) {
    const mapped = applyMapping(row, mapping);

    if (dataType === 'events') {
      payload.events.push(buildEvent(mapped));
    } else if (dataType === 'enrollments') {
      payload.enrollments.push(buildEnrollment(mapped));
    } else if (dataType === 'trackedEntities') {
      payload.trackedEntities.push(buildTrackedEntity(mapped));
    }
  }

  return payload;
}

/**
 * Convert a raw tracker payload (JSON import) to the correct structure.
 */
function convertToTracker(rawPayload) {
  if (rawPayload.trackedEntities || rawPayload.enrollments || rawPayload.events) {
    return rawPayload;
  }
  // If it's an array, assume it's events
  if (Array.isArray(rawPayload)) {
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
    event: row.event || undefined,
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

module.exports = { buildTrackerPayload, convertToTracker };
