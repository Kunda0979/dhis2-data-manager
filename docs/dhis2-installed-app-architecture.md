# DHIS2 Data Manager: DHIS2-Installed App Architecture

## 1) Runtime Model Inside DHIS2 App Management

This project is split into:

- Frontend app (React/Vite), packaged as a DHIS2 app zip with `manifest.webapp`.
- Backend API (Node/Express), deployed separately and called by the frontend.

Key files:

- App manifest: [client/public/manifest.webapp](client/public/manifest.webapp)
- Frontend build/zip scripts: [client/package.json](client/package.json)
- Backend entrypoint: [server/src/index.js](server/src/index.js)

The frontend runs in DHIS2 App Management context, while backend handles DHIS2 API proxying, validation, permissions, rate limiting, and job lifecycle.

## 2) Deployment: DHIS2 App Management Zip Install

### Build app zip

1. Build and zip frontend:

```bash
cd client
npm install
npm run build:zip
```

2. This creates `client/dhis2-data-manager.zip` (from `dist/`).

### Install in DHIS2

1. In DHIS2, open App Management.
2. Choose upload/install from file.
3. Upload `dhis2-data-manager.zip`.
4. Assign app access/authorities per your governance.

### Backend deployment requirements

1. Deploy backend service separately (container or VM).
2. Ensure `ALLOWED_ORIGINS` contains your DHIS2 origin.
3. Ensure HTTPS in production for cookie delivery.
4. Configure environment variables from [README.md](README.md).

### Notes for production behavior

- Session cookie uses `SameSite=None` + `Secure` in production (required for DHIS2 iframe/cross-site delivery).
- Cookie config helper: [server/src/utils/sessionCookie.js](server/src/utils/sessionCookie.js)

## 3) Authentication and Session Handling

### Connection bootstrap

- `POST /api/connect`: validates URL and credentials, fetches DHIS2 `/api/me`, creates/updates a session profile.
- `POST /api/connect/bootstrap`: optional PAT-based bootstrap using `DHIS2_API_TOKEN`.

Implementation:

- Connection routes: [server/src/routes/connection.js](server/src/routes/connection.js)
- Session store/profile management: [server/src/services/sessionService.js](server/src/services/sessionService.js)

### Session resolution order

Protected routes resolve credentials in this order:

1. Session cookie (`dm_sid`) (preferred)
2. Bearer token (`Authorization: Bearer ...`) fallback
3. Legacy direct headers (`x-dhis2-url`, `x-dhis2-username`, `x-dhis2-password`)

Implementation: [server/src/middleware/auth.js](server/src/middleware/auth.js)

### Session scope guarantees

- Export jobs are stored and enforced per session id.
- Import job tracking is keyed by `sessionId:jobId`.
- History is session-scoped.

Relevant checks:

- Export job ownership checks: [server/src/routes/export.js](server/src/routes/export.js)
- Import job status tracking: [server/src/services/importService.js](server/src/services/importService.js)
- History/session handling: [server/src/services/historyService.js](server/src/services/historyService.js)

## 4) Permission Enforcement Model (Server-Side)

Permission checks happen server-side before execution of export/import/template actions:

- Program access and optional stage membership check
- Dataset access check
- Org unit access check using `withinUserHierarchy=true`

Service implementation: [server/src/services/permissionService.js](server/src/services/permissionService.js)

Applied in routes:

- Export actions: [server/src/routes/export.js](server/src/routes/export.js)
- Template preview/download and import validate/execute: [server/src/routes/import.js](server/src/routes/import.js)

Expected outcomes:

- Unauthorized/forbidden selections are blocked before downstream DHIS2 operation.
- Responses are normalized structured errors with actionable hints (see error model below).

## 5) Export Workflow and Constraints

### Sync exports

Endpoints:

- `GET /api/export/events`
- `GET /api/export/enrollments`
- `GET /api/export/trackedEntities`
- `GET /api/export/aggregate`

