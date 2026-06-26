# Weekly QA Metrics Dashboard

A full-stack reporting platform for QA teams that centralises resource allocation, test execution, bug tracking, project health, CI build progress, and AI-generated narrative reports — all from a single data source.

---

## Overview

QA teams produce valuable data every week — test runs, bug counts, change request assignments, project risk assessments — but that data is often scattered across spreadsheets and never surfaced in a form that drives decisions.

This dashboard ingests weekly QA data (via Excel upload, CSV, or PDF), stores it in a local SQLite database, and presents it as interactive charts and tables with week-by-week or custom date-range filtering. An optional AI layer uses Claude (via the official API) to generate fully grounded narrative reports where every number is pulled directly from the database — no hallucination, no estimates.

---

## Key Features

| Feature | Description |
|---|---|
| **Resource Dashboard** | Per-resource test execution, bug reporting, and CR assignment breakdown |
| **Project Status** | Weekly project health reports with completion %, risks, blockers, and accomplishments |
| **File Upload** | Drag-and-drop import for XLSX, CSV, and PDF; column mapping panel for JIRA exports |
| **Date Range Filtering** | Filter all views by ISO week or by custom `startDate` / `endDate` |
| **AI Report Generation** | Claude analyses the database through SQL tools and streams a structured Markdown report |
| **Jenkins Integration** | Polls Jenkins REST API on a configurable interval; shows build status board, trend charts, test results, and live running builds |
| **Settings** | Encrypted storage of API keys (Claude, Jenkins) — keys never leave the server |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (React)                     │
│                                                          │
│  Resources │ Projects │ Builds │ AI Report │ Settings   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  Express API (Node.js)                    │
│                                                          │
│  /api/resources   /api/projects   /api/jenkins          │
│  /api/upload      /api/settings   /api/ai/report        │
└────┬──────────────────┬───────────────────┬─────────────┘
     │                  │                   │
┌────▼────┐      ┌──────▼──────┐    ┌──────▼──────┐
│  SQLite │      │  Claude API │    │ Jenkins API │
│   DB    │      │ (tool-use)  │    │ (REST poll) │
└─────────┘      └─────────────┘    └─────────────┘
```

### AI Zero-Hallucination Flow

```
Generate Report request
        │
        ▼
  Claude receives system prompt + 8 SQL tool definitions
        │
        ├─► calls get_resource_summary()  → SQL → real rows
        ├─► calls get_project_status()    → SQL → real rows
        ├─► calls get_risk_summary()      → SQL → real rows
        └─► writes report using ONLY the returned data
        │
        ▼
  Markdown streamed to browser via SSE
```

Claude never invents numbers. If a tool returns empty data, the report states "No data available for this period."

---

## Technology Stack

### Backend
| Technology | Role |
|---|---|
| **Node.js + Express** | REST API server |
| **TypeScript** | Type safety across all backend code |
| **SQLite (better-sqlite3)** | Embedded database — portable, no external service required |
| **xlsx** | Excel and CSV parsing |
| **multer** | Multipart file upload handling |
| **pdf-parse** | PDF text extraction |
| **@anthropic-ai/sdk** | Claude API client with streaming tool-use |
| **chokidar** | File system watcher for auto-import |
| **AES-256 (Node crypto)** | Encryption for stored API keys |

### Frontend
| Technology | Role |
|---|---|
| **React 18** | UI component framework |
| **Vite** | Development server and bundler |
| **TypeScript** | Type safety across all frontend code |
| **Tailwind CSS** | Utility-first styling |
| **Recharts** | Chart library (bar, line, donut charts) |
| **@tanstack/react-query** | Server state management and caching |
| **react-markdown + remark-gfm** | Markdown rendering for AI report output |
| **lucide-react** | Icon library |

### Infrastructure
| Technology | Role |
|---|---|
| **Docker + Docker Compose** | Containerised deployment |
| **Nginx** | Static frontend serving with API proxy |
| **Server-Sent Events (SSE)** | Real-time streaming for AI reports and Jenkins live builds |

---

## Project Structure

```
dashboard/
├── apps/
│   ├── api/                    Express API server
│   │   └── src/
│   │       ├── db/             SQLite schema and connection
│   │       ├── importers/      Excel, CSV, and PDF importers
│   │       ├── routes/         API route handlers
│   │       ├── services/       AI tools, report service, Jenkins poller, date helpers
│   │       └── watchers/       File system watcher
│   └── web/                    React frontend
│       └── src/
│           ├── components/     Reusable UI components and charts
│           ├── hooks/          Custom React hooks
│           ├── lib/            API client
│           └── pages/          Full-page views
├── templates/                  Blank Excel template with sample data
├── data/                       Runtime data (SQLite DB, uploads — gitignored)
├── docker-compose.yml
└── .env.example
```

---

## Data Model

The Excel template contains five sheets that map directly to the database:

| Sheet / Table | Purpose |
|---|---|
| `Resources` | Team members — ID, name, team, role |
| `Projects` | Active projects — ID, name, manager, dates, status |
| `CRs` | Change requests linked to projects |
| `Weekly_Log` | One row per resource × CR × week — test cases, bugs, hours |
| `Project_Status_Weekly` | One row per project × week — completion %, risks, blockers, accomplishments |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Local Development

```bash
# 1. Install all dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env

# 3. Start the API and frontend concurrently
npm run dev
```

The API starts on `http://localhost:3001` and the frontend on `http://localhost:5173`.

### Importing Data

**Option A — Excel file watch (auto-import)**

Set `EXCEL_SOURCE_PATH` in `.env` to point to an Excel file. The dashboard will import it on startup and re-import automatically whenever the file is saved.

**Option B — Upload via UI**

Leave `EXCEL_SOURCE_PATH` unset and use the **Import Data** tab to drag-and-drop an XLSX, CSV, or PDF file. A column mapping panel is shown for non-template formats (e.g. JIRA exports).

### Docker Deployment

```bash
docker compose up --build -d
```

The application is available at `http://<host>:3000`.

To mount a shared network drive as the data source, update the volume in `docker-compose.yml`:

```yaml
volumes:
  - /path/to/shared/drive:/data
```

---

## AI Report Setup

1. Navigate to the **Settings** tab
2. Enter a Claude API key (available at [console.anthropic.com](https://console.anthropic.com))
3. Click **Save Key**, then **Test Connection**
4. Navigate to the **AI Report** tab, select a date range and report type, and click **Generate Report**

The API key is encrypted with AES-256 before being stored in the database and is never returned to the browser.

---

## Jenkins Integration Setup

1. In Jenkins, navigate to your user profile → **Configure** → **API Token** → generate a new token
2. In the dashboard, go to **Settings** → **Jenkins Integration**
3. Enter the Jenkins base URL, username, and API token
4. Set a polling interval (default: every 5 minutes)
5. Click **Save & Start Polling**

The dashboard will immediately sync all jobs and their recent builds, then continue polling on the configured schedule.

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `EXCEL_SOURCE_PATH` | _(unset)_ | Absolute path to an Excel file for auto-import on startup |
| `PORT` | `3001` | API server port |
| `DB_PATH` | `apps/api/data/qa_dashboard.db` | SQLite database file path |
| `ENCRYPTION_KEY` | _(change before deploying)_ | 32-character key used to encrypt stored API keys |

---

## License

MIT
