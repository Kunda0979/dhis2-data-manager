const crypto = require('crypto');

const tokens = new Map();
const VALIDATION_TOKEN_TTL_MINUTES = parseInt(process.env.VALIDATION_TOKEN_TTL_MINUTES || '0', 10);

function getTokenTtlMs() {
  if (!Number.isFinite(VALIDATION_TOKEN_TTL_MINUTES) || VALIDATION_TOKEN_TTL_MINUTES <= 0) {
    return null;
  }
  return VALIDATION_TOKEN_TTL_MINUTES * 60 * 1000;
}

function issueValidationToken({ sessionId, fingerprint, context = {} }) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const ttlMs = getTokenTtlMs();

  tokens.set(token, {
    token,
    sessionId,
    fingerprint,
    context,
    createdAt: new Date(now).toISOString(),
    expiresAt: ttlMs ? new Date(now + ttlMs).toISOString() : null,
  });

  return token;
}

function verifyValidationToken({ token, sessionId, fingerprint }) {
  if (!token) {
    return { valid: false, reason: 'missing-token' };
  }

  const record = tokens.get(token);
  if (!record) {
    return { valid: false, reason: 'unknown-token' };
  }

  if (record.sessionId !== sessionId) {
    return { valid: false, reason: 'session-mismatch' };
  }

  if (record.expiresAt && Date.now() > Date.parse(record.expiresAt)) {
    tokens.delete(token);
    return { valid: false, reason: 'expired-token' };
  }

  if (record.fingerprint !== fingerprint) {
    return { valid: false, reason: 'fingerprint-mismatch' };
  }

  // Keep the session import flow smooth by extending token life after each valid check.
  const ttlMs = getTokenTtlMs();
  if (ttlMs) {
    record.expiresAt = new Date(Date.now() + ttlMs).toISOString();
    tokens.set(token, record);
  }

  return {
    valid: true,
    reason: 'ok',
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    context: record.context,
  };
}

module.exports = {
  issueValidationToken,
  verifyValidationToken,
};