### Async exports

Endpoints:

- `POST /api/export/jobs`
- `GET /api/export/jobs/:jobId`
- `POST /api/export/jobs/:jobId/cancel`
- `GET /api/export/jobs/:jobId/download`

### Constraints and guardrails

- Export route rate limiting: [server/src/middleware/rateLimiter.js](server/src/middleware/rateLimiter.js)
- Tracker scoping guardrails (program-required by default, scoped/unscoped caps): [server/src/utils/exportGuardrails.js](server/src/utils/exportGuardrails.js)
- Per-session async concurrency cap (`EXPORT_MAX_CONCURRENT_JOBS`): [server/src/services/exportJobService.js](server/src/services/exportJobService.js)
- Async max rows cap (`EXPORT_ASYNC_MAX_ROWS`): [server/src/services/exportJobService.js](server/src/services/exportJobService.js)
- Memory-safe aggregate async streaming: [server/src/services/exportService.js](server/src/services/exportService.js)

## 6) Import Workflow and Constraints

Endpoints:

- `POST /api/import/validate`
- `POST /api/import/tracker`
- `GET /api/import/jobs/:jobId`
- `GET /api/import/template`
- `GET /api/import/template/preview`

Behavior:

- Supports CSV/JSON/Excel.
- Validation includes payload checks, row-level issue report, and compatibility checks.
- Async import job status tracked per session.

Implementation:

- Import routes/workflow: [server/src/routes/import.js](server/src/routes/import.js)
- Import job registry/retention: [server/src/services/importService.js](server/src/services/importService.js)

## 7) Job Lifecycle, Retention, and Cleanup

### Export jobs

- Output written to file system (`EXPORT_JOB_OUTPUT_DIR`).
- Output TTL (`EXPORT_JOB_RETENTION_MIN`): output file removed then marked expired-output.
- Metadata TTL (`EXPORT_JOB_META_RETENTION_MIN`): in-memory job metadata removed.

Implementation: [server/src/services/exportJobService.js](server/src/services/exportJobService.js)

### Import jobs

- Status TTL (`IMPORT_JOB_STATUS_RETENTION_HOURS`): jobs transition to EXPIRED status.
- Metadata TTL (`IMPORT_JOB_META_RETENTION_HOURS`): tracked records removed.

Implementation: [server/src/services/importService.js](server/src/services/importService.js)

### History

- Optional retention via `HISTORY_RETENTION_HOURS`.
- Session-scoped list and retention status endpoint.

Implementation:

- History routes: [server/src/routes/history.js](server/src/routes/history.js)
- History service: [server/src/services/historyService.js](server/src/services/historyService.js)

## 8) Template Schema Versioning and Drift Handling

Template compatibility logic validates uploaded template metadata against current DHIS2 metadata:

- Schema version check using `TEMPLATE_SCHEMA_VERSION`.
- Program/program stage existence checks.
- Field snapshot drift check.
- Option-set drift checks with row-level issue reporting.

Implementation: compatibility/report logic in [server/src/routes/import.js](server/src/routes/import.js)

Operational guidance:

- If template mismatch is detected, download a fresh template from `GET /api/import/template`.

## 9) Metadata Caching Model

Metadata endpoints are cached with TTL and session/profile scoping:

- Programs, datasets, data elements, tracked entity types, org units.
- Cache invalidated on connect/profile switch/profile removal/disconnect/bootstrap.

Implementation:

- Cache service: [server/src/services/metadataCacheService.js](server/src/services/metadataCacheService.js)
- Metadata routes with cache wrapper: [server/src/routes/metadata.js](server/src/routes/metadata.js)
- Invalidation triggers: [server/src/routes/connection.js](server/src/routes/connection.js)

Observability endpoint:

- `GET /api/metadata/cache/status`
- `GET /api/metadata/cache/status?scope=global`

