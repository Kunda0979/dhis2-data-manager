# DHIS2 Data Manager

> A full-featured web application for downloading (exporting) and importing DHIS2 tracker and aggregate data. Targets **DHIS2 v42+** using `/api/tracker` and `/api/dataValueSets` endpoints.

![DHIS2 Data Manager](https://img.shields.io/badge/DHIS2-v42%2B-blue) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![React](https://img.shields.io/badge/React-18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

### 🔌 Connection Manager
- Connect to any DHIS2 instance using Basic Auth (URL + username + password)
- Test connection via `GET /api/me` — shows server name, version, and user info
- Connection stored in-memory only (never persisted to disk)
- Status indicator in the header
- Instance identity banner in-app (system name, version, base URL, environment hint)
- Production-aware import warning with explicit confirmation before import execution

### 📤 Export Module
- Export **Tracked Entities**, **Enrollments**, and **Events**
- Export **Aggregate Data Values** by dataset, period, and organisation unit
- Filter by: Program, Organisation Unit (with OU mode), Date Range, Status
- Auto-paginate through large datasets
- Preview data in a table before downloading
- Download as **JSON**, **CSV**, or **Excel (.xlsx)**

### 📥 Import Module
- Upload files via drag-and-drop or file picker (JSON, CSV, Excel)
- Download tracker and aggregate import templates (empty or pre-populated)
- Aggregate templates can pre-populate using selected dataset metadata (data elements, period type, and sample values)
- Aggregate template downloads support period frequency selection (monthly, quarterly, bi-annual, yearly) with start/end period ranges
- Preview uploaded data before importing
- Map CSV/Excel columns to DHIS2 fields (data elements, attributes, etc.)
- Import aggregate data values through DHIS2 `dataValueSets`
- Pre-import validation: required fields, UID format, date format
- Import options: strategy (CREATE/UPDATE/DELETE), atomic mode, sync/async
- Display detailed import results (created, updated, ignored, errors)

### 📊 Job History
- Track all import/export operations with timestamps
- Stored in localStorage (persists across sessions)

### ⚙️ Settings
- Default export format, page size, import strategy

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite + Tailwind CSS + Ant Design |
| **Backend** | Node.js + Express |
# DHIS2 Data Manager

Web application for exporting and importing DHIS2 tracker and aggregate data.
Built for DHIS2 v42+ with a React frontend and Node.js backend.

![DHIS2 Data Manager](https://img.shields.io/badge/DHIS2-v42%2B-blue) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![React](https://img.shields.io/badge/React-18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Connection and Session
- Connect using DHIS2 URL + credentials.
- Optional bootstrap in DHIS2-hosted mode via `DHIS2_API_TOKEN`.
- Session-based auth with HttpOnly cookie (`dm_sid`), plus Bearer fallback for dev/testing.
- Multiple saved profiles per session with profile switching.

### Export
- Tracker export: `events`, `enrollments`, `trackedEntities`.
- Aggregate export by dataset/period/org unit.
- Sync and async export jobs.
- Download formats: JSON, CSV, XLSX, PDF.
- Permission checks and export guardrails applied server-side.

### Import
- Upload JSON, CSV, XLSX.
- Validate before import with issue reporting.
- Tracker import execution endpoint and async status checks.
- Template generation (empty or pre-populated) and template preview.
- Aggregate dataset completion helpers.

### Metadata and History
- Cached metadata endpoints with cache status inspection.
- Session-scoped operation history with rerun support for exports.
- Retention status endpoint for export/import/history cleanup windows.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Ant Design |
| Backend | Node.js, Express |
| HTTP | Axios |
| Files | exceljs, csv-parse, csv-stringify, pdfkit |
| Deployment | Docker, Docker Compose |

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+

### 1. Clone and install

```bash
git clone https://github.com/Kunda0979/dhis2-data-manager.git
cd dhis2-data-manager

cd server && npm install
cd ../client && npm install
```

### 2. Run backend

```bash
cd server
npm run dev
# API: http://localhost:4000
# Health: http://localhost:4000/health
```

### 3. Run frontend (new terminal)

```bash
cd client
npm run dev
# App: http://localhost:3000
```

### 4. Run tests

```bash
cd server
npm test
```

## Docker

```bash
npm run app:start
```

Default compose behavior:
- Frontend is exposed on `http://localhost:3000`.
- Backend runs on internal Docker network (not published to host by default).
- Set `DHIS2_API_TOKEN` and `COOKIE_SECRET` in your shell or `.env` before startup if needed.

Use the same commands after a Codespaces restart:

```bash
npm run app:restart
npm run app:status
```

`app:restart` rebuilds and recreates both containers, waits for the backend health
check before starting the client, and prevents stale frontend or backend images
from being served. The app session is intentionally held in memory for security;
after the backend container itself is recreated, reconnect once with your DHIS2
credentials.

## Configuration

### Server environment variables

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=production

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
CORS_ALLOW_ALL=false

# Security / connection
COOKIE_SECRET=replace-with-a-long-random-secret
DHIS2_API_TOKEN=
DHIS2_ALLOWED_HOSTS=
BLOCK_PRIVATE_DHIS2_URLS=false

# Upload limits
MAX_UPLOAD_SIZE_MB=50

# Rate limiting
RATE_LIMIT_CONNECT_WINDOW_MIN=15
RATE_LIMIT_CONNECT_MAX=30
RATE_LIMIT_IMPORT_WINDOW_MIN=15
RATE_LIMIT_IMPORT_MAX=60
RATE_LIMIT_EXPORT_WINDOW_MIN=15
RATE_LIMIT_EXPORT_MAX=90

# Export jobs
EXPORT_MAX_CONCURRENT_JOBS=1
EXPORT_ASYNC_MAX_ROWS=10000
EXPORT_JOB_OUTPUT_DIR=/tmp/dhis2-data-manager-exports
EXPORT_JOB_RETENTION_MIN=120
EXPORT_JOB_META_RETENTION_MIN=1440

# Import jobs
IMPORT_JOB_STATUS_RETENTION_HOURS=24
IMPORT_JOB_META_RETENTION_HOURS=168

# Metadata/session/history
METADATA_CACHE_TTL_SEC=120
SESSION_TTL_HOURS=8
HISTORY_RETENTION_HOURS=0
MAX_HISTORY_ITEMS=300

# Tracker export guardrails
EXPORT_TRACKER_REQUIRE_PROGRAM=true
EXPORT_TRACKER_SCOPED_MAX_ROWS=5000
EXPORT_TRACKER_UNSCOPED_MAX_ROWS=500
EXPORT_TRACKER_PAGE_SIZE=100
```

### Frontend environment variables

```env
VITE_API_URL=http://localhost:4000
```

## Backend API Overview

### Connection

```text
POST   /api/connect
POST   /api/connect/bootstrap
GET    /api/connect/profiles
POST   /api/connect/profiles/switch
DELETE /api/connect/profiles/:profileId
POST   /api/connect/disconnect
```

### Metadata

```text
GET /api/metadata/programs
GET /api/metadata/orgUnits
GET /api/metadata/trackedEntityTypes
GET /api/metadata/dataElements
GET /api/metadata/dataSets
GET /api/metadata/cache/status
```

### Export

```text
GET  /api/export/events
GET  /api/export/enrollments
GET  /api/export/trackedEntities
GET  /api/export/aggregate

POST /api/export/jobs
GET  /api/export/jobs/:jobId
POST /api/export/jobs/:jobId/cancel
GET  /api/export/jobs/:jobId/download
```

### Import

```text
GET  /api/import/template
GET  /api/import/template/preview
POST /api/import/validate
POST /api/import/tracker
POST /api/import/aggregate/completion
GET  /api/import/jobs/:jobId
```

### History

```text
GET    /api/history
GET    /api/history/retention-status
POST   /api/history/:id/rerun
DELETE /api/history/:id
DELETE /api/history
```

## Architecture Documentation

- DHIS2 installed app architecture and API contracts:
	[docs/dhis2-installed-app-architecture.md](docs/dhis2-installed-app-architecture.md)

## License

MIT
