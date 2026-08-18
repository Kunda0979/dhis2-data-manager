/**
 * Helpers for the session HttpOnly cookie.
 *
 * Cookie name: dm_sid
 * - HttpOnly  – JS cannot read it (XSS protection)
 * - Secure    – HTTPS only in production
 * - SameSite  – 'None' + Secure in production (required for DHIS2 cross-site
 *               iframe delivery); 'Lax' in development
 * - Signed    – when COOKIE_SECRET is set, cookie-parser verifies the HMAC
 */

const COOKIE_NAME = 'dm_sid';
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '8', 10);
const isProduction = process.env.NODE_ENV === 'production';
const hasCookieSecret = !!(process.env.COOKIE_SECRET || '');
const secureCookies = process.env.COOKIE_SECURE === 'true'
  || (process.env.COOKIE_SECURE !== 'false' && isProduction);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: secureCookies ? 'None' : 'Lax',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  };
}

/**
 * Write the session token into the response cookie.
 * Uses a signed cookie when COOKIE_SECRET is present.
 */
function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(),
    ...(hasCookieSecret ? { signed: true } : {}),
  });
}

/**
 * Read the session token from the request cookie.
 * Prefers signed cookies when COOKIE_SECRET is set.
 */
function getSessionCookie(req) {
  if (hasCookieSecret) {
    return req.signedCookies?.[COOKIE_NAME] || null;
  }
  return req.cookies?.[COOKIE_NAME] || null;
}

/**
 * Clear the session cookie.
 */
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: secureCookies ? 'None' : 'Lax',
    path: '/',
  });
}

module.exports = { setSessionCookie, getSessionCookie, clearSessionCookie };