## 10) Error Contract and UI Consistency

All server errors returned by the global handler follow one structure:

```json
{
  "error": {
    "status": 403,
    "code": "INSUFFICIENT_PROGRAM_ACCESS",
    "message": "Insufficient permission for selected program (abc123)",
    "hint": "Select a program you can access or ask your DHIS2 administrator for program read permission.",
    "details": {}
  }
}
```

Implementation:

- Server error mapping: [server/src/utils/apiError.js](server/src/utils/apiError.js)
- Global error handler: [server/src/middleware/errorHandler.js](server/src/middleware/errorHandler.js)
- Frontend normalization utilities: [client/src/utils/apiError.js](client/src/utils/apiError.js)

Production privacy behavior:

- `details` hidden in production.
- `details` available in non-production for diagnostics.

## 11) Backend API Contract Overview

This section lists primary backend endpoints and response patterns.

### Connection/session

- `POST /api/connect`
- `POST /api/connect/bootstrap`
- `GET /api/connect/profiles`
- `POST /api/connect/profiles/switch`
- `DELETE /api/connect/profiles/:profileId`
- `POST /api/connect/disconnect`

Typical success (abbreviated):

```json
{
  "success": true,
  "sessionToken": "...",
  "activeProfileId": "...",
  "profiles": []
}
```

### Metadata

- `GET /api/metadata/programs`
- `GET /api/metadata/dataSets`
- `GET /api/metadata/trackedEntityTypes`
- `GET /api/metadata/dataElements?programStage=...`
- `GET /api/metadata/orgUnits?...`

Typical metadata response includes `cached`:

```json
{
  "programs": [],
  "cached": true
}
```

### Export

- Sync: `GET /api/export/:type`
- Async create: `POST /api/export/jobs`
- Async status: `GET /api/export/jobs/:jobId`
- Async cancel: `POST /api/export/jobs/:jobId/cancel`
- Async download: `GET /api/export/jobs/:jobId/download`

Typical async create success:

```json
{
  "success": true,
  "jobId": "...",
  "status": "queued",
  "progress": 0
}
```

### Import and template

- `POST /api/import/validate`
- `POST /api/import/tracker`
- `GET /api/import/jobs/:jobId`
- `GET /api/import/template`
- `GET /api/import/template/preview`

Typical validate success (abbreviated):

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "compatibility": {},
  "rowIssues": {}
}
```

### History/retention

- `GET /api/history`
- `DELETE /api/history/:id`
- `DELETE /api/history`
- `POST /api/history/:id/rerun`
- `GET /api/history/retention-status`

## 12) Environment Variables Most Relevant to Architecture

- Session/cookies: `SESSION_TTL_HOURS`, `COOKIE_SECRET`
- CORS/security: `ALLOWED_ORIGINS`, `DHIS2_ALLOWED_HOSTS`, `BLOCK_PRIVATE_DHIS2_URLS`
- Rate limits: `RATE_LIMIT_CONNECT_*`, `RATE_LIMIT_IMPORT_*`, `RATE_LIMIT_EXPORT_*`
- Export constraints: `EXPORT_MAX_CONCURRENT_JOBS`, `EXPORT_ASYNC_MAX_ROWS`, `EXPORT_TRACKER_*`
- Retention: `EXPORT_JOB_RETENTION_MIN`, `EXPORT_JOB_META_RETENTION_MIN`, `IMPORT_JOB_STATUS_RETENTION_HOURS`, `IMPORT_JOB_META_RETENTION_HOURS`, `HISTORY_RETENTION_HOURS`
- Metadata cache: `METADATA_CACHE_TTL_SEC`

Source list: [README.md](README.md)

## 13) Notes and Known Operational Characteristics

- Job and history stores are in-memory; they reset on backend restart.
- Session and profile state are in-memory; users must reconnect after restart.
- For long-term persistence at scale, move session/job/history stores to durable backing services.
