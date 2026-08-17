const crypto = require('crypto');

const UID_ALL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UID_FIRST_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DHIS2_UID_REGEX = /^[A-Za-z][A-Za-z0-9]{10}$/;

/**
 * Natural key for an aggregate data value — DHIS2 is idempotent on this key with CREATE_AND_UPDATE.
 */
function buildAggregateStableKey({
  dataSet = '',
  dataElement = '',
  period = '',
  orgUnit = '',
  categoryOptionCombo = '',
  attributeOptionCombo = '',
} = {}) {
  return [
    String(dataSet).trim(),
    String(dataElement).trim(),
    String(period).trim(),
    String(orgUnit).trim(),
    String(categoryOptionCombo).trim(),
    String(attributeOptionCombo).trim(),
  ].join('||');
}

/**
 * Natural key for a tracker event. Used to derive a deterministic UID and look up existing records.
 */
function buildEventStableKey({
  program = '',
  programStage = '',
  orgUnit = '',
  occurredAt = '',
  trackedEntity = '',
} = {}) {
  return [
    String(program).trim(),
    String(programStage).trim(),
    String(orgUnit).trim(),
    String(occurredAt).trim(),
    String(trackedEntity).trim(),
  ].filter(Boolean).join('||');
}

/**
 * Natural key for an enrollment.
 */
function buildEnrollmentStableKey({
  program = '',
  orgUnit = '',
  trackedEntity = '',
  enrolledAt = '',
  occurredAt = '',
} = {}) {
  return [
    String(program).trim(),
    String(orgUnit).trim(),
    String(trackedEntity).trim(),
    String(enrolledAt).trim(),
    String(occurredAt).trim(),
  ].filter(Boolean).join('||');
}

/**
 * Natural key for a tracked entity (type + org unit).
 */
function buildTrackedEntityStableKey({ trackedEntityType = '', orgUnit = '' } = {}) {
  return [String(trackedEntityType).trim(), String(orgUnit).trim()].filter(Boolean).join('||');
}

/**
 * Generate a deterministic 11-character DHIS2-compatible UID from a stable key.
 * The same stableKey always produces the same UID, enabling idempotent re-imports.
 */
function generateStableDhis2Uid(stableKey) {
  if (!stableKey) throw new Error('stableKey is required to generate a stable DHIS2 UID');
  const hash = crypto.createHash('sha256').update(String(stableKey), 'utf8').digest();
  let uid = UID_FIRST_CHARS[hash[0] % UID_FIRST_CHARS.length];
  for (let i = 1; i < 11; i++) {
    uid += UID_ALL_CHARS[hash[i] % UID_ALL_CHARS.length];
  }
  return uid;
}

/**
 * Compute a 16-hex-char fingerprint of a data row for change detection.
 */
function buildRowHash(row) {
  if (!row || typeof row !== 'object') return '';
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
  );
  return crypto.createHash('sha256').update(sorted, 'utf8').digest('hex').slice(0, 16);
}

/** True when an event row has enough fields to generate a deterministic UID. */
function isEventKeyComplete({ program, programStage, orgUnit, occurredAt } = {}) {
  return Boolean(program && programStage && orgUnit && occurredAt);
}

/** True when an enrollment row has enough fields to generate a deterministic UID. */
function isEnrollmentKeyComplete({ program, orgUnit, trackedEntity } = {}) {
  return Boolean(program && orgUnit && trackedEntity);
}

function isValidDhis2Uid(uid) {
  return typeof uid === 'string' && DHIS2_UID_REGEX.test(uid);
}

module.exports = {
  buildAggregateStableKey,
  buildEventStableKey,
  buildEnrollmentStableKey,
  buildTrackedEntityStableKey,
  generateStableDhis2Uid,
  buildRowHash,
  isEventKeyComplete,
  isEnrollmentKeyComplete,
  isValidDhis2Uid,
};
