const express = require('express');
const { normalizeDhis2BaseUrl } = require('../utils/security');
const { createAppError } = require('../utils/apiError');
const { validateConnectionPayload } = require('../middleware/validate');
const { connectLimiter } = require('../middleware/rateLimiter');
const { extractBearerToken } = require('../middleware/auth');
const { setSessionCookie, getSessionCookie, clearSessionCookie } = require('../utils/sessionCookie');
const {
  getOrCreateSession,
  getSessionByToken,
  upsertProfile,
  switchActiveProfile,
  removeProfile,
  disconnectSession,
  serializeSession,
} = require('../services/sessionService');
const { invalidateMetadataCacheForSession } = require('../services/metadataCacheService');

function buildBaseUrlCandidates(baseUrl) {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(key);
  };

  addCandidate(baseUrl);

  try {
    const parsed = new URL(baseUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);

    if (segments[segments.length - 1] === 'api') {
      const withoutApi = segments.slice(0, -1).join('/');
      addCandidate(`${parsed.origin}${withoutApi ? `/${withoutApi}` : ''}`);
    }

    if (segments.length > 0) {
      addCandidate(parsed.origin);
    }
  } catch {
    // ignore URL parse failures; normalizeDhis2BaseUrl already validates format.
  }

  return candidates;
}

async function probeDhis2Connection({ baseUrl, headers }) {
  const axios = require('axios');
  const client = axios.create({
    baseURL: baseUrl,
    headers,
    timeout: 15000,
    maxRedirects: 0,
  });

  const [meRes, infoRes] = await Promise.all([
    client.get('/api/me?fields=id,username,displayName,email,organisationUnits[id,displayName]'),
    client.get('/api/system/info?fields=version,serverDate,systemName,instanceBaseUrl'),
  ]);

  return {
    client,
    user: meRes.data,
    serverInfo: infoRes.data,
  };
}

function isDhis2LoginRedirect(err) {
  const status = err?.response?.status;
  const location = String(err?.response?.headers?.location || '').toLowerCase();
  const data = typeof err?.response?.data === 'string' ? err.response.data : '';
  const lowerData = data.toLowerCase();

  const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  const loginRedirect = location.includes('/login') || location.includes('login/') || lowerData.includes('dhis2-base-url') || lowerData.includes('login');
  return isRedirect && loginRedirect;
}

async function resolveWorkingDhis2BaseUrl({ baseUrl, headers }) {
  const candidates = buildBaseUrlCandidates(baseUrl);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const result = await probeDhis2Connection({ baseUrl: candidate, headers });
      return {
        baseUrl: candidate,
        ...result,
      };
    } catch (err) {
      lastError = err;
      if (isDhis2LoginRedirect(err)) {
        throw createAppError({
          status: 401,
          code: 'DHIS2_AUTH_REQUIRED',
          message: 'DHIS2 is redirecting to the login page. Check the URL and credentials.',
          hint: 'Open the DHIS2 instance in a browser to verify the base URL and confirm the account is still active.',
        });
      }
      // 404 usually means an invalid base URL path (for example ending with /api).
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }

  throw lastError || new Error('Unable to connect to DHIS2 server');
}

function getSafeActiveProfile(session) {
  const serialized = serializeSession(session);
  return serialized.profiles.find((item) => item.id === serialized.activeProfileId) || null;
}

const router = express.Router();

/**
 * POST /api/connect
 * Test a DHIS2 connection and return user info.
 * Credentials provided via body (not headers, since this is the initial test).
 */
