const UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

/**
 * Validate a full tracker payload before import.
 * Returns { valid: boolean, errors: [], warnings: [] }
 */
function validateTrackerPayload(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'], warnings };
  }

  if (!payload.trackedEntities && !payload.enrollments && !payload.events) {
    errors.push('Payload must contain at least one of: trackedEntities, enrollments, events');
  }

  // Validate events
  if (Array.isArray(payload.events)) {
    payload.events.forEach((event, i) => {
      const prefix = `events[${i}]`;
      if (!event.program) errors.push(`${prefix}: missing required field 'program'`);
      else if (!isValidUid(event.program)) errors.push(`${prefix}: 'program' is not a valid UID`);

      if (!event.programStage) errors.push(`${prefix}: missing required field 'programStage'`);
      else if (!isValidUid(event.programStage)) errors.push(`${prefix}: 'programStage' is not a valid UID`);

      if (!event.orgUnit) errors.push(`${prefix}: missing required field 'orgUnit'`);
      else if (!isValidUid(event.orgUnit)) errors.push(`${prefix}: 'orgUnit' is not a valid UID`);

      if (event.occurredAt && !isValidDate(event.occurredAt)) {
        warnings.push(`${prefix}: 'occurredAt' may not be a valid date format`);
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

  return { valid: errors.length === 0, errors, warnings };
}

function isValidUid(uid) {
  return typeof uid === 'string' && UID_REGEX.test(uid);
}

function isValidDate(date) {
  return typeof date === 'string' && DATE_REGEX.test(date);
}

module.exports = { validateTrackerPayload, isValidUid, isValidDate };
