const axios = require('axios');

/**
 * Creates an Axios instance configured for a specific DHIS2 instance.
 * Credentials are taken from request headers: x-dhis2-url, x-dhis2-username, x-dhis2-password
 */
function createDhis2Client(req) {
  const baseURL = req.headers['x-dhis2-url'];
  const username = req.headers['x-dhis2-username'];
  const password = req.headers['x-dhis2-password'];

  if (!baseURL || !username || !password) {
    const err = new Error('Missing DHIS2 connection headers (x-dhis2-url, x-dhis2-username, x-dhis2-password)');
    err.status = 400;
    throw err;
  }

  const token = Buffer.from(`${username}:${password}`).toString('base64');

  return axios.create({
    baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
}

module.exports = { createDhis2Client };
