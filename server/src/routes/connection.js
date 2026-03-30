const express = require('express');
const { normalizeDhis2BaseUrl } = require('../utils/security');
const { validateConnectionPayload } = require('../middleware/validate');
const { connectLimiter } = require('../middleware/rateLimiter');
const { extractBearerToken } = require('../middleware/auth');
const {
  getOrCreateSession,
  getSessionByToken,
  upsertProfile,
  switchActiveProfile,
  removeProfile,
  disconnectSession,
  serializeSession,
} = require('../services/sessionService');

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

    const safeUrl = normalizeDhis2BaseUrl(url);
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    const axios = require('axios');

    const client = axios.create({
      baseURL: safeUrl,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      maxRedirects: 0,
    });

    const response = await client.get('/api/me?fields=id,username,displayName,email,organisationUnits[id,displayName]');
    const serverInfoRes = await client.get('/api/system/info?fields=version,serverDate,systemName,instanceBaseUrl');

    const existingToken = extractBearerToken(req);
    const session = getOrCreateSession(existingToken);
    const activeProfile = upsertProfile(session, {
      url: safeUrl,
      username,
      password,
      user: response.data,
      serverInfo: serverInfoRes.data,
      profileName,
    });
    const serialized = serializeSession(session);

    res.json({
      success: true,
      user: response.data,
      serverInfo: serverInfoRes.data,
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
  const token = extractBearerToken(req);
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
  const token = extractBearerToken(req);
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

  res.json({
    success: true,
    activeProfileId: session.activeProfileId,
    activeProfile: getSafeActiveProfile(session),
    profiles: serializeSession(session).profiles,
  });
});

router.delete('/profiles/:profileId', (req, res) => {
  const token = extractBearerToken(req);
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

  res.json({
    success: true,
    activeProfileId: session.activeProfileId,
    activeProfile: getSafeActiveProfile(session),
    profiles: serializeSession(session).profiles,
  });
});

router.post('/disconnect', (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    return res.json({ success: true });
  }
  disconnectSession(token);
  res.json({ success: true });
});

module.exports = router;
