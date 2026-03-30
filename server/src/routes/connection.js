const express = require('express');
const { createDhis2Client } = require('../services/dhis2Client');

const router = express.Router();

/**
 * POST /api/connect
 * Test a DHIS2 connection and return user info.
 * Credentials provided via body (not headers, since this is the initial test).
 */
router.post('/', async (req, res, next) => {
  try {
    const { url, username, password } = req.body;

    if (!url || !username || !password) {
      return res.status(400).json({ error: 'url, username, and password are required' });
    }

    const token = Buffer.from(`${username}:${password}`).toString('base64');
    const axios = require('axios');

    const client = axios.create({
      baseURL: url.endsWith('/') ? url.slice(0, -1) : url,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const response = await client.get('/api/me?fields=id,username,displayName,email,organisationUnits[id,displayName]');
    const serverInfoRes = await client.get('/api/system/info?fields=version,serverDate,systemName,instanceBaseUrl');

    res.json({
      success: true,
      user: response.data,
      serverInfo: serverInfoRes.data,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
