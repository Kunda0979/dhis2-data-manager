const UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export function isValidUid(uid) {
  return typeof uid === 'string' && UID_REGEX.test(uid)
}

export function isValidDate(date) {
  return typeof date === 'string' && DATE_REGEX.test(date)
}

export function validateUids(uids) {
  return uids.filter((uid) => !isValidUid(uid))
}

/**
 * Validate a flat data row before building a tracker payload.
 */
export function validateRow(row, requiredFields) {
  const errors = []
  for (const field of requiredFields) {
    if (!row[field]) {
      errors.push(`Missing required field: ${field}`)
    }
  }
  return errors
}

/**
 * Get required fields for each data type.
 */
export const REQUIRED_FIELDS = {
  events: ['program', 'programStage', 'orgUnit'],
  enrollments: ['program', 'orgUnit'],
  trackedEntities: ['trackedEntityType', 'orgUnit'],
  aggregate: ['dataElement', 'period', 'orgUnit', 'value'],
}
