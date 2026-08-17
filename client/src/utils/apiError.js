function toStringValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function normalizeApiError(err) {
  const payload = err?.response?.data
  const normalized = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : null

  const status = normalized?.status || err?.response?.status || 0
  const message = toStringValue(
    normalized?.message || payload?.message || payload?.error || err?.message,
    'Request failed',
  )

  const hint = toStringValue(
    normalized?.hint,
    status === 403
      ? 'Insufficient permission for this action.'
      : status === 401
        ? 'Reconnect your DHIS2 session and retry.'
        : /check import summary/i.test(String(message || ''))
          ? 'Open the import summary details to see the specific conflict and correct the affected row before retrying.'
          : 'Review your filters/options and retry.',
  )

  return {
    status,
    code: normalized?.code || 'REQUEST_FAILED',
    message,
    hint,
    details: normalized?.details,
    isPermissionError: status === 401 || status === 403,
  }
}

export function toUserErrorText(errorLike) {
  const err = errorLike?.message ? errorLike : normalizeApiError(errorLike)
  return err?.hint ? `${err.message} ${err.hint}` : err.message
}