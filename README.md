<div align="center">

# Weekly QA Report Dashboard

**A file-based QA intelligence dashboard for test execution, defect tracking, traceability, AI summaries, and PDF reporting.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![No database](https://img.shields.io/badge/database-none-lightgrey)](#architecture)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

QA teams usually collect weekly quality data from many places: test execution exports, JIRA issues, QMetry cycles, vendor-portal bugs, and manual spreadsheets. This project consolidates those sources into a single dashboard, computes the metrics on the backend, generates an AI-written management report, and exports a print-ready PDF.

The application is intentionally **stateless and file-based**. It does not require a database. Runtime state is stored in local folders such as `input/`, `output/`, and `config/`.

<div align="center">

![Dashboard screenshot](docs/screenshot.png)

<sub>Add or replace <code>docs/screenshot.png</code> with a screenshot from your running dashboard.</sub>

</div>

---

## Table of contents

1. [What this project does](#what-this-project-does)
2. [Current implementation](#current-implementation)
3. [Features](#features)
4. [Prerequisites](#prerequisites)
5. [Quick start](#quick-start)
6. [Project structure](#project-structure)
7. [Configuration](#configuration)
8. [Live JIRA and QMetry integration](#live-jira-and-qmetry-integration)
9. [AI report configuration](#ai-report-configuration)
10. [PDF export](#pdf-export)
11. [Data sources](#data-sources)
12. [Using the dashboard](#using-the-dashboard)
13. [CLI and tests](#cli-and-tests)
14. [API reference](#api-reference)
15. [Architecture](#architecture)
16. [Troubleshooting](#troubleshooting)
17. [Security](#security)
18. [Contributing](#contributing)
19. [License](#license)

---

## What this project does

This project converts QA execution data into a management-ready weekly report.

It supports:

- Excel-based imports for test execution, JIRA issue exports, and vendor-portal/UAT bug logs.
- Live JIRA issue fetch using `/rest/api/2/search`.
- Live QMetry test-cycle/test-case fetch using QTM4J UI API endpoints.
- Backend aggregation for result mix, pass rate, tester productivity, test-cycle health, story/bug split, defect backlog, traceability, and vendor-portal bugs.
- AI-generated QA sprint reports using configurable LLM providers.
- PDF export using a print-optimized React route rendered by headless Chromium.
- Docker and local development modes.

---

## Current implementation

The current implementation has three main applications:

| App | Location | Responsibility |
|---|---|---|
| Batch/core | `apps/batch` | Parse files, call integrations, merge data, aggregate metrics, generate AI report text |
| API | `apps/api` | Express API for dashboard data, generation, uploads, integrations, status, and PDF export |
| Web | `apps/web` | React/Vite dashboard UI, import screen, settings, AI report screen, and print route |

The dashboard is backend-driven. The React app renders the JSON returned by the API; it does not calculate the core QA metrics in the browser.

Current backend flow:

```text
Excel files + live integrations
          ↓
parse and normalize dataset
          ↓
raw-dataset.json
          ↓
apply date/search/result/project filters
          ↓
buildDashboardPayload
          ↓
dashboard-data.json
          ↓
React dashboard + AI report + PDF export
```

Current dashboard areas:

| Area | Description |
|---|---|
| Overview | KPIs, result mix, pass rate, story/bug split, defect backlog, trend charts |
| Testers | Per-tester execution count, pass/fail/block status, productivity indicators |
| Test Cycles | Cycle-level health, coverage, pass percentage, at-risk cycles |
| Traceability | Story/bug/test coverage view with sprint and issue details where available |
| Vendor Portal Bugs | UAT/vendor-portal issue view when matching data is loaded |
| Import Data | Upload and manage Excel files staged in `input/` |
| AI Report | Generate a business-ready QA report and export it to PDF |
| Settings | Configure integrations, LLM provider/model, and connection checks |

Recent implementation details included in this README:

- JIRA search path defaults to `/rest/api/2/search` for on-prem and cloud-style profiles.
- JIRA authentication supports email/token Basic auth, raw base64 Basic auth, full `Basic ...` header, and full `Bearer ...` header.
- Optional JIRA session cookie support is available through `JIRA_SESSION_HEADER` for on-prem instances that redirect unauthenticated REST calls to HTML login pages.
- Default JIRA fields are aligned with common Postman/JIRA search requests, including summary, status, assignee, reporter, labels, priority, resolution, components, fix versions, and common custom fields.
- AI report generation supports multiple LLM providers: Anthropic, OpenAI, Gemini, and OpenAI-compatible endpoints.
- Vendor-specific naming has been generalized in the UI and documentation.

---

## Features

- **Multi-source ingestion** — combine Excel exports and live API data.
- **No database** — runtime files are stored locally and can be mounted into Docker.
- **Backend-computed metrics** — consistent calculations across dashboard, report, CLI, and PDF.
- **Live JIRA integration** — configurable JQL, project keys, pagination, field list, and auth strategy.
- **Live QMetry integration** — fetch test cycles and test cases through QTM4J UI API endpoints.
- **Traceability view** — connects work items, bugs, sprint details, and execution health where data exists.
- **Vendor Portal Bugs view** — tracks UAT/vendor-portal defect data separately from general JIRA bugs.
- **AI report generation** — produces management-ready report sections from the current dataset.
- **PDF export** — renders the report through headless Chromium for consistent output.
- **Docker-ready** — API and web containers run with mounted `input/`, `output/`, and `config/` folders.
- **Security-aware defaults** — secrets stay in `.env`; real exports and integration configs are gitignored.

---

## Prerequisites

| Tool | Version | Required for |
|---|---:|---|
| Node.js | 20+ | Local development |
| npm | 9+ | Local development |
| Docker Desktop | Latest | Docker deployment |
| Docker Compose | v2+ | Docker deployment |
| Chrome or Chromium | Recent version | Local PDF export only; Docker image includes Chromium |

Optional accounts/credentials:

- JIRA account or token for live issue fetch.
- QMetry/QTM4J access for live test-cycle/test-case fetch.
- LLM provider API key for AI report generation.

---

## Quick start

### Mac/Linux

```bash
chmod +x run.sh
git clone <repo-url>
cd weekly-qa-report
./run.sh setup
./run.sh dev
```

Then open:

```text
http://localhost:3000
```

### Windows

Use CMD or PowerShell:

```bat
run.bat setup
run.bat dev
```

Then open:

```text
http://localhost:3000
```

Core dashboard usage:

1. Open **Import Data**.
2. Upload one or more Excel exports.
3. Click **Generate Report**.
4. Review the dashboard tabs.
5. Open **AI Report** to generate a narrative report and export PDF.

No API key is required for Excel-only dashboard usage. API keys are only required for live integrations or AI summaries.

---

## Project structure

```text
weekly-qa-report/
├── apps/
│   ├── batch/                      # Parser, integration clients, aggregation, AI report logic, CLI
│   ├── api/                        # Express API, upload routes, dashboard routes, PDF routes
│   └── web/                        # React/Vite dashboard UI
├── config/
│   ├── integrations.example.json   # Template for JIRA/QMetry settings
│   ├── integrations.json           # Local integration settings; gitignored
│   └── report.json                 # LLM provider/model/token settings
├── input/                          # Uploaded/staged Excel exports; gitignored
├── output/                         # Generated JSON/report artifacts; gitignored
├── fixtures/
│   ├── synthetic/                  # Safe committed test fixtures
│   └── input/                      # Optional real local exports; gitignored
├── docs/
│   └── AGGREGATION.md              # Metric definitions and aggregation rules
├── run.sh                          # Mac/Linux helper script
├── run.bat                         # Windows helper script
├── docker-compose.yml              # API and web containers
├── TECH_STACK.md                   # Stack overview and architecture notes
├── .env.example                    # Environment variable template
└── .env                            # Local secrets; gitignored
```

---

## Configuration

### 1. First-time setup

```bash
./run.sh setup
```

The setup command creates required folders, copies template config files where missing, and installs dependencies for local development.

### 2. Environment variables

Create your local `.env` file:

```bash
cp .env.example .env
```

Common variables:

| Variable | Required for | Description |
|---|---|---|
| `NODE_ENV` | Runtime | Usually `development` locally |
| `PORT` | API | API port; default is `4000` or the configured project value |
| `WEB_PORT` | Web | Web app port; default is `3000` |
| `PROJECT_ROOT` | Runtime | Root folder override |
| `INPUT_DIR` | Runtime | Input folder override |
| `OUTPUT_DIR` | Runtime | Output folder override |
| `CONFIG_DIR` | Runtime | Config folder override |
| `LLM_PROVIDER` | AI report | `anthropic`, `openai`, `gemini`, or `openai-compatible` |
| `LLM_MODEL` | AI report | Default model used when provider-specific override is not set |
| `ANTHROPIC_API_KEY` | AI report | Anthropic credential |
| `OPENAI_API_KEY` | AI report | OpenAI credential |
| `GEMINI_API_KEY` | AI report | Gemini credential |
| `CUSTOM_LLM_API_KEY` | AI report | Credential for OpenAI-compatible providers |
| `CUSTOM_LLM_BASE_URL` | AI report | Base URL for OpenAI-compatible providers |
| `JIRA_EMAIL` | Live JIRA/QMetry | Username/email for Basic auth when using email + token |
| `JIRA_API_TOKEN` | Live JIRA/QMetry | Token/password or full `Basic ...` / `Bearer ...` header |
| `JIRA_ONPREM_SECRET` | Live JIRA | Optional on-prem secret used by configured profiles |
| `JIRA_SESSION_HEADER` | Live JIRA | Optional cookie string for on-prem JIRA behind SSO/session redirect |
| `QMETRY_BASIC_AUTH` | Live QMetry | Pre-encoded Basic auth header for QMetry calls |
| `PUPPETEER_EXECUTABLE_PATH` | PDF export | Local Chrome/Chromium path |
| `PDF_PRINT_URL` | PDF export | Print route URL used by PDF renderer |

Do not commit `.env`.

### 3. Integration config

Copy the example config:

```bash
cp config/integrations.example.json config/integrations.json
```

Use `config/integrations.json` for local JIRA/QMetry settings only. The file should stay gitignored.

---

## Live JIRA and QMetry integration

Live integrations are optional. Excel-only usage works with both integrations disabled.

### JIRA search

The JIRA client posts to:

```text
/rest/api/2/search
```

The request body follows the standard JIRA search shape:

```json
{
  "jql": "project = QA AND issuetype in (Story, Bug) ORDER BY updated DESC",
  "startAt": 0,
  "maxResults": 100,
  "fields": [
    "summary",
    "description",
    "assignee",
    "status",
    "priority",
    "issuetype",
    "created",
    "updated",
    "resolution",
    "resolutiondate",
    "resolved",
    "reporter",
    "labels",
    "components",
    "fixVersions",
    "customfield_10020",
    "customfield_10016",
    "customfield_10028"
  ]
}
```

Supported JIRA auth formats:

| Input style | Example value |
|---|---|
| Email + token | `JIRA_EMAIL=user@example.com`, `JIRA_API_TOKEN=<token>` |
| Raw base64 Basic value | `JIRA_API_TOKEN=<base64-user-colon-token>` |
| Full Basic header | `JIRA_API_TOKEN=Basic <base64-user-colon-token>` |
| Full Bearer header | `JIRA_API_TOKEN=Bearer <token>` |

For on-prem JIRA instances that return an HTML login page instead of JSON, an optional session cookie can be supplied:

```bash
JIRA_SESSION_HEADER=JSESSIONID=<value>; atlassian.xsrf.token=<value>
```

Important notes about `JIRA_SESSION_HEADER`:

- Use the cookie value only, without the `Cookie:` prefix.
- Treat it as a secret.
- Do not commit it.
- It is session-based and can expire.
- Prefer proper Basic or Bearer authentication when the server allows it.

### JIRA config example

```json
{
  "jira": {
    "enabled": true,
    "name": "Primary JIRA",
    "deploymentType": "on-prem",
    "baseUrl": "https://your-jira-host",
    "searchPath": "/rest/api/2/search",
    "projectKeys": ["QA"],
    "jql": "project = QA AND issuetype in (Story, Bug) ORDER BY updated DESC",
    "pageSize": 100,
    "statusDone": ["Done", "Closed", "Resolved", "Cancel"]
  }
}
```

### QMetry/QTM4J config example

```json
{
  "qmetry": {
    "enabled": true,
    "baseUrl": "https://your-jira-host",
    "apiPrefix": "/rest/qtm4j/ui/latest",
    "projectKey": "QA",
    "projectId": "12345",
    "testCyclesSearchPath": "/projects/{projectId}/testcycles/search",
    "testCasesSearchPath": "/testcycles/{cycleId}/testcases/search",
    "testCaseFields": "seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedOn,executedBy,lastModified,build",
    "cycleIds": [],
    "pageSize": 50,
    "maxPages": 200
  }
}
```

---

## AI report configuration

The AI report is generated from the current dataset. The report prompt is designed to produce a structured QA sprint report with sections such as objective, validation focus, defect verification summary, test execution summary, test-cycle health, risks, upcoming plan, and final summary.

Supported providers:

| Provider | Environment key | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Default provider in the template |
| OpenAI | `OPENAI_API_KEY` | Uses configured OpenAI model |
| Gemini | `GEMINI_API_KEY` | Uses configured Gemini model |
| OpenAI-compatible | `CUSTOM_LLM_API_KEY` | Requires `CUSTOM_LLM_BASE_URL` |

Example `.env`:

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=<your-key>
```

Example `config/report.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-haiku-4-5-20251001",
  "maxTokens": 1200
}
```

The AI report must not invent numbers. It should only summarize metrics available in the parsed dataset.

---

## PDF export

The PDF export renders the report through the web app print route and headless Chromium.

In Docker, Chromium is bundled in the API image.

For local development, configure Chrome/Chromium manually if needed:

```bash
# macOS
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Windows
PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

PDF_PRINT_URL=http://localhost:3000/print/report
```

If the browser binary is missing, the API returns a clear PDF export error instead of failing silently.

---

## Data sources

The dashboard can use files, APIs, or both.

| Mode | Setup |
|---|---|
| Excel only | Upload `.xlsx` files through the UI or copy them into `input/`; keep integrations disabled |
| API only | Enable integrations and provide credentials in `.env` |
| Mixed | Keep files in `input/` and enable integrations; the dataset is merged |

Expected Excel/export categories:

| Source type | Typical headers | Purpose |
|---|---|---|
| Test execution export | `Test Cycle Key`, `Testcase/Teststep Execution Result` | Test execution metrics and cycle health |
| JIRA export | `Issue Type`, `Key`, `Status`, `Priority`, `Assignee` | Story/bug metrics and traceability |
| Vendor Portal/UAT bug log | `TicketID`, priority/status-like columns | Separate UAT/vendor defect tracking |

Uploaded files should not contain secrets. Real exports should remain in gitignored local folders only.

---

## Using the dashboard

| Tab | Content |
|---|---|
| Overview | High-level QA KPIs, trend charts, story/bug status, backlog summary |
| Testers | Tester-wise execution and result breakdown |
| Test Cycles | Cycle coverage, pass rate, health indicators, at-risk cycles |
| Traceability | Work item and defect traceability with sprint/issue details when available |
| Vendor Portal Bugs | Vendor/UAT bugs and their status distribution |
| Import Data | Upload Excel files and inspect staged input files |
| AI Report | Generate report narrative and export PDF |
| Settings | Configure integrations, credentials status, and LLM provider/model |

Global dashboard filters:

- Start date
- End date
- Search text
- Result status
- Project

Filters are applied by the backend before the payload is returned to the UI.

---

## CLI and tests

Common commands:

```bash
./run.sh setup
./run.sh dev
./run.sh build
./run.sh test
./run.sh generate 2026-06-24 2026-06-30 full
./run.sh docker
./run.sh docker down
./run.sh docker logs
./run.sh docker restart
```

Manual npm commands:

```bash
npm install
npm run dev
npm run build
npm test
npm run generate -- --start-date 2026-06-24 --end-date 2026-06-30 --report-type full
```

Report types:

```text
full | executive | testers | cycles
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API health check |
| `GET` | `/api/status` | Runtime status and credential availability summary |
| `GET` | `/api/dashboard` | Filtered dashboard payload |
| `POST` | `/api/generate` | Parse/fetch data, aggregate metrics, write output artifacts, optionally generate AI report |
| `GET` | `/api/report` | Last generated markdown report |
| `POST` | `/api/report/pdf` | Generate PDF using the print route |
| `GET` | `/api/integrations` | Integration configuration summary |
| `POST` | `/api/integrations/test` | Test live JIRA/QMetry connectivity |
| `POST` | `/api/integrations/test-connection` | Test a user-provided connection from Settings |
| `POST` | `/api/upload` | Upload an Excel file into `input/` |
| `GET` | `/api/input/files` | List staged input files |
| `DELETE` | `/api/input/:filename` | Delete a staged input file |

Dashboard query parameters:

| Parameter | Description |
|---|---|
| `startDate` | Include records active/updated from this date |
| `endDate` | Include records active/updated up to this date |
| `search` | Search text across supported fields |
| `result` | Execution result filter such as PASS, FAIL, BLOCKED, or all |
| `project` | Project key/name filter |

---

## Architecture

```text
             ┌────────────────────────┐
             │ Excel exports / uploads │
             └───────────┬────────────┘
                         │
             ┌───────────▼────────────┐
             │ Live JIRA/QMetry APIs   │
             └───────────┬────────────┘
                         │
             ┌───────────▼────────────┐
             │ apps/batch              │
             │ parse + normalize       │
             │ merge + aggregate       │
             └───────────┬────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ output/dashboard-data.json   │
          │ output/raw-dataset.json      │
          │ output/report.md             │
          └──────────────┬──────────────┘
                         │
       ┌─────────────────▼─────────────────┐
       │ apps/api                           │
       │ dashboard, generate, upload, PDF   │
       └─────────────────┬─────────────────┘
                         │
       ┌─────────────────▼─────────────────┐
       │ apps/web                           │
       │ React dashboard + print route      │
       └───────────────────────────────────┘
```

Design principles:

- Keep aggregation logic in the backend.
- Keep the UI display-only where possible.
- Keep secrets out of source code.
- Keep generated files out of Git.
- Keep the product portable across teams and organizations.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Empty dashboard | No data loaded | Upload Excel files or enable integrations, then generate again |
| JIRA returns HTML instead of JSON | REST call is redirected to login/SSO page | Verify auth header; use `JIRA_SESSION_HEADER` only if required by your on-prem setup |
| JIRA 401 | Credentials rejected | Recreate token/password/header and update `.env` |
| JIRA 403 | User lacks permission | Confirm project browse/search permissions |
| JIRA search returns no issues | JQL too narrow or project key mismatch | Test the JQL in JIRA first, then update config |
| QMetry returns no cycles | Project ID or cycle IDs are wrong | Check `projectId`, `cycleIds`, and QTM4J endpoint access |
| AI report fails with auth error | Missing/invalid provider key | Update the correct provider API key in `.env` |
| AI report connection error | Network/proxy issue | Configure corporate proxy variables if needed |
| PDF export fails locally | Chrome path missing | Set `PUPPETEER_EXECUTABLE_PATH` and `PDF_PRINT_URL` |
| Docker changes not visible | Code changed after image build | Run `./run.sh docker restart` |
| Port already in use | Another process is using the port | Stop the process or change the port |
| `.env` not loaded | Command was not run from repo root | Run scripts from the repo root; do not use `source .env` in Git Bash |

---

## Security

- Never commit `.env`.
- Never commit `config/integrations.json` if it contains real hosts, credentials, project IDs, or JQL tied to private data.
- Never commit real Excel exports.
- Keep `.env.example` and `config/integrations.example.json` placeholder-only.
- Treat API keys, Basic auth headers, Bearer tokens, and session cookies as secrets.
- If a secret is pasted, logged, or committed, rotate it immediately.
- Do not hardcode `JSESSIONID` or XSRF cookies in source code or README examples.
- Prefer stable token-based auth over browser/session cookies where your JIRA instance supports it.

---

## Contributing

1. Create a feature branch from `main`.
2. Run `npm install`.
3. Make the change with TypeScript-safe code.
4. Run `npm run build`.
5. Run `npm test`.
6. Do not commit secrets, generated output, or real exports.
7. Open a pull request with a clear summary and test evidence.

---

## License

Released under the [MIT License](LICENSE).
