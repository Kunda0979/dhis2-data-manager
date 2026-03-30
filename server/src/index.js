require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const errorHandler = require('./middleware/errorHandler');

const connectionRouter = require('./routes/connection');
const metadataRouter = require('./routes/metadata');
const exportRouter = require('./routes/export');
const importRouter = require('./routes/import');
const historyRouter = require('./routes/history');

const app = express();
const PORT = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === 'production';
const allowAllOrigins = process.env.CORS_ALLOW_ALL === 'true' || !isProduction;

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : defaultOrigins;

const corsOptions = {
  origin(origin, callback) {
    if (allowAllOrigins) return callback(null, true);
    // Non-browser clients (curl/postman) often omit Origin.
    if (!origin) return callback(null, true);
    if (configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS policy'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-dhis2-url', 'x-dhis2-username', 'x-dhis2-password'],
};

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/connect', connectionRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/export', exportRouter);
app.use('/api/import', importRouter);
app.use('/api/history', historyRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler (must be last)
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DHIS2 Data Manager server running on port ${PORT}`);
  });
}

module.exports = app;
