require('dotenv').config();
const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const connectionRouter = require('./routes/connection');
const metadataRouter = require('./routes/metadata');
const exportRouter = require('./routes/export');
const importRouter = require('./routes/import');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/connect', connectionRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/export', exportRouter);
app.use('/api/import', importRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`DHIS2 Data Manager server running on port ${PORT}`);
});

module.exports = app;
