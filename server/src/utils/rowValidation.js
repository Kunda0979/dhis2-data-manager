const { isValidUid, isValidDate } = require('./payloadValidator');

const REQUIRED_FIELDS_BY_TYPE = {
  events: ['program', 'programStage', 'orgUnit'],
  enrollments: ['program', 'orgUnit'],
  trackedEntities: ['trackedEntityType', 'orgUnit'],
};

function getColumnNameForField(field, mapping) {
  return mapping[field] || field;
}

function addIssue(target, issue) {
  target.push(issue);
}

function buildIssueReport(rows = [], mapping = {}, dataType = 'events') {
  const errors = [];
  const warnings = [];
  const seenIdentity = new Set();
  const requiredFields = REQUIRED_FIELDS_BY_TYPE[dataType] || [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const mappedValue = (field) => {
      const col = getColumnNameForField(field, mapping);
      return row[col] !== undefined ? row[col] : row[field];
    };

    for (const field of requiredFields) {
      const value = mappedValue(field);
      if (!value || String(value).trim() === '') {
        addIssue(errors, {
          severity: 'error',
          row: rowNumber,
          field,
          column: getColumnNameForField(field, mapping),
          message: `Missing required value for ${field}`,
        });
      } else if (['program', 'programStage', 'orgUnit', 'trackedEntityType'].includes(field) && !isValidUid(String(value))) {
        addIssue(errors, {
          severity: 'error',
          row: rowNumber,
          field,
          column: getColumnNameForField(field, mapping),
          message: `${field} is not a valid DHIS2 UID`,
        });
      }
    }

    const occurredAt = mappedValue('occurredAt') || mappedValue('eventDate');
    if (occurredAt && !isValidDate(String(occurredAt))) {
      addIssue(warnings, {
        severity: 'warning',
        row: rowNumber,
        field: 'occurredAt',
        column: getColumnNameForField('occurredAt', mapping),
        message: 'Possible invalid date format',
      });
    }

    const identity = [
      mappedValue('event') || '',
      mappedValue('enrollment') || '',
      mappedValue('trackedEntity') || '',
      mappedValue('program') || '',
      mappedValue('programStage') || '',
      mappedValue('orgUnit') || '',
    ].join('|');

    if (identity.replace(/\|/g, '').length > 0) {
      if (seenIdentity.has(identity)) {
        addIssue(warnings, {
          severity: 'warning',
          row: rowNumber,
          field: 'duplicate',
          column: '',
          message: 'Potential duplicate row identity',
        });
      } else {
        seenIdentity.add(identity);
      }
    }
  });

  return {
    errors,
    warnings,
    summary: {
      totalRows: rows.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}

module.exports = {
  buildIssueReport,
};
