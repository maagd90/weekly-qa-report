# Weekly QA Metrics Dashboard — DLM

File-based QA dashboard for the **DLM** project. Parses Zephyr exports, JIRA issues, and ODL UAT spreadsheets (or fetches live from JIRA/QMetry APIs), aggregates metrics on the **backend**, and serves a React UI — **no database required**.

---

## Table of contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project structure](#project-structure)
4. [Configuration](#configuration)
5. [Running locally](#running-locally)
6. [Running with Docker](#running-with-docker)
7. [Data sources](#data-sources)
8. [Using the dashboard](#using-the-dashboard)
9. [CLI & tests](#cli--tests)
10. [API reference](#api-reference)
11. [Architecture](#architecture)

---

## Overview

| Source | Data |
|---|---|
| **Zephyr / QMetry** | Test cycle executions (PASS / FAIL / BLOCKED / NE / NA) |
| **JIRA** | Stories and Bugs |
| **ODL** | UAT issues (optional) |

All metrics are computed in `apps/batch` (`buildDashboardPayload`). The React UI only renders JSON from `GET /api/dashboard`. See [docs/AGGREGATION.md](docs/AGGREGATION.md) for aggregation rules.

**Updated-date filtering:** rows updated within the selected date range appear even if created earlier.

---

## Prerequisites

| Tool | Version | Required for |
|---|---|---|
| **Node.js** | 20+ | Local development |
| **npm** | 9+ | Local development |
| **Docker Desktop** | latest | Docker deployment |
| **Docker Compose** | v2+ | Docker deployment (included with Docker Desktop) |

Optional (for live API fetch and AI reports):

- Emirates JIRA account + API token
- Anthropic API key (Claude AI reports only)

---

## Project structure

```
dashboard/
├── apps/
│   ├── batch/          # Parse, merge, aggregate, AI tools, CLI
│   ├── api/            # Express API (file server + dashboard endpoints)
│   └── web/            # React UI (display-only)
├── config/
│   ├── integrations.example.json   # Template — copy to integrations.json
│   └── integrations.json           # Your JIRA/QMetry settings (not committed)
├── input/              # Staged Excel exports (upload or copy here)
├── output/             # Generated dashboard-data.json, raw-dataset.json, report.md
├── fixtures/input/     # Sample regression Excel files
├── docs/
│   └── AGGREGATION.md  # Backend metric rules (prototype parity)
├── run.sh              # Main entry script (setup, dev, docker, generate, test)
├── docker-compose.yml  # API + web containers
├── .env                # Secrets and env vars (copy from .env.example)
└── .env.example        # Template for .env
```

---

## Configuration

### Step 1 — First-time setup

```bash
chmod +x run.sh
./run.sh setup
```

This creates:

- `input/`, `output/`, `config/` directories
- `.env` from `.env.example` (if missing)
- `config/integrations.json` from example (if missing)
- Installs npm dependencies (local dev only)

### Step 2 — Environment variables (`.env`)

Copy and edit:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port (default `3001`). Docker sets this internally. |
| `ANTHROPIC_API_KEY` | No | Claude API key for **AI Report** tab. Dashboard works without it. |
| `JIRA_EMAIL` | For live API | Your Emirates email for JIRA/QMetry Basic auth |
| `JIRA_API_TOKEN` | For live API | JIRA personal access token |
| `INPUT_DIR` | No | Override input folder (default `./input`) |
| `OUTPUT_DIR` | No | Override output folder (default `./output`) |
| `CONFIG_DIR` | No | Override config folder (default `./config`) |
| `PROJECT_ROOT` | No | Repo root override (used by API) |

Example `.env`:

```bash
PORT=3001

# Optional — AI reports
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional — live JIRA/QMetry fetch (when enabled in integrations.json)
JIRA_EMAIL=you@emirates.com
JIRA_API_TOKEN=your-api-token
```

> **Security:** Never commit `.env`. Only `.env.example` is tracked in git.

### Step 3 — Integrations (`config/integrations.json`)

Copy and edit:

```bash
cp config/integrations.example.json config/integrations.json
```

#### JIRA section

| Field | Description |
|---|---|
| `enabled` | `true` to fetch issues from JIRA API at generate/dashboard time |
| `baseUrl` | `https://jiraagile.emirates.com` |
| `searchPath` | `/rest/api/2/search` |
| `projectKeys` | e.g. `["DLM"]` |
| `jql` | JQL query for Stories and Bugs |
| `pageSize` | Results per page (default `100`) |
| `statusDone` | Statuses treated as done: `Done`, `CLOSED`, `Cancel`, `Closed` |

#### QMetry section

Matches the Emirates **QMetry Test Management (qtm4j)** UI API pattern used in Java `QmetryPublisher`:

| Field | Description |
|---|---|
| `enabled` | `true` to fetch test executions from QMetry API |
| `baseUrl` | JIRA host (e.g. `https://jiraagile.emirates.com`) |
| `apiPrefix` | `/rest/qtm4j/ui/latest` |
| `projectKey` | JIRA project key for display (e.g. `DLM`) |
| `projectId` | Numeric QMetry project ID (e.g. `"23000"`) — used to discover test cycles when `cycleIds` is empty |
| `cycleIds` | Explicit test cycle IDs to fetch (e.g. `["XM8PIR4eFa"]`). If set, skips cycle discovery |
| `usePostSearch` | `true` — POST with JSON body for test case search (Emirates default) |
| `testCasesSearchPath` | `/testcycles/{cycleId}/testcases/search` |
| `testCasesSearchBody` | POST filter body, e.g. `{ "filter": { "filter": { "folderId": -1 } } }` |
| `testCyclesSearchPath` | Optional — `/projects/{projectId}/testcycles/search` to auto-discover cycles |
| `testCaseFields` | Comma-separated API fields |
| `pageSize` | Results per page (default `50`, QMetry max) |
| `maxPages` | Pagination limit per cycle (default `200`) |

**Authentication** — either:

1. **Email + token** (same as JIRA): set `JIRA_EMAIL` and `JIRA_API_TOKEN` in `.env`
2. **Pre-encoded Basic auth** (Java `automation.qmetry.encoded.authorization` pattern): set `QMETRY_BASIC_AUTH=Basic xxxxx` in `.env`

Example with explicit cycle ID (like `automation.qmetry.testCycleId`):

```json
{
  "qmetry": {
    "enabled": true,
    "baseUrl": "https://jiraagile.emirates.com",
    "apiPrefix": "/rest/qtm4j/ui/latest",
    "projectKey": "DLM",
    "projectId": "23000",
    "usePostSearch": true,
    "testCasesSearchPath": "/testcycles/{cycleId}/testcases/search",
    "testCasesSearchBody": { "filter": { "filter": { "folderId": -1 } } },
    "cycleIds": ["XM8PIR4eFa"],
    "pageSize": 50,
    "maxPages": 200
  }
}
```

To **auto-discover cycles** by project, set `projectId` and leave `cycleIds` empty (or use `testCyclesSearchPath` with a custom search body).

Example with APIs enabled:

```json
{
  "jira": {
    "enabled": true,
    "baseUrl": "https://jiraagile.emirates.com",
    "searchPath": "/rest/api/2/search",
    "projectKeys": ["DLM"],
    "jql": "project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC",
    "pageSize": 100,
    "statusDone": ["Done", "CLOSED", "Cancel"]
  },
  "qmetry": {
    "enabled": true,
    "baseUrl": "https://jiraagile.emirates.com",
    "apiPrefix": "/rest/qtm4j/ui/latest",
    "projectKey": "DLM",
    "projectId": "23000",
    "usePostSearch": true,
    "testCasesSearchPath": "/testcycles/{cycleId}/testcases/search",
    "testCasesSearchBody": { "filter": { "filter": { "folderId": -1 } } },
    "testCaseFields": "seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedOn,executedBy,lastModified,build",
    "cycleIds": ["XM8PIR4eFa"],
    "pageSize": 50,
    "maxPages": 200
  }
}
```

To use **Excel files only** (no live API), leave both `enabled` fields as `false` and stage files in `input/`.

### Step 4 — Sample data (optional)

Committed synthetic fixtures under `fixtures/synthetic/` power `npm test` on a clean clone. For local runs with real exports:

```bash
cp fixtures/input/*.xlsx input/
```

Real exports in `fixtures/input/` are gitignored — never commit them.

Fixture files:

| File | Type | Rows |
|---|---|---|
| `report17440364264580082420.xlsx` | Zephyr executions | 2210 |
| `Emirates JIRA 2026-06-29T09_45_39+0400.xlsx` | JIRA issues | 779 |
| `ODL issues.xlsx` | UAT issues | 74 |

---

## Running locally

### Start development servers

```bash
./run.sh dev
```

| Service | URL |
|---|---|
| **Web UI** | http://localhost:5173 |
| **API** | http://localhost:3001 |
| **Health check** | http://localhost:3001/health |

The Vite dev server proxies `/api` requests to the API on port 3001.

### Other local commands

```bash
./run.sh setup      # First-time setup
./run.sh build      # Production build (batch + api + web)
./run.sh test       # Parser + filter acceptance tests
./run.sh generate 2026-06-24 2026-06-30 full   # CLI report generation
./run.sh help       # All commands
```

### Manual start (without run.sh)

```bash
npm install
cp .env.example .env
cp config/integrations.example.json config/integrations.json
mkdir -p input output config
npm run dev
```

---

## Running with Docker

Docker runs two containers: **API** (Node.js) and **Web** (nginx). Your `input/`, `output/`, and `config/` folders are mounted as volumes so data persists between restarts.

### Architecture

```
Browser → http://localhost:3000 (nginx / web)
              ↓ proxies /api/*
          dashboard-api:3001 (Node.js)
              ↓ reads/writes
          ./input  ./output  ./config  (host volumes)
```

### Step-by-step — Docker

**1. Install Docker Desktop** and ensure it is running.

**2. Configure the project:**

```bash
chmod +x run.sh
./run.sh setup
```

Edit `.env` with your credentials (see [Configuration](#configuration) above).

Edit `config/integrations.json` if using live JIRA/QMetry APIs.

**3. (Optional) Add sample Excel files:**

```bash
cp fixtures/input/*.xlsx input/
```

**4. Build and start containers:**

```bash
./run.sh docker
```

Or directly:

```bash
docker compose up --build -d
```

**5. Open the dashboard:**

| Service | URL |
|---|---|
| **Web UI** | http://localhost:3000 |
| **API (direct)** | http://localhost:3001/health |

**6. Generate dashboard data:**

- Open http://localhost:3000
- Go to **Import Data** to upload Excel files (saved to `./input/` on your machine)
- Go to **AI Report** → set date range → click **Generate Report**

Or use the API:

```bash
curl -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2026-06-24","endDate":"2026-06-30","reportType":"full"}'
```

### Docker commands reference

```bash
./run.sh docker              # Build and start (detached)
./run.sh docker down         # Stop and remove containers
./run.sh docker logs         # Follow all container logs
./run.sh docker restart      # Rebuild and restart
./run.sh docker build        # Build images only

# Or with docker compose directly:
docker compose up --build -d
docker compose down
docker compose logs -f
docker compose ps
```

### Docker volumes

| Host path | Container path | Purpose |
|---|---|---|
| `./input` | `/data/input` | Staged Excel uploads |
| `./output` | `/data/output` | `dashboard-data.json`, `raw-dataset.json`, `report.md` |
| `./config` | `/data/config` | `integrations.json` |

Changes to `config/integrations.json` or files in `input/` on your host are visible inside the container immediately (no rebuild needed).

### Docker troubleshooting

| Problem | Fix |
|---|---|
| `docker: command not found` | Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Port 3000 or 3001 already in use | Stop conflicting process or change ports in `docker-compose.yml` |
| Empty dashboard | Stage files in `input/` or enable integrations, then **Generate Report** |
| JIRA API errors | Check `JIRA_EMAIL` / `JIRA_API_TOKEN` in `.env` and `enabled: true` in integrations |
| `.env` not loaded | Ensure `.env` exists in repo root before `docker compose up` |
| Rebuild after code changes | `./run.sh docker restart` or `docker compose up --build -d` |

---

## Data sources

You can use **files**, **APIs**, or **both**:

| Mode | Setup |
|---|---|
| **Excel only** | Copy/upload `.xlsx` to `input/`, integrations `enabled: false` |
| **API only** | Set integrations `enabled: true`, add credentials to `.env`, add QMetry `cycleIds` |
| **Mixed** | Enable APIs + keep Excel files in `input/` — data is merged |

Expected Excel file types:

| File | Detection | Sheet |
|---|---|---|
| Zephyr export | Headers: `Test Cycle Key`, `Testcase/Teststep Execution Result` | `Data` or first sheet |
| JIRA export | Headers: `Issue Type`, `Key` (header row ~4) | `general_report` |
| ODL UAT | Headers: `TicketID`, `odlPriorityDescription` | First sheet |

---

## Using the dashboard

### Tabs

| Tab | Content |
|---|---|
| **Overview** | Result mix, pass rate, story/bug split, defect backlog, monthly chart |
| **Testers** | Per-tester execution stats |
| **Test Cycles** | Cycle health, coverage, pass % (at-risk first) |
| **Traceability** | Feature area matrix (stories, bugs, completion) |
| **UAT** | ODL UAT issues (shown when ODL data is loaded) |
| **Import Data** | Upload Excel to `input/` |
| **AI Report** | Generate Claude narrative (requires `ANTHROPIC_API_KEY`) |
| **Settings** | Integration status, env hints |

### Filters

Global filters (top bar) call `GET /api/dashboard` with:

- `startDate` / `endDate` — date range
- `search` — free text
- `result` — PASS / FAIL / BLOCKED / all
- `project` — project key or all

All tabs update from the same backend-filtered payload.

---

## CLI & tests

### Generate report from command line

```bash
./run.sh generate 2026-06-24 2026-06-30 full

# Or via npm:
npm run generate -- --start-date 2026-06-24 --end-date 2026-06-30 --report-type full
```

Report types: `full`, `executive`, `testers`, `cycles`

### Run tests

```bash
npm test
```

Tests include:

- Parser regressions (2210 Zephyr, 779 JIRA, 74 ODL rows)
- Filter acceptance (April window, FAIL-only, search, project scope)

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API health check |
| `GET` | `/api/status` | API key and JIRA credential status |
| `GET` | `/api/dashboard?startDate&endDate&search&result&project` | Filtered dashboard payload |
| `POST` | `/api/generate` | Parse/fetch, write JSON + optional AI report |
| `GET` | `/api/report` | Last generated markdown report |
| `GET` | `/api/integrations` | Integration config summary |
| `POST` | `/api/integrations/test` | Test JIRA/QMetry fetch |
| `POST` | `/api/upload` | Stage Excel file to `input/` |
| `GET` | `/api/input/files` | List staged files |
| `DELETE` | `/api/input/:filename` | Remove staged file |

---

## Architecture

```
input/ + integrations → parse → raw-dataset.json (cache)
                                      ↓
                              applyFilters (date, search, result, project)
                                      ↓
                              buildDashboardPayload → dashboard-data.json
                                      ↓
                              React UI (render only) / AI tools / CLI
```

### AI report tools

Claude calls six backend tools against the filtered dataset (no invented numbers):

1. `get_result_mix` — execution result distribution
2. `get_tester_stats` — per-tester stats
3. `get_cycle_health` — cycle pass rates
4. `get_story_bug_split` — story vs bug counts
5. `get_defect_backlog` — open bugs by priority/owner
6. `get_traceability` — feature area matrix

### Regression totals (fixture files)

| Source | Rows | Key metrics |
|---|---|---|
| Zephyr | 2210 | PASS 1319, NE 715, BLOCKED 109, FAIL 46, NA 21 |
| JIRA | 779 | Story 582, Bug 197; 63 open bugs |
| ODL | 74 | 43 closed, 31 open |
