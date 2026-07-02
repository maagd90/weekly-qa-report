<div align="center">

# Weekly QA Metrics Dashboard

**Turn scattered QA exports into a single weekly dashboard — with AI-written summaries and one-click PDF reports.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![No database](https://img.shields.io/badge/database-none-lightgrey)](#overview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

QA teams generate valuable data every week — test executions, bug counts, cycle health, UAT status — but it
lives scattered across Zephyr exports, JIRA, QMetry, and spreadsheets. This tool ingests those sources,
computes every metric on the **backend**, and serves a clean React dashboard plus an AI-written executive
summary and a downloadable PDF. It is **file-based — no database to install or run.**

<div align="center">

<!-- Replace with a real screenshot of the running dashboard (recommended: docs/screenshot.png, ~1400px wide) -->
![Dashboard screenshot](docs/screenshot.png)

<sub>Add a screenshot at <code>docs/screenshot.png</code> — the single biggest polish item for this README.</sub>

</div>

---

## Quick start

```bash
git clone <repo-url> && cd weekly-qa-report
./run.sh setup          # creates .env, config, folders; installs deps
./run.sh dev            # web on http://localhost:3000, API on http://localhost:3001
```

Then open <http://localhost:3000>, stage an Excel export under **Import Data**, and click **Generate Report**.
No API keys are needed for the core dashboard — only for AI summaries. Full details below.

---

## Table of contents

1. [Overview](#overview)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Project structure](#project-structure)
5. [Configuration](#configuration)
6. [Running locally](#running-locally)
7. [Running with Docker](#running-with-docker)
8. [AI reports](#ai-reports)
9. [PDF export](#pdf-export)
10. [Data sources](#data-sources)
11. [Using the dashboard](#using-the-dashboard)
12. [CLI & tests](#cli--tests)
13. [API reference](#api-reference)
14. [Architecture](#architecture)
15. [Troubleshooting](#troubleshooting)
16. [Security](#security)
17. [Contributing](#contributing)
18. [License](#license)

---

## Overview

| Source | Data ingested |
|---|---|
| **Zephyr / QMetry** | Test-cycle executions (PASS / FAIL / BLOCKED / NOT EXECUTED / NOT APPLICABLE) |
| **JIRA** | Stories and Bugs |
| **ODL** | UAT issues (optional) |

All metrics are computed in `apps/batch` (`buildDashboardPayload`); the React UI only renders JSON from
`GET /api/dashboard`. See [`docs/AGGREGATION.md`](docs/AGGREGATION.md) for the exact aggregation rules and
[`TECH_STACK.md`](TECH_STACK.md) for the full stack and architecture diagram.

> **Date filtering:** rows updated within the selected range appear even if created earlier, so a period
> reflects activity in that window.

---

## Features

- **Multi-source ingestion** — Zephyr, JIRA, and ODL Excel exports, or live JIRA/QMetry REST APIs, or both merged.
- **Backend-computed metrics** — result mix, pass rate, tester stats, cycle health, story/bug split, defect backlog, traceability, UAT.
- **AI executive summary** — Claude drafts a VP-ready brief using dataset-query tools only (no invented numbers).
- **One-click PDF export** — server-side Chromium renders a print-optimized report.
- **File-based** — no database; state lives in `input/`, `output/`, and `config/`.
- **Runs anywhere** — local dev (`run.sh dev`) or Docker (`run.sh docker`).

---

## Prerequisites

| Tool | Version | Required for |
|---|---|---|
| **Node.js** | ≥ 20 | Local development |
| **npm** | ≥ 9 | Local development |
| **Docker Desktop** | latest | Docker deployment |
| **Docker Compose** | v2+ | Docker deployment (bundled with Docker Desktop) |
| **Chrome / Chromium** | any recent | PDF export in **local** dev (Docker bundles it) |

Optional integrations:

- A JIRA/QMetry account + API token — for live API fetch.
- An Anthropic API key — for AI report summaries only.

---

## Project structure

```
weekly-qa-report/
├── apps/
│   ├── batch/                      # Parse, merge, aggregate, AI tools, CLI (core library)
│   ├── api/                        # Express API (file server, dashboard, PDF endpoints)
│   └── web/                        # React UI (display-only)
├── config/
│   ├── integrations.example.json   # Template — copy to integrations.json
│   ├── integrations.json           # Your JIRA/QMetry settings (gitignored)
│   └── report.json                 # AI report model & token settings
├── input/                          # Staged Excel exports (gitignored)
├── output/                         # Generated dashboard-data.json, raw-dataset.json, report.md (gitignored)
├── fixtures/
│   ├── synthetic/                  # Committed fixtures that power `npm test`
│   └── input/                      # Real exports for local runs (gitignored)
├── docs/
│   └── AGGREGATION.md              # Backend metric rules
├── run.sh                          # Entry script (setup, dev, docker, generate, test)
├── docker-compose.yml              # API + web containers
├── TECH_STACK.md                   # Stack overview + architecture diagram
├── .env.example                    # Template for .env
└── .env                            # Secrets & env vars (gitignored)
```

---

## Configuration

### Step 1 — First-time setup

```bash
chmod +x run.sh
./run.sh setup
```

Creates `input/`, `output/`, `config/`; copies `.env` and `config/integrations.json` from their templates
(if missing); and installs npm dependencies (local dev only).

### Step 2 — Environment variables (`.env`)

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port (default `3001`). Docker sets this internally. |
| `ANTHROPIC_API_KEY` | AI report | Claude API key for the **AI Report** tab. Dashboard works without it. |
| `ANTHROPIC_MODEL` | No | Override the report model. Otherwise taken from `config/report.json`. |
| `JIRA_EMAIL` | Live API | Email for JIRA/QMetry Basic auth. |
| `JIRA_API_TOKEN` | Live API | JIRA personal access token. |
| `QMETRY_BASIC_AUTH` | No | Pre-encoded `Basic <base64>` header (alternative to email+token). |
| `PUPPETEER_EXECUTABLE_PATH` | PDF (local) | Path to a Chrome/Chromium binary. Docker sets this. |
| `PDF_PRINT_URL` | PDF (local) | URL of the web app's `/print/report` route. Docker sets this. |
| `INPUT_DIR` / `OUTPUT_DIR` / `CONFIG_DIR` / `PROJECT_ROOT` | No | Path overrides. |

> **Never commit `.env`.** Only `.env.example` is tracked. See [Security](#security).

### Step 3 — Integrations (`config/integrations.json`)

Only needed for **live API** fetch. For Excel-only use, leave both `enabled` flags `false`.

```bash
cp config/integrations.example.json config/integrations.json
```

Replace `https://your-jira-host` below with your real JIRA/QMetry host.

**JIRA fields**

| Field | Description |
|---|---|
| `enabled` | `true` to fetch issues from the JIRA API at generate time |
| `baseUrl` | e.g. `https://your-jira-host` |
| `searchPath` | `/rest/api/2/search` |
| `projectKeys` | e.g. `["DLM"]` |
| `jql` | JQL for Stories and Bugs |
| `pageSize` | Results per page (default `100`) |
| `statusDone` | Statuses treated as done, e.g. `["Done", "CLOSED", "Cancel"]` |

**QMetry fields** (QMetry Test Management / qtm4j UI API)

| Field | Description |
|---|---|
| `enabled` | `true` to fetch test executions from the QMetry API |
| `baseUrl` | JIRA host, e.g. `https://your-jira-host` |
| `apiPrefix` | `/rest/qtm4j/ui/latest` |
| `projectKey` | JIRA project key for display (e.g. `DLM`) |
| `projectId` | Numeric QMetry project ID — used to discover cycles when `cycleIds` is empty |
| `cycleIds` | Explicit test-cycle IDs to fetch. If set, skips discovery |
| `testCasesSearchPath` | `/testcycles/{cycleId}/testcases/search` |
| `testCaseFields` | Comma-separated API fields |
| `pageSize` | Results per page (default `50`, QMetry max) |
| `maxPages` | Pagination limit per cycle (default `200`) |

**Authentication** — either email + token (`JIRA_EMAIL` / `JIRA_API_TOKEN`) or a pre-encoded
`QMETRY_BASIC_AUTH=Basic <base64>` in `.env`.

<details>
<summary><b>Example — both APIs enabled</b></summary>

```json
{
  "jira": {
    "enabled": true,
    "baseUrl": "https://your-jira-host",
    "searchPath": "/rest/api/2/search",
    "projectKeys": ["DLM"],
    "jql": "project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC",
    "pageSize": 100,
    "statusDone": ["Done", "CLOSED", "Cancel"]
  },
  "qmetry": {
    "enabled": true,
    "baseUrl": "https://your-jira-host",
    "apiPrefix": "/rest/qtm4j/ui/latest",
    "projectKey": "DLM",
    "projectId": "23000",
    "testCasesSearchPath": "/testcycles/{cycleId}/testcases/search",
    "testCaseFields": "seqNo,key,summary,priority,status,executionResult,executedBy,executedOn,lastModified",
    "cycleIds": ["REPLACE_WITH_CYCLE_ID"],
    "pageSize": 50,
    "maxPages": 200
  }
}
```

</details>

### Step 4 — Sample data (optional)

Committed synthetic fixtures under `fixtures/synthetic/` power `npm test` on a clean clone. For local runs
with **real** exports, drop them into `input/`:

```bash
cp fixtures/input/*.xlsx input/   # fixtures/input/ is gitignored — never commit real exports
```

---

## Running locally

```bash
./run.sh dev
```

| Service | URL |
|---|---|
| **Web UI** | <http://localhost:3000> |
| **API** | <http://localhost:3001> |
| **Health** | <http://localhost:3001/health> |

The Vite dev server proxies `/api/*` to the API on port `3001`.

**Other commands**

```bash
./run.sh setup                                 # first-time setup
./run.sh build                                 # production build (batch + api + web)
./run.sh test                                  # parser + filter tests
./run.sh generate 2026-06-24 2026-06-30 full   # CLI report generation
./run.sh help                                  # all commands
```

<details>
<summary><b>Manual start (without run.sh)</b></summary>

```bash
npm install
cp .env.example .env
cp config/integrations.example.json config/integrations.json
mkdir -p input output config
npm run dev
```

</details>

---

## Running with Docker

Docker runs two containers — **API** (Node.js + Chromium) and **Web** (nginx). Your `input/`, `output/`,
and `config/` folders are mounted as volumes, so data persists across restarts.

```
Browser → http://localhost:3000 (nginx / web)
              ↓ proxies /api/*
          dashboard-api:3001 (Node.js + Chromium)
              ↓ reads/writes
          ./input   ./output   ./config   (host volumes)
```

```bash
chmod +x run.sh && ./run.sh setup   # then edit .env / integrations.json
./run.sh docker                     # build & start (detached)
```

| Service | URL |
|---|---|
| **Web UI** | <http://localhost:3000> |
| **API (direct)** | <http://localhost:3001/health> |

**Docker commands**

```bash
./run.sh docker              # build and start (detached)
./run.sh docker down         # stop and remove containers
./run.sh docker logs         # follow logs
./run.sh docker restart      # rebuild and restart

# Or with docker compose directly:
docker compose up --build -d
docker compose down
docker compose logs -f
```

Changes to `config/integrations.json` or files in `input/` are visible inside the container immediately
(no rebuild). Rebuild only after **code** changes.

---

## AI reports

The **AI Report** tab drafts an executive summary with Claude. Set `ANTHROPIC_API_KEY` in `.env`; the model
comes from `config/report.json` (override with `ANTHROPIC_MODEL`):

```json
{ "model": "claude-sonnet-4-6", "maxTokens": 768 }
```

Use **Settings → Test Anthropic connection** to verify your API key and network reachability to
`api.anthropic.com`. Step-by-step logs appear in the UI and the API console.

---

## PDF export

**Export PDF** on the report renders a print-optimized page server-side via headless Chromium.

- **In Docker:** works out of the box — the API image installs Chromium and sets `PUPPETEER_EXECUTABLE_PATH`
  and `PDF_PRINT_URL` automatically.
- **In local dev:** point the API at a local Chrome and the running web app (add to `.env`; `npm run dev` loads it on Mac and Windows):

  ```bash
  # Mac
  PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  # Windows — quote paths with spaces; forward slashes are fine
  PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

  PDF_PRINT_URL=http://localhost:3000/print/report
  ```

If the binary is missing you'll get a clear `Chromium not found at ...` error rather than a crash.

---

## Data sources

Use **files**, **APIs**, or **both**:

| Mode | Setup |
|---|---|
| **Excel only** | Copy/upload `.xlsx` to `input/`; integrations `enabled: false` |
| **API only** | Integrations `enabled: true`; credentials in `.env`; QMetry `cycleIds` set |
| **Mixed** | Enable APIs and keep Excel in `input/` — data is merged |

**Expected Excel types**

| File | Detection headers | Sheet |
|---|---|---|
| Zephyr export | `Test Cycle Key`, `Testcase/Teststep Execution Result` | `Data` or first |
| JIRA export | `Issue Type`, `Key` (header ~row 4) | `general_report` |
| ODL UAT | `TicketID`, `odlPriorityDescription` | first |

---

## Using the dashboard

| Tab | Content |
|---|---|
| **Overview** | Result mix, pass rate, story/bug split, defect backlog, monthly chart |
| **Testers** | Per-tester execution stats |
| **Test Cycles** | Cycle health, coverage, pass % (at-risk first) |
| **Traceability** | Feature-area matrix (stories, bugs, completion) |
| **UAT** | ODL UAT issues (shown when ODL data is loaded) |
| **Import Data** | Upload Excel to `input/` |
| **AI Report** | Generate the Claude narrative + PDF export |
| **Settings** | Integration status and env hints |

**Global filters** (top bar) call `GET /api/dashboard` with `startDate`, `endDate`, `search`,
`result` (PASS/FAIL/BLOCKED/all), and `project`. All tabs render from the same backend-filtered payload.

---

## CLI & tests

```bash
# CLI report generation
./run.sh generate 2026-06-24 2026-06-30 full
npm run generate -- --start-date 2026-06-24 --end-date 2026-06-30 --report-type full
# Report types: full | executive | testers | cycles

# Tests (parser regressions + filter acceptance)
npm test
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API health check |
| `GET` | `/api/status` | API key & JIRA credential status |
| `GET` | `/api/dashboard?startDate&endDate&search&result&project` | Filtered dashboard payload |
| `POST` | `/api/generate` | Parse/fetch, write JSON + optional AI report |
| `GET` | `/api/report` | Last generated markdown report |
| `POST` | `/api/report/pdf` | Server-rendered PDF of the report |
| `GET` | `/api/integrations` | Integration config summary |
| `POST` | `/api/integrations/test` | Test JIRA/QMetry fetch |
| `POST` | `/api/upload` | Stage an Excel file to `input/` |
| `GET` | `/api/input/files` | List staged files |
| `DELETE` | `/api/input/:filename` | Remove a staged file |

---

## Architecture

```
input/ + integrations → parse → raw-dataset.json (cache)
                                      ↓
                          applyFilters (date, search, result, project)
                                      ↓
                          buildDashboardPayload → dashboard-data.json
                                      ↓
                   React UI (render only) · AI report · PDF · CLI
```

The React app performs **no aggregation** — it renders backend JSON. See [`TECH_STACK.md`](TECH_STACK.md)
for the full stack and a diagram, and [`docs/AGGREGATION.md`](docs/AGGREGATION.md) for metric definitions.

The AI report gives Claude six read-only dataset tools so numbers are never invented:
`get_result_mix`, `get_tester_stats`, `get_cycle_health`, `get_story_bug_split`, `get_defect_backlog`,
`get_traceability`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **AI report: `Connection error` (Docker)** | The container may not reach `api.anthropic.com` directly. Use `./run.sh dev` on the host, or set `ANTHROPIC_PROXY_URL` in `.env` and `./run.sh docker restart`. |
| **AI report: 401 / auth error** | `ANTHROPIC_API_KEY` is missing, invalid, or revoked — rotate and update `.env`. |
| **PDF export fails locally** | Set `PUPPETEER_EXECUTABLE_PATH` and `PDF_PRINT_URL` (see [PDF export](#pdf-export)). |
| **Empty dashboard** | Stage files in `input/` or enable integrations, then **Generate Report**. |
| **JIRA API errors** | Check `JIRA_EMAIL` / `JIRA_API_TOKEN` and `enabled: true` in `integrations.json`. |
| **Port 3000/3001 in use** | Stop the conflicting process or change ports (`vite.config.ts` / `docker-compose.yml`). |
| **`.env` not loaded (Docker)** | Ensure `.env` exists in the repo root before `docker compose up`. |
| **`.env` not loaded (local dev)** | Run `npm run dev` from the repo root — the API loads repo-root `.env` automatically on Mac and Windows. Do **not** use `source .env` in Git Bash; unquoted Windows paths break `source`. Quote paths with spaces in `.env`. |
| **`docker: command not found`** | Install [Docker Desktop](https://www.docker.com/products/docker-desktop/). |
| **Changes not reflected (Docker)** | `./run.sh docker restart` after code changes. |

---

## Security

- **Never commit secrets.** `.env`, `config/integrations.json`, and `fixtures/input/` are gitignored. Only
  `*.example` templates are tracked.
- **Secrets live in the environment**, not in source — API keys and tokens go in `.env`.
- **If a secret is ever exposed** (committed, pasted, logged), treat it as compromised and **rotate it**
  immediately — revoke and reissue the key/token. Scrubbing history does not un-leak it.
- **Use placeholders in docs and examples** — no real hostnames, emails, or IDs in tracked files.

---

## Contributing

Contributions are welcome. In short:

1. Branch from `main` (`feature/<short-name>`).
2. `npm install`, make your change, and keep it type-safe (`npm run build`).
3. Run `npm test` before opening a PR.
4. Don't commit secrets or real data exports.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for details.

---

## License

Released under the [MIT License](LICENSE).
