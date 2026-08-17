const axios = require('axios');
const { normalizeDhis2BaseUrl } = require('../utils/security');

/**
 * Creates an Axios instance configured for a specific DHIS2 instance.
 * Credentials are taken from request headers: x-dhis2-url, x-dhis2-username, x-dhis2-password
 */
function createDhis2Client(req) {
  const baseURL = req.dhis2Credentials?.url || req.headers['x-dhis2-url'];
  const username = req.dhis2Credentials?.username || req.headers['x-dhis2-username'];
  const password = req.dhis2Credentials?.password || req.headers['x-dhis2-password'];
  const authToken = req.dhis2Credentials?.authToken;

  if (!baseURL) {
    const err = new Error('Missing DHIS2 connection headers (x-dhis2-url, x-dhis2-username, x-dhis2-password)');
    err.status = 400;
    throw err;
  }

  const normalizedBaseUrl = normalizeDhis2BaseUrl(baseURL);

  // Prefer ApiToken (PAT) over Basic auth when available
  let authHeader;
  if (authToken) {
    authHeader = `ApiToken ${authToken}`;
  } else if (username && password) {
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else {
    const err = new Error('Missing DHIS2 connection headers (x-dhis2-url, x-dhis2-username, x-dhis2-password)');
    err.status = 400;
    throw err;
  }

  return axios.create({
    baseURL: normalizedBaseUrl,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
    maxRedirects: 0,
  });
}

module.exports = { createDhis2Client };
