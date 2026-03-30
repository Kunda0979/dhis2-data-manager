# DHIS2 Data Manager

> A full-featured web application for downloading (exporting) and importing DHIS2 event and tracker data. Targets **DHIS2 v42+** using the new `/api/tracker` endpoints.

![DHIS2 Data Manager](https://img.shields.io/badge/DHIS2-v42%2B-blue) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![React](https://img.shields.io/badge/React-18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

### 🔌 Connection Manager
- Connect to any DHIS2 instance using Basic Auth (URL + username + password)
- Test connection via `GET /api/me` — shows server name, version, and user info
- Connection stored in-memory only (never persisted to disk)
- Status indicator in the header

### 📤 Export Module
- Export **Tracked Entities**, **Enrollments**, and **Events**
- Filter by: Program, Organisation Unit (with OU mode), Date Range, Status
- Auto-paginate through large datasets
- Preview data in a table before downloading
- Download as **JSON**, **CSV**, or **Excel (.xlsx)**

### 📥 Import Module
- Upload files via drag-and-drop or file picker (JSON, CSV, Excel)
- Preview uploaded data before importing
- Map CSV/Excel columns to DHIS2 fields (data elements, attributes, etc.)
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
| **File Handling** | `xlsx` (SheetJS) + `csv-parse`/`csv-stringify` |
| **HTTP Client** | Axios (with Basic Auth) |
| **Deployment** | Docker + Docker Compose |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js 18+**

### 1. Clone and start the server

```bash
git clone https://github.com/Kunda0979/dhis2-data-manager.git
cd dhis2-data-manager/server
npm install
npm run dev
# Server: http://localhost:4000
```

### 2. Start the client (new terminal)

```bash
cd client
npm install
npm run dev
# Client: http://localhost:3000
```

---

## 🐳 Docker Deployment

```bash
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:4000
```

---

## ⚙️ Configuration

### Server `.env`
```env
PORT=4000
NODE_ENV=production
MAX_UPLOAD_SIZE_MB=50
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
DHIS2_ALLOWED_HOSTS=
BLOCK_PRIVATE_DHIS2_URLS=false
RATE_LIMIT_CONNECT_WINDOW_MIN=15
RATE_LIMIT_CONNECT_MAX=30
RATE_LIMIT_IMPORT_WINDOW_MIN=15
RATE_LIMIT_IMPORT_MAX=60
SESSION_TTL_HOURS=8
MAX_HISTORY_ITEMS=300
```

### Run backend tests
```bash
cd server
npm test
```

### Client `.env`
```env
VITE_API_URL=http://localhost:4000
```

---

## 🔌 DHIS2 API Reference (v42+)

```
GET  /api/me                                           # Connection test
GET  /api/tracker/events?program=UID&orgUnit=UID       # Export events
GET  /api/tracker/enrollments?program=UID&orgUnit=UID  # Export enrollments
GET  /api/tracker/trackedEntities?program=UID          # Export tracked entities
POST /api/tracker                                      # Import data
GET  /api/tracker/jobs/{jobId}                         # Async job status
```

## 🔐 Backend Session & Job APIs

```
POST   /api/connect                    # connect and create/update session profile
GET    /api/connect/profiles           # list session profiles + active profile
POST   /api/connect/profiles/switch    # switch active profile
DELETE /api/connect/profiles/{id}      # remove one profile
POST   /api/connect/disconnect         # terminate session

POST   /api/export/jobs                # create async export job
GET    /api/export/jobs/{jobId}        # poll async export status/progress
POST   /api/export/jobs/{jobId}/cancel # cancel async export
GET    /api/export/jobs/{jobId}/download

GET    /api/history                    # list operation history (server-side)
POST   /api/history/{id}/rerun         # rerun prior export from history
DELETE /api/history/{id}
DELETE /api/history
```

---

## 📄 License

MIT License
