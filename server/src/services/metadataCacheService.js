const METADATA_CACHE_TTL_SEC = parseInt(process.env.METADATA_CACHE_TTL_SEC || '120', 10);

const cache = new Map();
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  evictions: 0,
};

function nowMs() {
  return Date.now();
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SAFE_METADATA_CACHE_TTL_SEC = parsePositiveInt(METADATA_CACHE_TTL_SEC, 120);

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildMetadataScope(req) {
  const sessionId = req.authSession?.id || 'adhoc-session';
  const profileId = req.dhis2Credentials?.profileId || 'adhoc-profile';
  const baseUrl = req.dhis2Credentials?.url || req.headers['x-dhis2-url'] || 'unknown-url';
  const username = req.dhis2Credentials?.username || req.headers['x-dhis2-username'] || 'unknown-user';
  return `${sessionId}:${profileId}:${baseUrl}:${username}`;
}

function buildCacheKey(endpoint, params = {}) {
  return `${endpoint}:${stableStringify(params)}`;
}

function getCacheEntry(scope, key) {
  const fullKey = `${scope}|${key}`;
  const entry = cache.get(fullKey);
  if (!entry) {
    stats.misses += 1;
    return null;
  }
  if (entry.expiresAt <= nowMs()) {
    cache.delete(fullKey);
    stats.misses += 1;
    stats.evictions += 1;
    return null;
  }
  stats.hits += 1;
  return entry;
}

function setCacheEntry(scope, key, value, ttlSec = SAFE_METADATA_CACHE_TTL_SEC) {
  const fullKey = `${scope}|${key}`;
  const safeTtlSec = parsePositiveInt(ttlSec, SAFE_METADATA_CACHE_TTL_SEC);
  cache.set(fullKey, {
    value,
    createdAt: nowMs(),
    expiresAt: nowMs() + (safeTtlSec * 1000),
  });
  stats.sets += 1;
}

async function getOrSetMetadataCache(scope, key, loader, options = {}) {
  const ttlSec = parsePositiveInt(options.ttlSec, SAFE_METADATA_CACHE_TTL_SEC);
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh) {
    const cached = getCacheEntry(scope, key);
    if (cached) {
      return { data: cached.value, cached: true };
    }
  }

  const data = await loader();
  setCacheEntry(scope, key, data, ttlSec);
  return { data, cached: false };
}

function invalidateMetadataCacheForSession(sessionId) {
  if (!sessionId) return 0;
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      cache.delete(key);
      removed += 1;
    }
  }
  if (removed > 0) {
    stats.invalidations += removed;
  }
  return removed;
}

function countEntriesForSession(sessionId) {
  if (!sessionId) return 0;
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      count += 1;
    }
  }
  return count;
}

function getMetadataCacheStatus({ sessionId } = {}) {
  return {
    ttlSeconds: SAFE_METADATA_CACHE_TTL_SEC,
    entries: {
      total: cache.size,
      session: countEntriesForSession(sessionId),
    },
    stats: {
      hits: stats.hits,
      misses: stats.misses,
      sets: stats.sets,
      invalidations: stats.invalidations,
      evictions: stats.evictions,
    },
    hitRate: stats.hits + stats.misses > 0
      ? Number((stats.hits / (stats.hits + stats.misses)).toFixed(4))
      : 0,
  };
}

module.exports = {
  SAFE_METADATA_CACHE_TTL_SEC,
  buildMetadataScope,
  buildCacheKey,
  getOrSetMetadataCache,
  invalidateMetadataCacheForSession,
  getMetadataCacheStatus,
};