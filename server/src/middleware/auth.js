/**
 * Middleware to validate that DHIS2 connection headers are present.
 */
const { normalizeDhis2BaseUrl } = require('../utils/security');
const { getSessionByToken, getActiveCredentials } = require('../services/sessionService');

function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function requireDhis2Credentials(req, res, next) {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const session = getSessionByToken(bearerToken);
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

    req.authToken = bearerToken;
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
