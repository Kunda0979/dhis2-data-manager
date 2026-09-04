const { mapError } = require('../utils/apiError');

function toRowIssueFromDetails(details = {}, fallbackMessage = 'Request failed') {
  if (!details || typeof details !== 'object') return null;
  if (!details.field && !details.column && !details.row && !details.orgUnitId && !details.orgUnitName && !details.dataElement) {
    return null;
  }

  return {
    severity: 'error',
    row: details.row || '',
    field: details.field || '',
    column: details.column || '',
    message: details.message || fallbackMessage,
    suggestion: details.suggestion || '',
    orgUnit: details.orgUnitName || details.orgUnit || details.orgUnitId || '',
    orgUnitName: details.orgUnitName || details.orgUnit || '',
    orgUnitId: details.orgUnitId || '',
    dataElement: details.dataElement || '',
    dataElementName: details.dataElementName || '',
    period: details.period || '',
    value: details.value,
  };
}

/**
 * Global error handling middleware.
 */
function errorHandler(err, req, res, next) {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[Error]', err.message);
  const normalized = mapError(err, { isProd });

  const responseBody = { error: normalized };
  const isClientError = normalized.status >= 400 && normalized.status < 500;
  if (isClientError) {
    const details = normalized.details;
    const rowIssue = toRowIssueFromDetails(details, normalized.message || 'Request failed');
    if (rowIssue) {
      responseBody.rowIssues = {
        errors: [rowIssue],
        warnings: [],
      };
      responseBody.errors = [rowIssue];
    }
  }

  res.status(normalized.status).json(responseBody);
}

module.exports = errorHandler;