router.post('/', connectLimiter, validateConnectionPayload, async (req, res, next) => {
  try {
    const { url, username, password, profileName } = req.body;

    const normalizedUrl = normalizeDhis2BaseUrl(url);
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    const resolved = await resolveWorkingDhis2BaseUrl({
      baseUrl: normalizedUrl,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
    });

    // Prefer cookie token, then Bearer header, for session continuity
    const existingToken = getSessionCookie(req) || extractBearerToken(req);
    const session = getOrCreateSession(existingToken);
    const activeProfile = upsertProfile(session, {
      url: resolved.baseUrl,
      username,
      password,
      user: resolved.user,
      serverInfo: resolved.serverInfo,
      profileName,
    });
    invalidateMetadataCacheForSession(session.id);
    const serialized = serializeSession(session);

    setSessionCookie(res, serialized.token);

    res.json({
      success: true,
      user: resolved.user,
      serverInfo: resolved.serverInfo,
      // sessionToken still returned so dev/test Bearer fallback works
      sessionToken: serialized.token,
      activeProfileId: serialized.activeProfileId,
      profiles: serialized.profiles,
      activeProfile: serialized.profiles.find((item) => item.id === activeProfile.id) || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/profiles', (req, res) => {
  const token = getSessionCookie(req) || extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing session token' });
  }

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session token' });
  }

  res.json({
    success: true,
    ...serializeSession(session),
    activeProfile: getSafeActiveProfile(session),
  });
});

router.post('/profiles/switch', (req, res) => {
  const token = getSessionCookie(req) || extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing session token' });
  }

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session token' });
  }

  const { profileId } = req.body || {};
  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required' });
  }

  const profile = switchActiveProfile(session, profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  invalidateMetadataCacheForSession(session.id);

  res.json({
    success: true,
    activeProfileId: session.activeProfileId,
    activeProfile: getSafeActiveProfile(session),
    profiles: serializeSession(session).profiles,
  });
});

router.delete('/profiles/:profileId', (req, res) => {
  const token = getSessionCookie(req) || extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing session token' });
  }

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session token' });
  }

  const removed = removeProfile(session, req.params.profileId);
  if (!removed) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  invalidateMetadataCacheForSession(session.id);

  res.json({
    success: true,
    activeProfileId: session.activeProfileId,
    activeProfile: getSafeActiveProfile(session),
    profiles: serializeSession(session).profiles,
  });
});

router.post('/disconnect', (req, res) => {
  const token = getSessionCookie(req) || extractBearerToken(req);
  if (token) {
    const session = getSessionByToken(token);
    if (session?.id) {
      invalidateMetadataCacheForSession(session.id);
    }
    disconnectSession(token);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

/**
 * POST /api/connect/bootstrap
 * Auto-connect using a server-side DHIS2 Personal Access Token (PAT).
 * Intended for apps running inside DHIS2 where users are already authenticated.
 * The frontend supplies only the DHIS2 base URL (from window.dhis2.config.baseUrl).
 * The backend uses DHIS2_API_TOKEN env var to verify identity with DHIS2.
 */
router.post('/bootstrap', async (req, res, next) => {
  try {
    const apiToken = process.env.DHIS2_API_TOKEN;
    if (!apiToken) {
      return res.status(503).json({
        error: 'Not configured',
        message: 'DHIS2_API_TOKEN is not set on the server. Set this environment variable to a valid DHIS2 Personal Access Token.',
      });
    }

    const { baseUrl } = req.body || {};
    if (!baseUrl || typeof baseUrl !== 'string') {
      return res.status(400).json({ error: 'baseUrl is required' });
    }

    const normalizedUrl = normalizeDhis2BaseUrl(baseUrl);
    const resolved = await resolveWorkingDhis2BaseUrl({
      baseUrl: normalizedUrl,
      headers: {
        Authorization: `ApiToken ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const existingToken = getSessionCookie(req) || extractBearerToken(req);
    const session = getOrCreateSession(existingToken);
    const activeProfile = upsertProfile(session, {
      url: resolved.baseUrl,
      username: resolved.user.username,
      authToken: apiToken,
      user: resolved.user,
      serverInfo: resolved.serverInfo,
      profileName: resolved.user.displayName || resolved.user.username,
    });
    invalidateMetadataCacheForSession(session.id);

    const serialized = serializeSession(session);

    setSessionCookie(res, serialized.token);

    res.json({
      success: true,
      user: resolved.user,
      serverInfo: resolved.serverInfo,
      sessionToken: serialized.token,
      activeProfileId: serialized.activeProfileId,
      profiles: serialized.profiles,
      activeProfile: serialized.profiles.find((item) => item.id === activeProfile.id) || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
