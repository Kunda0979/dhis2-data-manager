const rateLimit = require('express-rate-limit');

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildLimiter(windowMinutes, maxRequests, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: maxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });
}

const connectLimiter = buildLimiter(
  parsePositiveInt(process.env.RATE_LIMIT_CONNECT_WINDOW_MIN, 15),
  parsePositiveInt(process.env.RATE_LIMIT_CONNECT_MAX, 30),
  'Too many connection attempts. Please try again later.',
);

const importLimiter = buildLimiter(
  parsePositiveInt(process.env.RATE_LIMIT_IMPORT_WINDOW_MIN, 15),
  parsePositiveInt(process.env.RATE_LIMIT_IMPORT_MAX, 60),
  'Too many import requests. Please try again later.',
);

module.exports = {
  connectLimiter,
  importLimiter,
};
