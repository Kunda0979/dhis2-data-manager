const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
];

function parseCommaSeparatedEnv(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;

  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // IPv6 unique local range
  if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))) return true;
  return false;
}

function normalizeDhis2BaseUrl(urlInput) {
  if (!urlInput || typeof urlInput !== 'string') {
    const err = new Error('A valid DHIS2 URL is required');
    err.status = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(urlInput.trim());
  } catch {
    const err = new Error('Invalid DHIS2 URL format');
    err.status = 400;
    throw err;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('DHIS2 URL must use http or https');
    err.status = 400;
    throw err;
  }

  if (parsed.username || parsed.password) {
    const err = new Error('DHIS2 URL must not include embedded credentials');
    err.status = 400;
    throw err;
  }

  const allowedHosts = parseCommaSeparatedEnv('DHIS2_ALLOWED_HOSTS');
  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    const err = new Error('DHIS2 host is not allowed by server policy');
    err.status = 403;
    throw err;
  }

  const blockPrivateHosts = process.env.BLOCK_PRIVATE_DHIS2_URLS === 'true';
  if (blockPrivateHosts && isLocalOrPrivateHost(parsed.hostname)) {
    const err = new Error('Local/private DHIS2 hosts are blocked by server policy');
    err.status = 403;
    throw err;
  }

  parsed.hash = '';
  parsed.search = '';

  const pathname = parsed.pathname.endsWith('/') && parsed.pathname.length > 1
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;

  return `${parsed.origin}${pathname}`;
}

module.exports = {
  normalizeDhis2BaseUrl,
};
