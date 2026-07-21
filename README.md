<div align="center">

# Weekly QA Report Dashboard

**A stateless QA reporting application for test execution, defects, traceability, test-cycle health, AI-assisted management summaries, and PDF reporting.**

</div>

The dashboard combines supported Excel imports with optional live Jira and QMetry/QTM4J connections. It calculates all metrics deterministically, supports project and date filtering, generates management-ready reports, and exports reports to PDF.

> **Security rule:** never commit real credentials, cookies, API keys, access tokens, internal hostnames, production exports, or confidential project data. Configure secrets through the application Settings page or ignored local configuration files.

---

## Table of contents

1. [Capabilities](#capabilities)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick start](#quick-start)
5. [Windows setup](#windows-setup)
6. [macOS and Linux setup](#macos-and-linux-setup)
7. [Docker deployment](#docker-deployment)
8. [Share the app on a local network](#share-the-app-on-a-local-network)
9. [Configuration](#configuration)
10. [Data modes and Excel imports](#data-modes-and-excel-imports)
11. [Jira setup](#jira-setup)
12. [QMetry/QTM4J setup](#qmetryqtm4j-setup)
13. [AI provider setup](#ai-provider-setup)
14. [Using the dashboard](#using-the-dashboard)
15. [Build and test](#build-and-test)
16. [Operations and upgrades](#operations-and-upgrades)
17. [Troubleshooting](#troubleshooting)
18. [API reference](#api-reference)
19. [Security checklist](#security-checklist)

---

## Capabilities

- Import test-execution, Jira issue, and UAT/vendor issue Excel files.
- Optionally retrieve live Jira issues.
- Optionally retrieve live QMetry/QTM4J cycles and testcase executions.
- Support Excel-only, Jira-only, QMetry-only, and mixed-data projects.
- Apply project, date, text-search, and execution-result filters.
- Show execution totals, pass rate, result mix, Quality Assurance contribution, cycle health, story/bug split, defect backlog, traceability, and UAT status.
- Resolve Quality Assurance identifiers to display names when the source system permits it.
- Generate Full, Executive, Defects, and Cycles reports.
- Generate an optional AI-written narrative grounded only in calculated metrics.
- Export print-ready PDF reports through headless Chromium.
- Run locally or with Docker without a database.

---

## Architecture

| Component | Location | Responsibility |
|---|---|---|
| Batch/core | `apps/batch` | Parsing, source integrations, normalization, deduplication, filtering, metrics, and report data |
| API | `apps/api` | Express API, uploads, synchronization, search, report generation, and PDF generation |
| Web | `apps/web` | React/Vite user interface, Settings, imports, dashboards, reports, and print route |

Runtime directories:

```text
input/projects/<project-id>/   Project-owned staged Excel files
output/import-projects/        Reconciled per-project datasets
output/import-sync/            Import reconciliation jobs and downloadable evidence
output/                        Combined datasets, dashboards, and reports
config/projects.json           Project registry
config/project-imports.json    File ownership manifest
```

The application is file-backed and does not require a database. These directories must be persistent when the application is deployed with containers.

---

## Prerequisites

### Local development

| Tool | Version |
|---|---:|
| Node.js | 20 or later |
| npm | Included with Node.js |
| Git | Current stable release |
| Chrome, Chromium, or Edge | Required for local PDF export |

Verify:

```bash
node --version
npm --version
git --version
```

### Docker deployment

| Tool | Version |
|---|---:|
| Docker Desktop or Docker Engine | Current stable release |
| Docker Compose | Compose v2 |
| Git | Current stable release |

Verify:

```bash
docker --version
docker compose version
```

Docker-only deployment does not require Node.js or npm on the host.

---

## Quick start

### Local development

```bash
git clone <repository-url>
cd weekly-qa-report
./run.sh setup
./run.sh dev
```

Open:

```text
Web:        http://localhost:3000
API health: http://localhost:3001/health
```

### Docker

```bash
git clone <repository-url>
cd weekly-qa-report
mkdir -p input output config
cp -n config/runtime.example.json config/runtime.json
cp -n config/integrations.example.json config/integrations.json
docker compose up --build -d
```

Open:

```text
http://localhost:3000
```

---

## Windows setup

Git for Windows is recommended because it includes Git Bash.

### Option A: Git Bash — recommended

```bash
git clone <repository-url>
cd weekly-qa-report
./run.sh setup
./run.sh dev
```

The development runner:

- creates missing runtime directories;
- remaps container-only paths to local Windows paths;
- detects a supported browser for PDF generation;
- clears only generated dashboard cache files;
- starts the API and web applications.

### Option B: PowerShell or Command Prompt

First-time setup:

```powershell
git clone <repository-url>
Set-Location weekly-qa-report
.\run.bat setup
```

Start through the cross-platform development runner:

```powershell
node .\scripts\dev-runner.cjs
```

Open the application:

```powershell
Start-Process "http://localhost:3000"
```

### Direct npm startup

```powershell
npm run dev
```

Direct npm startup is supported, but it bypasses local path preparation, automatic browser detection, and generated-cache cleanup. Prefer `node .\scripts\dev-runner.cjs` or Git Bash `./run.sh dev` for normal use.

### Pull the latest branch

```powershell
git fetch origin
git switch fix-runtime-project-data-rc2
git pull --ff-only origin fix-runtime-project-data-rc2
```

---

## macOS and Linux setup

```bash
git clone <repository-url>
cd weekly-qa-report
chmod +x run.sh
./run.sh setup
./run.sh dev
```

Open:

```text
http://localhost:3000
```

The API runs at:

```text
http://localhost:3001
```

---

## Docker deployment

Docker is the recommended option for a shared demonstration or a small internal installation.

### 1. Clone and prepare persistent folders

Linux, macOS, or Git Bash:

```bash
git clone <repository-url>
cd weekly-qa-report
mkdir -p input output config
cp -n config/runtime.example.json config/runtime.json
cp -n config/integrations.example.json config/integrations.json
```

Windows PowerShell:

```powershell
git clone <repository-url>
Set-Location weekly-qa-report
New-Item -ItemType Directory -Force input, output, config | Out-Null
if (-not (Test-Path config\runtime.json)) {
  Copy-Item config\runtime.example.json config\runtime.json
}
if (-not (Test-Path config\integrations.json)) {
  Copy-Item config\integrations.example.json config\integrations.json
}
```

### 2. Build and start

```bash
docker compose up --build -d
```

Equivalent helper command when Bash is available:

```bash
./run.sh docker
```

### 3. Verify

```bash
docker compose ps
```

Expected services:

```text
dashboard-api
dashboard-web
```

API health:

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{
  "ok": true
}
```

Open:

```text
http://localhost:3000
```

### 4. View logs

```bash
docker compose logs -f
```

API only:

```bash
docker compose logs -f dashboard-api
```

Web only:

```bash
docker compose logs -f dashboard-web
```

### 5. Stop or restart

```bash
docker compose down
```

```bash
docker compose restart
```

Rebuild after source-code changes:

```bash
docker compose up --build -d
```

### 6. Persistent storage

Docker mounts:

```text
./input  -> /data/input
./output -> /data/output
./config -> /data/config
```

Back up these three local directories before moving the deployment or upgrading the host.

### 7. Upgrade an installation

```bash
git pull --ff-only
docker compose down
docker compose up --build -d
docker compose ps
docker compose logs --tail=200
```

### 8. Shared deployment guidance

For persistent shared access:

- publish the web application through an approved HTTPS endpoint;
- apply authentication and access controls at the platform boundary;
- keep direct API access restricted unless it is operationally required;
- keep `input/`, `output/`, and `config/` on persistent storage;
- implement host monitoring and backups;
- store secrets using an approved secret-management mechanism.

---

## Share the app on a local network

Use this only on a trusted network and only when local policy permits inbound connections.

### Local development

The default Vite server is intended for the local machine. To allow another device on the same network to access the UI, start the API and web application in separate terminals.

Terminal 1:

```bash
npm run dev --workspace=apps/api
```

Terminal 2:

```bash
npm run dev --workspace=apps/web -- --host 0.0.0.0
```

Find the host computer's IPv4 address.

Windows:

```powershell
ipconfig
```

macOS/Linux:

```bash
ip addr
```

Another user on the same network can then open:

```text
http://<host-ip-address>:3000
```

The host firewall must allow inbound TCP traffic on port `3000`. Administrator rights may be required. Do not bypass device-management or security policy; request approval when the device is managed.

The API does not normally need to be exposed separately because the web development server forwards `/api` requests to the API on the same host.

### Docker

Docker Compose publishes the web application on host port `3000`. After the containers are healthy, another device on the same network can open:

```text
http://<host-ip-address>:3000
```

Keep port `3001` restricted unless direct API access is required.

For broader access, use an approved HTTPS deployment rather than relying on a developer laptop.

---

## Configuration

Normal users should configure connections through the **Settings** page.

| Configuration source | Purpose |
|---|---|
| Settings page | User-managed Jira, QMetry, and AI connections |
| `config/runtime.json` | Runtime directories, browser path, PDF print route, TLS and certificate options |
| `config/integrations.json` | Optional server-managed Jira and QMetry defaults |

Recommended local paths:

```json
{
  "paths": {
    "inputDir": "input",
    "outputDir": "output",
    "configDir": "config",
    "puppeteerExecutablePath": "",
    "pdfPrintUrl": "http://localhost:3000/print/report"
  }
}
```

Docker supplies container paths through environment variables. Local users should use repository-relative paths.

Do not store real secrets in example files.

---

## Data modes and Excel imports

### Data modes

| Mode | Required setup | Available information |
|---|---|---|
| Excel only | Upload supported Excel files | Depends on uploaded file types |
| Jira only | Configure Jira | Stories, bugs, defects, backlog, and traceability |
| QMetry only | Configure QMetry/QTM4J | Test cycles, executions, Quality Assurance attribution, result mix, and coverage |
| Mixed | Configure live sources and/or upload files | Merged and deduplicated reporting data |

A project does not need both Jira and QMetry. Missing source types are shown as unavailable or zero rather than treated as a connection failure.

### Supported extensions

```text
.xlsx
.xls
```

For the web application, create and manage projects in **Settings**. When **All Projects** is selected, Settings shows every project's Jira and QMetry connection, allows connection editing, and can test or synchronize all enabled live connections. File import is intentionally different: select one existing project in **Import Data** before uploading or synchronizing files. The API stores every file beneath that project's own directory and records ownership in the import manifest. The standalone batch CLI can still read files copied directly into its configured input directory.

### Project-scoped import workflow

1. Choose **All Projects** in the main dropdown, then create or maintain projects and review all live Jira/QMetry connections in **Settings**. Each logical dashboard project has one primary key plus optional associated source keys. For example, primary `DTTRV` with associated key `DP` consolidates both sources into one project. Keys and names can be updated; changes are migrated across project-owned imported data and browser connection mappings.
2. Select one existing project in **Import Data** and upload Excel files. Only files owned by the selected project are listed. If **All Projects** is selected, upload, file listing, removal, and synchronization controls are not rendered.
3. The web application automatically synchronizes the selected project's files once the upload batch completes, replaces the in-memory dashboard snapshot with the rebuilt response, and refreshes the relevant tabs. **Re-sync imported data** remains available to rebuild from files already owned by that project.
4. Review the reconciliation job: status, timing, initiator, per-file type/sheet, rows found, created/updated/skipped/rejected rows, row-level rejection reasons, validation messages, category totals, and previous-versus-new totals.
5. Download the reconciliation CSV when evidence or row-level failure follow-up is required.

The backend validates project ownership for list, sync, report download, and delete operations. An unscoped import request is rejected.

### Test-execution file

Required headers:

```text
Test Cycle Key
Testcase/Teststep Execution Result
```

Recommended headers:

```text
Test Case Key
Test Cycle Summary
Executed On
Executed By
Updated
```

Enables Overview execution metrics, result mix, pass rate, Quality Assurance metrics, cycle health, and Cycles reports.

### Jira issue file

Required headers:

```text
Key
Summary
```

or:

```text
Issue key
Summary
```

Recommended headers:

```text
Issue Type
Status
Priority
Assignee
Created
Updated
Resolved
Sprint
```

Enables story/bug counts, backlog, traceability, and Defects reports.

For the `DTTRV` dashboard project, a Jira issue file is also treated as a **Wonder Miles Story/Bug export**. After upload, the web application synchronizes it automatically and its rows appear in **Wonder Miles Export Data**. That tab reads only `jira-file` rows from DTTRV's project-owned import cache; live Jira and QMetry data is excluded. Each row retains its original upload filename for traceability.

### UAT/vendor issue file

Required headers:

```text
TicketID
odlPriorityDescription
Status
```

Recommended headers:

```text
Subject
ProductArea
Change Request
Client_Priority
Submittedby
Submittedon
LastUpdate
```

Enables UAT/vendor issue metrics and status views.

### File detection

Each uploaded file is classified as:

```text
test-execution
jira
odl
unknown
```

A file detected as `unknown` does not match a supported header pattern.

---

## Jira setup

Jira is optional.

Open:

```text
Settings -> Jira Connections
```

Configure:

| Field | Example |
|---|---|
| Connection name | `QA Jira` |
| Deployment type | Cloud or on-premises |
| Base URL | `https://jira.example.com` |
| Project key | `QA` |
| Search path | `/rest/api/2/search` |
| JQL | `project = QA AND issuetype in (Story, Bug) ORDER BY updated DESC` |
| Authentication | Basic, bearer, or session-based according to the Jira installation |

The selected dashboard date range is added to the configured JQL using this rule:

```text
Created in range
OR Updated in range
OR Resolved in range
```

Test the connection before live synchronization. Treat passwords, tokens, authorization headers, and session cookies as secrets.

---

## QMetry/QTM4J setup

QMetry/QTM4J is optional and can be configured without Jira reporting.

Open:

```text
Settings -> QMetry Connections
```

Configure:

| Field | Example |
|---|---|
| Connection name | `QA QMetry` |
| Base URL | `https://jira.example.com` |
| Project key | `QA` |
| Project ID | `12345` |
| Folder ID | Optional |
| API prefix | `/rest/qtm4j/ui/latest` |

The supported testcase search contract is:

```text
POST /rest/qtm4j/ui/latest/testcycles/{cycleId}/testcases/search
```

Request body:

```json
{
  "filter": {
    "projectId": 12345
  }
}
```

For reports with both a start and end date, execution totals, result mix, and Quality Assurance attribution use QMetry's execution-level summary contract:

```text
POST /rest/qtm4j/ui/latest/gadgets/TESTCASE_EXECUTION_SUMMARY_BY_ASSIGNEE
```

The request filters `execution.executedon` inclusively, requests only the latest executions, and excludes archived testcases and cycles. This summary is authoritative for the exact requested report window. Detailed testcase rows remain the source for cycle-health breakdowns; cycle-level progress is used only as a fallback and never invents Quality Assurance names or execution dates.

The gadget response differs across on-prem QMetry versions. The application accepts recognized row-oriented and chart-oriented result/count shapes. If the response cannot be interpreted safely, it logs a warning and retains the detailed-cycle fallback instead of showing guessed counts.

Quality Assurance attribution uses available execution-assignee data and resolves technical user identifiers to display names when the authenticated account has permission. A last-updated user is not used to attribute a Not Executed record.

Test the connection and load folders before searching cycle details.

---

## Narrative provider setup

AI is optional. All KPIs, charts, counts, filters, and report data are calculated without AI. The deterministic template provider can also produce the Narrative Summary without an API key or network request.

Open:

```text
Settings -> Narrative Provider
```

Supported modes:

- Anthropic official endpoint
- Anthropic custom endpoint
- OpenAI
- Gemini
- OpenAI-compatible custom endpoint
- Template (No AI)

Configure:

| Field | Description |
|---|---|
| Provider | Protocol used by the endpoint |
| Endpoint | Official API or custom URL, when supported |
| Model | Provider model name or custom model identifier |
| API key | Secret used by network-backed providers; not required for Template |
| Custom base URL | Required only for a custom endpoint |

Use **Save & Test LLM** for network-backed providers or **Save & Validate** for the deterministic template.

Network-backed providers receive verified report metrics and are instructed not to invent counts, tickets, dates, owners, or conclusions. The Template provider applies deterministic rules to the same metrics and varies its content by report type.

Do not commit AI keys or custom endpoint details.

---

## Using the dashboard

### 1. Choose a project

Use the project selector in the page header.

### 2. Choose a reporting period

The default reporting period starts on `2026-01-01` and ends on the current date.

Each filterable tab keeps its own date, search, and result-filter values.

### 3. Click Search

Changing a filter does not apply it until **Search** is clicked.

Filterable areas:

- Overview
- Quality Assurance
- Test Cycles
- Traceability
- UAT/vendor issues

### 4. Review results

| Area | Primary information |
|---|---|
| Overview | KPIs, result mix, pass rate, defects, execution, and cycle summary |
| Quality Assurance | Named members, attributed executions, unassigned executions, and pass rate |
| Test Cycles | Cycle totals, execution split, coverage, and cycle status |
| Traceability | Story, bug, and test evidence |
| Vendor Portal Bugs | DLM-only vendor bug totals, phase/environment, status, priority, ownership, and source-file traceability. The tab remains available for a configured DLM project even when the selected period contains no rows. |
| Wonder Miles Export Data | DTTRV-only Story/Bug totals, status filters, detail tables, and source-file traceability from uploaded Wonder Miles issue exports. Live Jira/QMetry rows are excluded. |
| Import Data | Single-project selection, isolated project files, synchronization, and detailed reconciliation. All Projects is blocked for file operations. |
| QA Report | Report generation and PDF download |
| Settings | Project creation/update/deletion, associated source-key mapping, one Jira and one QMetry connection per project, aggregate All Projects connection editing/testing/live sync, AI provider, and branding |

Applying dates on **Vendor Portal Bugs** or **Wonder Miles Export Data** refilters cached, project-owned spreadsheet data only. It does not call Jira or QMetry. Date application on the live Jira/QMetry dashboard areas may refresh those configured APIs for the selected project and period.

### 5. Generate a report

Open **QA Report**, select report type, project, start date, and end date, then click **Generate AI Report**.

Report types:

| Type | Purpose |
|---|---|
| Full | Complete QA reporting pack |
| Executive | Management-level summary |
| Defects | Defect-focused report |
| Cycles | Test-cycle-focused report |

The report can still display deterministic metrics and charts when AI is not configured.

Every generated report stores its own project/date/type-scoped chart snapshot. The on-screen report and PDF use that same snapshot; changing the main dashboard cache cannot replace report charts with another scope.

### 6. Download PDF

Click **Download PDF** after report data is available. If the selected project, dates, or report type no longer match the saved report snapshot, generate the report again before downloading.

---

## Build and test

Install exact locked dependencies:

```bash
npm ci
```

Build all workspaces:

```bash
npm run build
```

Run all regression tests:

```bash
npm test
```

Equivalent helper commands:

```bash
./run.sh build
./run.sh test
```

Windows:

```powershell
.\run.bat build
.\run.bat test
```

The automated suite covers parsing, date filters, dashboard calculations, Jira date scoping, QMetry request contracts, Quality Assurance attribution, narrative providers, cache cleanup, and Windows npm startup behavior.

Do not merge changes when the build or regression suite fails.

---

## Operations and upgrades

### Generated-cache cleanup

`./run.sh dev` and `node scripts/dev-runner.cjs` remove only these generated cache files before startup:

```text
raw-dataset.live.json
raw-dataset.json
dataset-fingerprint.txt
dashboard-data.json
```

Imported files, reports, credentials, and configuration are preserved.

Emergency cache-preservation mode:

```bash
PRESERVE_DEV_CACHE=1 ./run.sh dev
```

### Health check

```text
GET http://localhost:3001/health
```

### Backup

Back up:

```text
input/
output/
config/
```

### Restore

1. Stop the application.
2. Restore the three runtime directories.
3. Start the application.
4. Test connections.
5. Run a dashboard Search.

### Local upgrade

```bash
git pull --ff-only
npm ci
npm run build
npm test
./run.sh dev
```

### Clean shutdown

Local:

```text
Ctrl+C
```

Docker:

```bash
docker compose down
```

---

## Troubleshooting

### Windows `spawn EINVAL`

Update the branch and use the current development wrapper:

```bash
git pull --ff-only
./run.sh dev
```

The Windows runner launches npm through the Windows command processor and supports Node.js 20 and later.

### API tries to create `/data/input` locally

Use:

```bash
./run.sh dev
```

or:

```powershell
node .\scripts\dev-runner.cjs
```

The runner converts container-only paths to repository-local paths.

### Port 3000 or 3001 is already in use

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, State, OwningProcess
```

macOS/Linux:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Stop the old process, then restart the application.

### Another device cannot access the application

Check:

1. the web server was started with `--host 0.0.0.0`;
2. both devices are on a network that allows device-to-device communication;
3. the host firewall permits inbound TCP traffic on port `3000`;
4. the user opens `http://<host-ip-address>:3000`, not `localhost`;
5. no device-management policy is blocking inbound access.

### Dashboard shows zero values

Check:

1. the selected project;
2. the selected date range;
3. whether Search was clicked;
4. whether the required source is configured or imported;
5. whether the uploaded file was classified correctly;
6. connection warnings in Settings and API logs.

### Quality Assurance names are missing

Check:

1. detailed QMetry testcase rows are being returned;
2. execution fields contain Executed By information;
3. the authenticated user can read display names;
4. the selected period contains executed testcases;
5. the Quality Assurance tab does not show all executions as unassigned.

Cycle-level fallback counts do not contain a Quality Assurance identity and are intentionally excluded from the ranking.

### QMetry request validation errors

Confirm:

- the Project ID is correct;
- testcase search uses POST;
- the body contains `filter.projectId`;
- the API prefix and search paths match the QMetry installation;
- the session or credentials are valid.

### Jira or QMetry returns HTML instead of JSON

The request was redirected to an authentication or security page. Refresh the required session or correct the connection authentication.

### PDF export fails

Check:

1. the web application is running;
2. a supported browser is installed locally;
3. the browser path printed at startup is valid;
4. the print route is reachable;
5. the API and web containers are healthy in Docker.

### Narrative provider connection test fails

Check:

1. the provider protocol matches the endpoint protocol;
2. the model name is accepted by the endpoint;
3. a custom endpoint includes the correct base path;
4. the API key is valid and authorized;
5. the response is JSON rather than an HTML security page.

---

## API reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | API health |
| `GET` | `/api/status` | Runtime and integration status |
| `GET` | `/api/dashboard` | Read dashboard data |
| `POST` | `/api/dashboard/search` | Apply filters and refresh live data |
| `POST` | `/api/generate` | Generate dataset, dashboard, report data, and optional narrative |
| `GET` | `/api/report` | Read the latest generated report |
| `POST` | `/api/report/pdf` | Generate PDF |
| `GET` | `/api/integrations` | Read integration summary |
| `POST` | `/api/integrations/test` | Test configured integrations |
| `POST` | `/api/integrations/test-connection` | Test a Settings connection |
| `POST` | `/api/llm/test` | Validate the selected narrative provider |
| `GET` | `/api/projects` | List project workspaces |
| `POST` | `/api/projects` | Create a project workspace |
| `PATCH` | `/api/projects/:projectId` | Update a project's primary key, associated source keys, and/or display name, migrating project-owned cached data |
| `DELETE` | `/api/projects/:projectId` | Permanently delete a confirmed project and its owned runtime data |
| `GET` | `/api/projects/:projectId/files` | List only the selected project's staged files |
| `POST` | `/api/projects/:projectId/files` | Upload an Excel file into the selected project |
| `DELETE` | `/api/projects/:projectId/files/:fileId` | Delete a file after verifying project ownership |
| `POST` | `/api/projects/:projectId/imports/sync` | Sync only the selected project and return reconciliation details |
| `GET` | `/api/projects/:projectId/imports/issues/dashboard` | Refilter only uploaded Story/Bug issue rows for one project without calling Jira/QMetry |
| `GET` | `/api/projects/:projectId/imports/:syncId` | Read a project-owned reconciliation job |
| `GET` | `/api/projects/:projectId/imports/:syncId/report.csv` | Download the reconciliation CSV |

---

## Security checklist

Before committing, deploying, or sharing logs:

- Never commit `config/runtime.json` or `config/integrations.json` containing real values.
- Never commit production Excel files.
- Never commit passwords, tokens, API keys, authorization headers, or cookies.
- Never publish internal hostnames, user identifiers, project identifiers, or confidential ticket content.
- Use generic examples in documentation and tests.
- Redact sensitive request and response data from logs.
- Rotate any secret that appears in source control, chat, screenshots, or shared logs.
- Restrict access to the deployment host and persistent runtime directories.
- Use HTTPS and approved access controls for shared environments.
- Review generated reports before distributing them.

The current application is file-based and does not provide centralized multi-user identity management. Large shared deployments should use persistent storage, controlled access, monitoring, backups, and managed secrets.
