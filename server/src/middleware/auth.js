/**
 * Middleware to validate that DHIS2 connection headers are present.
 */
function requireDhis2Credentials(req, res, next) {
  const url = req.headers['x-dhis2-url'];
  const username = req.headers['x-dhis2-username'];
  const password = req.headers['x-dhis2-password'];

  if (!url || !username || !password) {
    return res.status(401).json({
      error: 'Missing DHIS2 credentials',
      message: 'Please provide x-dhis2-url, x-dhis2-username, and x-dhis2-password headers',
    });
  }

  next();
}

module.exports = { requireDhis2Credentials };
