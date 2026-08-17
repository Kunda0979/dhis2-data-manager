const rateLimit = require('express-rate-limit');

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildLimiter(windowMinutes, maxRequests, message, options = {}) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: maxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    ...options,
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

const exportLimiter = buildLimiter(
  parsePositiveInt(process.env.RATE_LIMIT_EXPORT_WINDOW_MIN, 15),
  parsePositiveInt(process.env.RATE_LIMIT_EXPORT_MAX, 90),
  'Too many export requests from this session. Please wait and try again.',
  {
    keyGenerator: (req) => req.authSession?.id || req.authToken || req.ip,
  },
);

module.exports = {
  connectLimiter,
  importLimiter,
  exportLimiter,
};
