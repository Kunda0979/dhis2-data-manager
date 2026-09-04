const { isValidUid, isValidDate, isValidPeriod } = require('./payloadValidator');

const REQUIRED_FIELDS_BY_TYPE = {
  events: ['program', 'programStage', 'orgUnit'],
  enrollments: ['program', 'orgUnit'],
  trackedEntities: ['trackedEntityType', 'orgUnit'],
  aggregate: ['dataElement', 'period', 'orgUnit', 'value'],
};

function parseAggregateFieldKey(fieldKey) {
  if (typeof fieldKey !== 'string') return null;
  const match = fieldKey.match(/^de_([A-Za-z0-9]{11})(?:__coc_([A-Za-z0-9]{11}))?(?:__(.+))?$/);
  if (!match) return null;
  return {
    dataElement: match[1],
    categoryOptionCombo: match[2] || '',
    label: String(match[3] || '').replace(/_/g, ' ').trim(),
  };
}

function collectAggregateValueCells(row = {}) {
  const cells = [];
  for (const [key, value] of Object.entries(row || {})) {
    const parsed = parseAggregateFieldKey(key);
    if (!parsed) continue;
    cells.push({
      key,
      value,
      ...parsed,
    });
  }
  return cells;
}

function getColumnNameForField(field, mapping) {
  return mapping[field] || field;
}

function addIssue(target, issue) {
  target.push(issue);
}

function buildRowContext(mappedValue) {
  const mappedDataElementName = mappedValue('dataElementName') || mappedValue('dataElementDisplayName') || '';
  return {
    dataElement: mappedValue('dataElement') || '',
    dataElementName: String(mappedDataElementName || '').trim(),
    orgUnit: mappedValue('orgUnit') || '',
    period: mappedValue('period') || '',
    categoryOptionCombo: mappedValue('categoryOptionCombo') || '',
    attributeOptionCombo: mappedValue('attributeOptionCombo') || '',
    value: mappedValue('value') ?? '',
    program: mappedValue('program') || '',
    programStage: mappedValue('programStage') || '',
    trackedEntityType: mappedValue('trackedEntityType') || '',
    event: mappedValue('event') || '',
    enrollment: mappedValue('enrollment') || '',
    trackedEntity: mappedValue('trackedEntity') || '',
  };
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
    const rowContext = buildRowContext(mappedValue);
    const aggregateCells = dataType === 'aggregate' ? collectAggregateValueCells(row) : [];
    const isAggregateWideRow = dataType === 'aggregate' && aggregateCells.length > 0;

    const requiredFieldsForRow = isAggregateWideRow
      ? ['period', 'orgUnit']
      : requiredFields;

    for (const field of requiredFieldsForRow) {
      const value = mappedValue(field);
      if (!value || String(value).trim() === '') {
        addIssue(errors, {
          severity: 'error',
          row: rowNumber,
          field,
          column: getColumnNameForField(field, mapping),
          message: `Missing required value for ${field}`,
          value: value ?? '',
          ...rowContext,
        });
      } else if (['program', 'programStage', 'orgUnit', 'trackedEntityType', 'dataElement', 'categoryOptionCombo', 'attributeOptionCombo'].includes(field) && !isValidUid(String(value))) {
        addIssue(errors, {
          severity: 'error',
          row: rowNumber,
          field,
          column: getColumnNameForField(field, mapping),
          message: `${field} is not a valid DHIS2 UID`,
          value: value ?? '',
          ...rowContext,
        });
      }
    }

    // Wide aggregate templates can contain untouched rows by design.
    // Empty value rows are ignored during payload construction and should not be flagged.

    const occurredAt = mappedValue('occurredAt') || mappedValue('eventDate');
    if (occurredAt && !isValidDate(String(occurredAt))) {
      addIssue(warnings, {
        severity: 'warning',
        row: rowNumber,
        field: 'occurredAt',
        column: getColumnNameForField('occurredAt', mapping),
        message: 'Possible invalid date format',
        value: occurredAt,
        ...rowContext,
      });
    }

    const period = mappedValue('period');
    if (period && !isValidPeriod(String(period))) {
      addIssue(warnings, {
        severity: 'warning',
        row: rowNumber,
        field: 'period',
        column: getColumnNameForField('period', mapping),
        message: 'Possible invalid DHIS2 period format',
        value: period,
        ...rowContext,
      });
    }

    const identity = [
      mappedValue('event') || '',
      mappedValue('enrollment') || '',
      mappedValue('trackedEntity') || '',
      mappedValue('dataElement') || '',
      mappedValue('period') || '',
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
          ...rowContext,
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
