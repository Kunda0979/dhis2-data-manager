function validateConnectionPayload(req, res, next) {
  const { url, username, password, profileName } = req.body || {};

  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username, and password are required' });
  }

  if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid request payload format' });
  }

  if (username.length > 256 || password.length > 1024 || url.length > 2048) {
    return res.status(400).json({ error: 'Connection payload exceeds allowed size' });
  }

  if (profileName !== undefined && (typeof profileName !== 'string' || profileName.length > 100)) {
    return res.status(400).json({ error: 'Invalid profileName' });
  }

  next();
}

function validateImportRequest(req, res, next) {
  const allowedStrategies = new Set(['CREATE', 'UPDATE', 'DELETE', 'CREATE_AND_UPDATE']);
  const allowedAtomicModes = new Set(['ALL', 'NONE', 'OBJECT']);
  const allowedDataTypes = new Set(['events', 'enrollments', 'trackedEntities', 'aggregate']);

  if (req.body.importStrategy && !allowedStrategies.has(req.body.importStrategy)) {
    return res.status(400).json({ error: 'Invalid importStrategy value' });
  }

  if (req.body.atomicMode && !allowedAtomicModes.has(req.body.atomicMode)) {
    return res.status(400).json({ error: 'Invalid atomicMode value' });
  }

  if (req.body.dataType && !allowedDataTypes.has(req.body.dataType)) {
    return res.status(400).json({ error: 'Invalid dataType value' });
  }

  if (req.body.mapping) {
    if (typeof req.body.mapping !== 'string' || req.body.mapping.length > 1000000) {
      return res.status(400).json({ error: 'Invalid mapping payload' });
    }
  }

  next();
}

module.exports = {
  validateConnectionPayload,
  validateImportRequest,
};
