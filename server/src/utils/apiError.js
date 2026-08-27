function buildApiError({
  status = 500,
  code = 'INTERNAL_ERROR',
  message = 'Unexpected server error',
  hint = 'Retry the request or contact your administrator if the issue persists.',
  details,
}) {
  return {
    status,
    code,
    message,
    hint,
    details,
  };
}

function createAppError({
  status = 400,
  code = 'BAD_REQUEST',
  message,
  hint,
  details,
}) {
  const err = new Error(message || 'Request failed');
  err.status = status;
  err.code = code;
  err.hint = hint;
  err.details = details;
  return err;
}

function inferHint(status, message = '', details = {}) {
  const lower = String(message || '').toLowerCase();
  const detailText = typeof details === 'string'
    ? details.toLowerCase()
    : JSON.stringify(details || {}).toLowerCase();

  if (lower.includes('check import summary')) {
    return 'DHIS2 returned import errors. Open the import summary details to see the exact conflict (data element, org unit, period) and retry after correction.';
  }

  if (status === 401) {
    return 'Reconnect your DHIS2 session and verify your credentials.';
  }
  if (status === 403) {
    return 'Your account lacks permission for this action. Ask a DHIS2 administrator to grant the required access.';
  }
  if (status === 404) {
    return 'The selected DHIS2 resource was not found or is not visible to your account.';
  }
  if (status === 413 || lower.includes('limit') || lower.includes('too large') || detailText.includes('too large')) {
    return 'The request scope is too large. Narrow your org unit, program, dataset, or date range and try again.';
  }
  if (lower.includes('permission') || detailText.includes('permission') || lower.includes('forbidden')) {
    return 'Your account lacks permission for this action. Ask a DHIS2 administrator to grant the required access.';
  }
  if (lower.includes('template') || detailText.includes('template') || lower.includes('schema')) {
    return 'Template mismatch detected. Re-download the latest template and retry.';
  }
  if (lower.includes('program') && lower.includes('required')) {
    return 'Select a program filter before exporting tracker data.';
  }
  if (status >= 500) {
    return 'DHIS2 server is unavailable or returned an internal error. Retry shortly.';
  }
  return 'Review your selected filters and permissions, then retry.';
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractFirstImportConflictMessage(data = {}) {
  const candidates = [];
  const importSummaries = Array.isArray(data?.response?.importSummaries)
    ? data.response.importSummaries
    : Array.isArray(data?.importSummaries)
      ? data.importSummaries
      : [];

  for (const summary of importSummaries) {
    const conflicts = Array.isArray(summary?.conflicts) ? summary.conflicts : [];
    for (const conflict of conflicts) {
      const text = firstNonEmptyText(
        conflict?.value,
        conflict?.object,
        conflict?.message,
        conflict?.description,
      );
      if (text) candidates.push(text);
    }
  }

  const rootConflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
  for (const conflict of rootConflicts) {
    const text = firstNonEmptyText(
      conflict?.value,
      conflict?.object,
      conflict?.message,
      conflict?.description,
    );
    if (text) candidates.push(text);
  }

  const firstReport = Array.isArray(data?.response?.errorReports) ? data.response.errorReports[0] : null;
  if (firstReport) {
    const text = firstNonEmptyText(firstReport?.message, firstReport?.description);
    if (text) candidates.push(text);
  }

  return candidates.find(Boolean) || '';
}

function getErrorMessage(err) {
  if (!err) return 'Unexpected server error';
  if (typeof err === 'string') return err || 'Unexpected server error';
  if (err instanceof Error) return err.message || 'Unexpected server error';
  if (typeof err.message === 'string' && err.message.trim()) return err.message;
  if (typeof err.error === 'string' && err.error.trim()) return err.error;
  if (err?.response?.data && typeof err.response.data === 'string' && err.response.data.trim()) {
    return err.response.data;
  }
  if (err?.response?.data && typeof err?.response?.data?.message === 'string' && err.response.data.message.trim()) {
    return err.response.data.message;
  }
  return 'Unexpected server error';
}

function mapError(err, { isProd = true } = {}) {
  const networkError = err?.isAxiosError && !err?.response;
  if (networkError) {
    return buildApiError({
      status: 502,
      code: 'DHIS2_NETWORK_ERROR',
      message: 'Unable to reach DHIS2 server',
      hint: 'Check DHIS2 URL/network connectivity and retry.',
      details: isProd ? undefined : {
        code: err.code,
        message: err.message,
      },
    });
  }

  if (err?.response) {
    const status = err.response.status || 500;
    const data = err.response.data;
    const baseMessage = typeof data === 'string'
      ? data
      : data?.message || data?.description || data?.httpStatus || 'DHIS2 API request failed';
    const firstConflict = typeof data === 'string' ? '' : extractFirstImportConflictMessage(data);
    const message = firstConflict
      ? `${baseMessage} First issue: ${firstConflict}`
      : baseMessage;

    return buildApiError({
      status,
      code: status === 401
        ? 'DHIS2_UNAUTHORIZED'
        : status === 403
          ? 'DHIS2_FORBIDDEN'
          : status === 404
            ? 'DHIS2_NOT_FOUND'
            : status >= 500
              ? 'DHIS2_SERVER_ERROR'
              : 'DHIS2_API_ERROR',
      message,
      hint: inferHint(status, message, data),
      details: isProd ? undefined : data,
    });
  }

  if (err?.status) {
    const includeDetails = err.status < 500;
    return buildApiError({
      status: err.status,
      code: err.code || (err.status === 403 ? 'INSUFFICIENT_PERMISSION' : 'REQUEST_FAILED'),
      message: err.message || 'Request failed',
      hint: err.hint || inferHint(err.status, err.message, err.details),
      details: includeDetails ? err.details : (isProd ? undefined : err.details),
    });
  }

  const fallbackMessage = getErrorMessage(err);
  return buildApiError({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
    hint: 'Retry the request. If it keeps failing, contact support.',
    details: isProd ? undefined : { message: err?.message, stack: err?.stack },
  });
}

module.exports = {
  buildApiError,
  createAppError,
  mapError,
};