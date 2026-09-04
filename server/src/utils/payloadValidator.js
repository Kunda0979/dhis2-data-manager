const UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const PERIOD_REGEX = /^(\d{4}|\d{6}|\d{4}Q[1-4]|\d{4}W\d{1,2}|\d{8})$/;

const VALID_EVENT_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'VISITED', 'SCHEDULE', 'OVERDUE', 'SKIPPED']);
const VALID_ENROLLMENT_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'CANCELLED']);

/**
 * Validate a DHIS2 import payload before import.
 * Returns { valid: boolean, errors: [], warnings: [] }
 */
function validateTrackerPayload(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'], warnings };
  }

  if (!payload.trackedEntities && !payload.enrollments && !payload.events && !payload.dataValues) {
    errors.push('Payload must contain at least one of: trackedEntities, enrollments, events, dataValues');
  }

  // Validate events — including status and duplicate UID detection
  const seenEventIds = new Set();
  if (Array.isArray(payload.events)) {
    payload.events.forEach((event, i) => {
      const prefix = `events[${i}]`;
      if (!event.program) errors.push(`${prefix}: missing required field 'program'`);
      else if (!isValidUid(event.program)) errors.push(`${prefix}: 'program' is not a valid UID`);

      if (!event.programStage) errors.push(`${prefix}: missing required field 'programStage'`);
      else if (!isValidUid(event.programStage)) errors.push(`${prefix}: 'programStage' is not a valid UID`);

      if (!event.orgUnit) errors.push(`${prefix}: missing required field 'orgUnit'`);
      else if (!isValidUid(event.orgUnit)) errors.push(`${prefix}: 'orgUnit' is not a valid UID`);

      if (event.status) {
        const upperStatus = String(event.status).toUpperCase();
        if (!VALID_EVENT_STATUSES.has(upperStatus)) {
          errors.push(`${prefix}: 'status' must be one of: ${[...VALID_EVENT_STATUSES].join(', ')}`);
        }
      }

      if (event.occurredAt && !isValidDate(event.occurredAt)) {
        errors.push(`${prefix}: 'occurredAt' is not a valid date (use YYYY-MM-DD or ISO datetime)`);
      }
      if (event.scheduledAt && !isValidDate(event.scheduledAt)) {
        warnings.push(`${prefix}: 'scheduledAt' may not be a valid date format`);
      }

      // Detect duplicate event UIDs
      const eventId = String(event.event || '').trim();
      if (eventId && eventId.toUpperCase() !== 'AUTO') {
        if (seenEventIds.has(eventId)) {
          errors.push(`${prefix}: duplicate event UID '${eventId}' found in the same payload`);
        } else {
          seenEventIds.add(eventId);
        }
      }
    });
  }

  // Validate enrollments
  if (Array.isArray(payload.enrollments)) {
    payload.enrollments.forEach((enrollment, i) => {
      const prefix = `enrollments[${i}]`;
      if (!enrollment.program) errors.push(`${prefix}: missing required field 'program'`);
      else if (!isValidUid(enrollment.program)) errors.push(`${prefix}: 'program' is not a valid UID`);

      if (!enrollment.orgUnit) errors.push(`${prefix}: missing required field 'orgUnit'`);
      else if (!isValidUid(enrollment.orgUnit)) errors.push(`${prefix}: 'orgUnit' is not a valid UID`);

      if (enrollment.enrolledAt && !isValidDate(enrollment.enrolledAt)) {
        errors.push(`${prefix}: 'enrolledAt' is not a valid date (use YYYY-MM-DD)`);
      }
      if (enrollment.occurredAt && !isValidDate(enrollment.occurredAt)) {
        warnings.push(`${prefix}: 'occurredAt' may not be a valid date format`);
      }
      if (enrollment.status) {
        const upperStatus = String(enrollment.status).toUpperCase();
        if (!VALID_ENROLLMENT_STATUSES.has(upperStatus)) {
          warnings.push(`${prefix}: 'status' is not a recognized enrollment status`);
        }
      }
    });
  }

  // Validate tracked entities
  if (Array.isArray(payload.trackedEntities)) {
    payload.trackedEntities.forEach((te, i) => {
      const prefix = `trackedEntities[${i}]`;
      if (!te.trackedEntityType) errors.push(`${prefix}: missing required field 'trackedEntityType'`);
      else if (!isValidUid(te.trackedEntityType)) errors.push(`${prefix}: 'trackedEntityType' is not a valid UID`);

      if (!te.orgUnit) errors.push(`${prefix}: missing required field 'orgUnit'`);
      else if (!isValidUid(te.orgUnit)) errors.push(`${prefix}: 'orgUnit' is not a valid UID`);
    });
  }

  // Validate aggregate data values — period is an error, duplicates are detected
  if (Array.isArray(payload.dataValues)) {
    const seenDvKeys = new Map();

    payload.dataValues.forEach((dataValue, i) => {
      const prefix = `dataValues[${i}]`;
      if (!dataValue.dataElement) errors.push(`${prefix}: missing required field 'dataElement'`);
      else if (!isValidUid(dataValue.dataElement)) errors.push(`${prefix}: 'dataElement' is not a valid UID`);

      if (!dataValue.orgUnit) errors.push(`${prefix}: missing required field 'orgUnit'`);
      else if (!isValidUid(dataValue.orgUnit)) errors.push(`${prefix}: 'orgUnit' is not a valid UID`);

      // Invalid period format is an error, not a warning
      if (!dataValue.period) errors.push(`${prefix}: missing required field 'period'`);
      else if (!isValidPeriod(dataValue.period)) errors.push(`${prefix}: 'period' is not a valid DHIS2 period format (got: '${dataValue.period}')`);

      if (dataValue.categoryOptionCombo && !isValidUid(dataValue.categoryOptionCombo)) {
        errors.push(`${prefix}: 'categoryOptionCombo' is not a valid UID`);
      }

      if (dataValue.attributeOptionCombo && !isValidUid(dataValue.attributeOptionCombo)) {
        errors.push(`${prefix}: 'attributeOptionCombo' is not a valid UID`);
      }

      if (dataValue.value === undefined || dataValue.value === null || String(dataValue.value).trim() === '') {
        errors.push(`${prefix}: missing required field 'value'`);
      }

      if (dataValue.storedBy) {
        warnings.push(`${prefix}: 'storedBy' will be overridden by DHIS2 with the authenticated user`);
      }

      // Detect duplicate and conflicting data values using composite key
      const dvKey = [
        String(dataValue.dataElement || ''),
        String(dataValue.period || ''),
        String(dataValue.orgUnit || ''),
        String(dataValue.categoryOptionCombo || ''),
        String(dataValue.attributeOptionCombo || ''),
      ].join('||');

      if (seenDvKeys.has(dvKey)) {
        const prior = seenDvKeys.get(dvKey);
        const priorValue = String(prior.value ?? '').trim();
        const currentValue = String(dataValue.value ?? '').trim();
        if (priorValue !== currentValue) {
          errors.push(`${prefix}: conflicting duplicate — same dataElement+period+orgUnit+coc+aoc as dataValues[${prior.index}] but different value ('${currentValue}' vs '${priorValue}')`);
        } else {
          warnings.push(`${prefix}: duplicate data value (same key as dataValues[${prior.index}])`);
        }
      } else {
        seenDvKeys.set(dvKey, { index: i, value: dataValue.value });
      }
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a value against an expected DHIS2 value type.
 * Returns an error string if invalid, or null if valid or type is unknown.
 */
function validateValueType(value, valueType) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = String(value).trim();
  const type = String(valueType || '').toUpperCase();

  switch (type) {
    case 'INTEGER': {
      if (!/^-?\d+$/.test(v)) return 'must be a whole number';
      return null;
    }
    case 'INTEGER_POSITIVE': {
      if (!/^-?\d+$/.test(v) || Number(v) <= 0) return 'must be a positive integer (> 0)';
      return null;
    }
    case 'INTEGER_ZERO_OR_POSITIVE': {
      if (!/^-?\d+$/.test(v) || Number(v) < 0) return 'must be zero or a positive integer (>= 0)';
      return null;
    }
    case 'INTEGER_NEGATIVE': {
      if (!/^-?\d+$/.test(v) || Number(v) >= 0) return 'must be a negative integer (< 0)';
      return null;
    }
    case 'NUMBER':
    case 'UNIT_INTERVAL':
    case 'AGE':
    case 'PERCENTAGE': {
      if (isNaN(Number(v))) return 'must be a numeric value';
      return null;
    }
    case 'BOOLEAN': {
      if (!['true', 'false'].includes(v.toLowerCase())) return 'must be true or false';
      return null;
    }
    case 'TRUE_ONLY': {
      if (v.toLowerCase() !== 'true') return 'must be true only';
      return null;
    }
    case 'DATE': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'must be in YYYY-MM-DD format';
      return null;
    }
    case 'DATETIME': {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return 'must be in ISO datetime format (YYYY-MM-DDThh:mm...)';
      return null;
    }
    default:
      return null;
  }
}

/**
 * Returns true when an import report contains blocking errors that should prevent completion.
 */
function hasBlockingImportErrors(importReport) {
  if (!importReport) return false;

  const status = String(importReport?.status || '').toUpperCase();
  if (status === 'ERROR' || status === 'FAILED' || status === 'FAILURE') return true;

  if (Array.isArray(importReport.errors) && importReport.errors.length > 0) return true;

  const stats = importReport.stats || {};
  if (Number(stats.failed || 0) > 0) return true;
  if (Number(stats.ignored || 0) > 0) return true;

  if (Array.isArray(importReport.conflicts) && importReport.conflicts.length > 0) return true;

  return Boolean(importReport.hasBlockingErrors);
}

function isValidUid(uid) {
  return typeof uid === 'string' && UID_REGEX.test(uid);
}

function isValidDate(date) {
  return typeof date === 'string' && DATE_REGEX.test(date);
}

function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_REGEX.test(period);
}

module.exports = {
  validateTrackerPayload,
  hasBlockingImportErrors,
  validateValueType,
  isValidUid,
  isValidDate,
  isValidPeriod,
};
