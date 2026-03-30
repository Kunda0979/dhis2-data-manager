const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const {
  listHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  addHistoryEntry,
} = require('../services/historyService');
const { createExportJob } = require('../services/exportJobService');

const router = express.Router();

router.use(requireDhis2Credentials);

router.get('/', (req, res) => {
  const sessionId = req.authSession?.id || 'anonymous';
  const entries = listHistory(sessionId, {
    type: req.query.type,
    status: req.query.status,
    q: req.query.q,
  });
  res.json({ entries });
});

router.delete('/:id', (req, res) => {
  const sessionId = req.authSession?.id || 'anonymous';
  const removed = deleteHistoryEntry(sessionId, req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'History item not found' });
  }
  res.json({ success: true });
});

router.delete('/', (req, res) => {
  const sessionId = req.authSession?.id || 'anonymous';
  clearHistory(sessionId);
  res.json({ success: true });
});

router.post('/:id/rerun', (req, res) => {
  const sessionId = req.authSession?.id || 'anonymous';
  const entry = getHistoryEntry(sessionId, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'History item not found' });
  }

  if (entry.type !== 'export') {
    return res.status(400).json({ error: 'Rerun is currently supported only for export jobs' });
  }

  const params = entry.metadata?.params || {};
  const job = createExportJob({
    sessionId,
    credentials: req.dhis2Credentials,
    dataType: entry.dataType || 'events',
    format: entry.format || 'json',
    params,
  });

  addHistoryEntry(sessionId, {
    type: 'export',
    status: 'queued',
    mode: 'async',
    dataType: entry.dataType || 'events',
    format: entry.format || 'json',
    details: `Rerun created from history item ${entry.id}`,
    metadata: { jobId: job.id, params, rerunOf: entry.id },
  });

  res.status(202).json({ success: true, jobId: job.id, status: job.status });
});

module.exports = router;
