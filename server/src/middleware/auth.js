/**
 * Middleware to validate that DHIS2 connection headers are present.
 *
 * Authentication priority order:
 *  1. HttpOnly signed cookie `dm_sid` (primary, used in production / DHIS2 app context)
 *  2. Bearer token in Authorization header (fallback for dev/testing)
 *  3. Explicit x-dhis2-* headers (legacy / direct API testing)
 */
const { normalizeDhis2BaseUrl } = require('../utils/security');
const { getSessionByToken, getActiveCredentials } = require('../services/sessionService');
const { getSessionCookie } = require('../utils/sessionCookie');

function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function resolveSessionToken(req) {
  // 1. Cookie (preferred, HttpOnly)
  const cookieToken = getSessionCookie(req);
  if (cookieToken) return cookieToken;
  // 2. Bearer header (dev / testing fallback)
  return extractBearerToken(req);
}

function requireDhis2Credentials(req, res, next) {
  const sessionToken = resolveSessionToken(req);

  if (sessionToken) {
    const session = getSessionByToken(sessionToken);
    if (!session) {
      return res.status(401).json({
        error: 'Invalid session',
        message: 'Please reconnect to DHIS2',
      });
    }

    const credentials = getActiveCredentials(session);
    if (!credentials) {
      return res.status(401).json({
        error: 'No active profile',
        message: 'Please connect and select an active DHIS2 profile',
      });
    }

    req.authToken = sessionToken;
    req.authSession = session;
    req.dhis2Credentials = credentials;
    return next();
  }

  const rawUrl = req.headers['x-dhis2-url'];
  const username = req.headers['x-dhis2-username'];
  const password = req.headers['x-dhis2-password'];

  if (!rawUrl || !username || !password) {
    return res.status(401).json({
      error: 'Missing DHIS2 credentials',
      message: 'Please provide x-dhis2-url, x-dhis2-username, and x-dhis2-password headers',
    });
  }

  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 256 || password.length > 1024) {
    return res.status(400).json({
      error: 'Invalid DHIS2 credentials',
      message: 'Username or password is malformed',
    });
  }

  try {
    const normalizedUrl = normalizeDhis2BaseUrl(rawUrl);
    req.headers['x-dhis2-url'] = normalizedUrl;
    req.dhis2Credentials = {
      url: normalizedUrl,
      username,
      password,
    };
  } catch (err) {
    return res.status(err.status || 400).json({
      error: 'Invalid DHIS2 URL',
      message: err.message,
    });
  }

  next();
}

module.exports = {
  requireDhis2Credentials,
  extractBearerToken,
};
