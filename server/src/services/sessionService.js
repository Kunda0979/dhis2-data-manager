const crypto = require('crypto');

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_HOURS || '8', 10) * 60 * 60 * 1000;
const sessionsByToken = new Map();

function now() {
  return Date.now();
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeProfile(profile) {
  return {
    id: profile.id,
    profileName: profile.profileName,
    url: profile.url,
    username: profile.username,
    // authToken is never serialized to the client for security
    user: profile.user,
    serverInfo: profile.serverInfo,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function ensureSession(token) {
  const session = sessionsByToken.get(token);
  if (!session) return null;
  if (session.expiresAt <= now()) {
    sessionsByToken.delete(token);
    return null;
  }
  return session;
}

function createSession() {
  const token = createToken();
  const createdAt = new Date().toISOString();
  const session = {
    id: crypto.randomUUID(),
    token,
    profiles: [],
    activeProfileId: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: now() + SESSION_TTL_MS,
  };
  sessionsByToken.set(token, session);
  return session;
}

function touchSession(session) {
  session.updatedAt = new Date().toISOString();
  session.expiresAt = now() + SESSION_TTL_MS;
  return session;
}

function getSessionByToken(token) {
  const session = ensureSession(token);
  if (!session) return null;
  return touchSession(session);
}

function getOrCreateSession(token) {
  const existing = token ? getSessionByToken(token) : null;
  if (existing) return existing;
  return createSession();
}

function upsertProfile(session, { url, username, password, authToken, user, serverInfo, profileName }) {
  const existing = session.profiles.find((profile) => profile.url === url && profile.username === username);
  const timestamp = new Date().toISOString();

  if (existing) {
    if (password !== undefined) existing.password = password;
    if (authToken !== undefined) existing.authToken = authToken;
    existing.user = user;
    existing.serverInfo = serverInfo;
    existing.profileName = profileName || existing.profileName || user?.displayName || username;
    existing.updatedAt = timestamp;
    session.activeProfileId = existing.id;
    touchSession(session);
    return existing;
  }

  const created = {
    id: crypto.randomUUID(),
    profileName: profileName || user?.displayName || username,
    url,
    username: username || 'dhis2-app',
    password: password || null,
    authToken: authToken || null,
    user,
    serverInfo,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  session.profiles.unshift(created);
  session.activeProfileId = created.id;
  touchSession(session);
  return created;
}

function getActiveProfile(session) {
  if (!session || !session.activeProfileId) return null;
  return session.profiles.find((profile) => profile.id === session.activeProfileId) || null;
}

function getActiveCredentials(session) {
  const profile = getActiveProfile(session);
  if (!profile) return null;
  return {
    url: profile.url,
    username: profile.username,
    password: profile.password,
    authToken: profile.authToken || null,
    profileId: profile.id,
  };
}

function switchActiveProfile(session, profileId) {
  const profile = session.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  session.activeProfileId = profileId;
  touchSession(session);
  return profile;
}

function removeProfile(session, profileId) {
  const before = session.profiles.length;
  session.profiles = session.profiles.filter((profile) => profile.id !== profileId);
  if (session.profiles.length === before) return false;

  if (session.activeProfileId === profileId) {
    session.activeProfileId = session.profiles[0]?.id || null;
  }

  touchSession(session);
  return true;
}

function disconnectSession(token) {
  return sessionsByToken.delete(token);
}

function serializeSession(session) {
  return {
    token: session.token,
    activeProfileId: session.activeProfileId,
    profiles: session.profiles.map((profile) => sanitizeProfile(profile)),
  };
}

module.exports = {
  getSessionByToken,
  getOrCreateSession,
  upsertProfile,
  switchActiveProfile,
  removeProfile,
  disconnectSession,
  getActiveCredentials,
  getActiveProfile,
  serializeSession,
};
