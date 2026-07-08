<div align="center">

# Weekly QA Report Dashboard

**A file-based QA reporting dashboard for test execution, defect tracking, traceability, QMetry/QTM4J cycle health, AI-assisted narrative summaries, and PDF reporting.**

</div>

QA teams often collect weekly quality data from several sources: test execution exports, Jira issues, QMetry/QTM4J cycles, vendor/UAT bug logs, and manual spreadsheets. This project consolidates those sources into one dashboard, computes metrics on the backend, generates a management-ready narrative summary from verified metrics, and exports a print-ready PDF.

The application is intentionally **stateless and file-based**. It does not require a database. Runtime state is stored in local folders such as `input/`, `output/`, and `config/`.

> **Security note:** This repository must not contain real company URLs, credentials, cookies, tokens, API keys, or production Excel exports. Use generic examples such as `https://jira.example.com` in documentation and commit only example config files.

---

## Table of contents

1. [What this project does](#what-this-project-does)
2. [Architecture](#architecture)
3. [Project structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Step-by-step local setup](#step-by-step-local-setup)
6. [Step-by-step Docker setup](#step-by-step-docker-setup)
7. [Configuration model](#configuration-model)
8. [Jira integration setup](#jira-integration-setup)
9. [QMetry/QTM4J integration setup](#qmetryqtm4j-integration-setup)
10. [AI provider setup for narrative summary](#ai-provider-setup-for-narrative-summary)
11. [Using the application](#using-the-application)
12. [Report types and expected behavior](#report-types-and-expected-behavior)
13. [PDF export](#pdf-export)
14. [Live integration probe](#live-integration-probe)
15. [Useful commands](#useful-commands)
16. [Troubleshooting](#troubleshooting)
17. [Security checklist](#security-checklist)

---

## What this project does

- Imports Excel files for test execution, Jira issue exports, and vendor/UAT bug logs.
- Fetches live Jira issues using `/rest/api/2/search`.
- Fetches live QMetry/QTM4J test cycles and test-case execution data.
- Aggregates result mix, pass rate, tester productivity, cycle health, story/bug split, defect backlog, traceability, and vendor/UAT bug status.
- Generates a QA-manager-style **Narrative Summary** using a configured AI provider, grounded only on verified dashboard metrics.
- Exports PDF reports through a print-optimized React route and headless Chromium.
- Runs locally or through Docker without a database.

---

## Architecture

| App | Location | Responsibility |
|---|---|---|
| Batch/core | `apps/batch` | Parse files, call integrations, merge/dedupe data, aggregate metrics, generate report narrative |
| API | `apps/api` | Express API for dashboard data, generation, uploads, integrations, status, and PDF export |
| Web | `apps/web` | React/Vite dashboard UI, import screen, settings, report screen, and print route |

Dashboard areas:

| Area | Description |
|---|---|
| Overview | KPIs, result mix, pass rate, story/bug split, defect backlog, trend charts |
| Testers | Per-tester execution count, pass/fail/block status, productivity indicators |
| Test Cycles | Cycle-level health, coverage, pass percentage, at-risk cycles |
| Traceability | Story/bug/test coverage view with sprint and issue details where available |
| Vendor Portal Bugs | UAT/vendor-portal issue view when matching data is loaded |
| Import Data | Upload and manage Excel files staged in `input/` |
| QA Report | Generate a business-ready QA report and export it to PDF |
| Settings | Configure Jira, QMetry/QTM4J, AI provider/model, and connection checks |

---

## Project structure

```text
weekly-qa-report/
├── apps/
│   ├── batch/                      # Parser, integration clients, aggregation, report narrative logic
│   ├── api/                        # Express API, upload routes, dashboard routes, PDF routes
│   └── web/                        # React/Vite dashboard UI
├── config/
│   ├── integrations.example.json   # Template for Jira/QMetry settings
│   ├── integrations.json           # Local integration settings; gitignored
│   ├── runtime.example.json        # Template for server runtime settings
│   ├── runtime.json                # Local runtime settings; gitignored
│   └── report.json                 # Optional AI provider/model defaults
├── input/                          # Uploaded/staged Excel exports; gitignored
├── output/                         # Generated JSON/report artifacts; gitignored
├── scripts/
│   └── live-check-v2.mjs           # Generic Jira/QMetry live connectivity probe
├── docker-compose.yml              # API and web containers
├── run.sh                          # Mac/Linux/Git Bash helper script
└── run.bat                         # Windows helper script
```

---

## Prerequisites

Install the following:

| Tool | Recommended version | Notes |
|---|---:|---|
| Node.js | 20+ | Required for all workspaces |
| npm | 10+ | Installed with Node.js |
| Git | Latest stable | Required to clone/pull the repository |
| Docker Desktop | Latest stable | Optional, only for container-based running |
| Chrome/Chromium | Latest stable | Required for PDF export when not using Docker |

Verify installation:

```bash
node --version
npm --version
git --version
```

---

## Step-by-step local setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd weekly-qa-report
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create local folders

```bash
mkdir -p input output config
```

These folders are used at runtime and should remain local.

### 4. Create local config files only if needed

For UI-only configuration, you can skip this and use the **Settings** screen.

For server-side defaults, copy the examples:

```bash
cp config/runtime.example.json config/runtime.json
cp config/integrations.example.json config/integrations.json
```

Do not commit these generated files.

### 5. Start local development servers

```bash
npm run dev
```

Or use the helper:

```bash
./run.sh dev
```

Open the web app:

```text
http://localhost:3000
```

The API runs on:

```text
http://localhost:3001
```

### 6. Confirm the API is healthy

Open:

```text
http://localhost:3001/health
```

Expected result:

```json
{
  "ok": true
}
```

---

## Step-by-step Docker setup

### 1. Build and start containers

```bash
docker compose up --build
```

Or use:

```bash
./run.sh docker
```

Open:

```text
http://localhost:3000
```

### 2. Stop containers

```bash
docker compose down
```

### 3. Mounted folders

Docker mounts these local folders:

```text
./input  -> /data/input
./output -> /data/output
./config -> /data/config
```

### 4. Docker config behavior

The Docker setup does **not** require a `.env` file. Use:

- the **Settings** screen for user-provided connections and API keys, or
- `config/runtime.json` / `config/integrations.json` for server defaults.

---

## Configuration model

Configuration is split into three places:

| Configuration type | Where to set it | Recommended for |
|---|---|---|
| User connections and API keys | **Settings** screen | Normal local usage |
| Server runtime defaults | `config/runtime.json` | Docker/server paths, proxy, TLS flags, fallback credentials |
| Jira/QMetry profile defaults | `config/integrations.json` | Preconfigured non-UI integration profiles |

Example `config/runtime.json` using generic values only:

```json
{
  "paths": {
    "inputDir": "/data/input",
    "outputDir": "/data/output",
    "configDir": "/data/config",
    "puppeteerExecutablePath": "/usr/bin/chromium",
    "pdfPrintUrl": "http://dashboard-web/print/report"
  },
  "network": {
    "integrationAllowSelfSignedCerts": true,
    "jiraAllowSelfSigned": true,
    "httpsProxy": "",
    "httpProxy": "",
    "nodeExtraCaCerts": ""
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "anthropicApiKey": ""
  },
  "jira": {
    "email": "",
    "apiToken": "",
    "onPremSecret": "",
    "sessionHeader": ""
  },
  "qmetry": {
    "basicAuth": ""
  }
}
```

Example `config/integrations.json` using generic values only:

```json
{
  "jira": {
    "enabled": true,
    "name": "QA Jira",
    "deploymentType": "on-prem",
    "baseUrl": "https://jira.example.com",
    "searchPath": "/rest/api/2/search",
    "projectKeys": ["QA"],
    "jql": "project = QA AND issuetype in (Story, Bug) ORDER BY updated DESC",
    "pageSize": 100,
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
    ],
    "statusDone": ["Done", "Closed", "Resolved"],
    "applicationCiFieldId": null
  },
  "qmetry": {
    "enabled": true,
    "baseUrl": "https://jira.example.com",
    "apiPrefix": "/rest/qtm4j/ui/latest",
    "projectKey": "QA",
    "projectId": "12345",
    "testCyclesSearchPath": "/testcycles/search",
    "testCasesSearchPath": "/testcycles/{cycleId}/testcases/search",
    "testCaseFields": "seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedBy,build,updated",
    "pageSize": 50,
    "maxPages": 200
  }
}
```

---

## Jira integration setup

Live Jira integration is optional. Excel-only usage works without Jira.

### 1. Open Settings

In the web app, go to:

```text
Settings → Jira Connections
```

### 2. Add Jira connection

Use generic values like:

| Field | Example |
|---|---|
| Name | `QA Jira` |
| Base URL | `https://jira.example.com` |
| Project keys | `QA` |
| Search path | `/rest/api/2/search` |
| Auth type | `basic` or `bearer` |
| Email/username | your Jira user |
| Token/password | your token/password, base64 Basic value, or full auth header |
| Cookie | optional browser session cookie for SSO/on-prem Jira |

### 3. Supported Jira auth formats

| Input style | Example value |
|---|---|
| Email + token/password | user field + token field |
| Raw base64 Basic value | token field contains base64 `user:password` |
| Full Basic header | token field contains `Basic <base64-user-colon-token>` |
| Full Bearer header | token field contains `Bearer <token>` |
| Session cookie | cookie field contains `JSESSIONID=<value>; atlassian.xsrf.token=<value>` |

### 4. Jira API request shape

The Jira client posts to:

```text
/rest/api/2/search
```

Example request body:

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
    "fixVersions"
  ]
}
```

### 5. Test connection

Click:

```text
Test Connection
```

Expected result:

```text
Jira connection successful
```

If your Jira is behind SSO, use a valid session cookie from an active browser session. Treat cookies as secrets.

---

## QMetry/QTM4J integration setup

Live QMetry/QTM4J integration is optional. It is used for test cycle and test execution metrics.

### 1. Open Settings

Go to:

```text
Settings → QMetry Connections
```

### 2. Add QMetry connection

Use generic values like:

| Field | Example |
|---|---|
| Name | `QA QMetry` |
| Base URL | `https://jira.example.com` |
| Project key | `QA` |
| Project ID | `12345` |
| Folder ID | optional, for a specific test-cycle folder |
| API prefix | `/rest/qtm4j/ui/latest` |
| Auth | same auth/cookie model as Jira if hosted under Jira |

### 3. QMetry cycle search endpoint

The app calls:

```text
POST /rest/qtm4j/ui/latest/testcycles/search?startAt=0&maxResults=50&fields=key,summary,priority,status,assignee,reporter,testcaseExecutionProgress,plannedStartDate,plannedEndDate,updated,automationRule
```

Example body:

```json
{
  "filter": {
    "projectId": 12345
  }
}
```

If a folder is selected:

```json
{
  "filter": {
    "projectId": 12345,
    "folderId": "67890"
  }
}
```

### 4. QMetry testcase search endpoint

The app calls:

```text
POST /rest/qtm4j/ui/latest/testcycles/{cycleId}/testcases/search?startAt=0&maxResults=50&fields=seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedBy,build,updated
```

Example body:

```json
{
  "filter": {
    "projectId": 12345
  }
}
```

### 5. Important QMetry field behavior

For the supported QTM4J UI endpoint, testcase rows use:

```text
updated
```

The app intentionally does **not** request these unsupported testcase fields:

```text
executedOn
lastModified
```

If testcase-level rows are unavailable but the cycle response contains `testcaseExecutionProgress`, the app uses cycle-level progress counts as fallback for cycle charts.

### 6. Cycle report behavior

When the user selects **Cycles** and clicks **Generate Report**, the report shows cycle health for the selected project/date range:

- cycles in scope
- total test cases in those cycles
- executed count
- pass/fail/blocked/not executed split
- pass rate
- coverage
- at-risk cycles
- narrative focused on cycle results

If a future UI adds a specific cycle selector, the request should also pass `cycleId`/`cycleKey` so the report filters to that one cycle only.

---

## AI provider setup for narrative summary

The project uses an AI provider only for the **Narrative Summary** section. All counts, charts, KPIs, cycle metrics, defect totals, and PDF sections are deterministic and generated from verified data.

The narrative prompt is designed to behave like a QA manager:

- use only verified metrics JSON
- do not invent numbers, tickets, owners, project names, dates, vendors, or conclusions
- do not repeat the full report structure
- do not mention AI/model/tool names in the report output
- write a short management-ready narrative and recommended follow-up

### Supported providers

| Provider | Notes |
|---|---|
| Anthropic | Claude models |
| OpenAI | OpenAI models |
| Gemini | Google Gemini models |
| OpenAI-compatible | Custom compatible endpoint |

### Configure from Settings

Go to:

```text
Settings → Report / AI Provider
```

Set:

| Field | Example |
|---|---|
| Provider | `anthropic` |
| Model | `claude-haiku-4-5-20251001` |
| API key | your provider API key |
| Base URL | only needed for compatible providers |

### Server fallback configuration

You can also set fallback values in `config/runtime.json` or `config/report.json`. Do not commit real API keys.

---

## Using the application

### Step 1. Start the app

```bash
./run.sh dev
```

Open:

```text
http://localhost:3000
```

### Step 2. Configure integrations or import files

Choose one mode:

| Mode | Setup |
|---|---|
| Excel only | Upload `.xlsx` files through Import Data or copy them into `input/` |
| API only | Configure Jira/QMetry from Settings or local config files |
| Mixed | Keep files in `input/` and enable integrations; the dataset is merged and deduped |

### Step 3. Test connections

In Settings, test Jira and QMetry connections before generating a report.

### Step 4. Generate dashboard data

Use the dashboard filters:

- project
- start date
- end date
- result filter
- search text

The dashboard updates from the filtered dataset.

### Step 5. Generate a report

Go to:

```text
QA Report
```

Select:

- report type
- project
- date range

Click:

```text
Generate Report
```

### Step 6. Download PDF

After the report is generated, click:

```text
Download PDF
```

---

## Report types and expected behavior

| Report type | Purpose | Expected content |
|---|---|---|
| Full | Complete QA reporting pack | Overview, execution, defects, cycles, UAT, risks, plan, narrative, summary |
| Executive | Senior-management summary | Key KPIs, defects, execution status, risks, narrative, summary |
| Defects | Defect-focused view | Story/bug split, open backlog, priority/owner risk, UAT where available, defect narrative |
| Cycles | QMetry cycle health view | Cycle execution progress, pass/fail/blocked/NE split, coverage, pass rate, at-risk cycles, cycle narrative |

### UAT message explanation

If you see:

```text
No UAT issues in the selected date range. Widen the date range or check that an ODL UAT export is staged under Import Data.
```

It means the selected range has no vendor/UAT rows from imported UAT data. It does **not** mean QMetry cycles are missing. UAT data is separate from QMetry execution data.

---

## PDF export

PDF export uses the React print route plus headless Chromium.

Local PDF requirements:

- Chrome/Chromium must be available.
- `puppeteerExecutablePath` can be set in `config/runtime.json` if auto-detection fails.
- `pdfPrintUrl` should point to the web print route.

Docker default:

```json
{
  "paths": {
    "puppeteerExecutablePath": "/usr/bin/chromium",
    "pdfPrintUrl": "http://dashboard-web/print/report"
  }
}
```

The PDF should not show internal wording such as “AI Narrative”. It should show business-facing wording such as:

```text
Narrative Summary
```

---

## Live integration probe

Use the live probe to verify Jira/QMetry connectivity and supported QMetry fields before debugging the app.

### 1. Configure using env vars

```bash
export QA_BASE_URL="https://jira.example.com"
export QA_AUTH_BASIC="Basic <base64-user-colon-token>"
export QA_PROJECT_KEY="QA"
export QA_PROJECT_ID="12345"
export QA_FOLDER_ID="67890"
node scripts/live-check-v2.mjs
```

### 2. Optional cookie-based SSO mode

```bash
export QA_BASE_URL="https://jira.example.com"
export QA_COOKIE="JSESSIONID=<value>; atlassian.xsrf.token=<value>"
export QA_PROJECT_ID="12345"
node scripts/live-check-v2.mjs
```

### 3. Optional proxy mode

```bash
export QA_PROXY_URL="http://proxy.example.com:8080"
node scripts/live-check-v2.mjs
```

### 4. What the probe checks

The script verifies:

- folder-tree API
- test-cycle search API
- testcase field-by-field validity
- combined supported testcase fields
- no-fields default response
- execution-date field discovery

Expected QMetry field conclusion:

```text
Use testcase field: updated
Do not request testcase fields: executedOn, lastModified
```

The script does not print request headers, but terminal logs can still expose URLs, project IDs, or response data. Review output before sharing it externally.

---

## Useful commands

Helper commands:

```bash
./run.sh setup
./run.sh dev
./run.sh build
./run.sh test
./run.sh docker
./run.sh docker down
./run.sh docker logs
```

Manual npm commands:

```bash
npm install
npm run dev
npm run build
npm test
```

Workspace build commands:

```bash
npm run build --workspace=apps/batch
npm run build --workspace=apps/web
npm run build --workspace=apps/api
```

Run all builds:

```bash
npm run build --workspace=apps/batch && npm run build --workspace=apps/web && npm run build --workspace=apps/api
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API health check |
| `GET` | `/api/status` | Runtime status and credential availability summary |
| `GET` | `/api/dashboard` | Filtered dashboard payload |
| `POST` | `/api/generate` | Parse/fetch data, aggregate metrics, write output artifacts, optionally generate narrative summary |
| `GET` | `/api/report` | Last generated markdown report |
| `POST` | `/api/report/pdf` | Generate PDF using the print route |
| `GET` | `/api/integrations` | Integration configuration summary |
| `POST` | `/api/integrations/test` | Test live Jira/QMetry connectivity |
| `POST` | `/api/integrations/test-connection` | Test a user-provided connection from Settings |
| `POST` | `/api/upload` | Upload an Excel file into `input/` |
| `GET` | `/api/input/files` | List staged input files |
| `DELETE` | `/api/input/:filename` | Delete a staged input file and refresh generated data |

---

## Troubleshooting

### Dashboard/report shows zero values

Check:

1. The selected date range overlaps real data.
2. The selected project key matches the data source project.
3. Jira/QMetry connections pass the Settings connection test.
4. `output/raw-dataset.json` is refreshed after changing connection settings.
5. You are not filtering by a result/status that excludes all rows.

### QMetry cycles found, but no testcase rows parsed

This usually means testcase detail rows were unavailable, filtered out, or the session lacks permission. The app can fall back to `testcaseExecutionProgress` from cycle search for chart generation when available.

Check the live probe:

```bash
node scripts/live-check-v2.mjs
```

Confirm supported testcase fields include:

```text
updated
```

and do not include:

```text
executedOn
lastModified
```

### “No UAT issues in selected date range”

This refers only to vendor/UAT import data. Import a UAT Excel export or widen the date range if UAT evidence is expected.

### PDF export fails

Check:

1. Web app is running.
2. API can reach the print URL.
3. Chromium path is correct.
4. Docker services are on the same network when running in Docker.

### Jira or QMetry returns HTML instead of JSON

This usually means SSO redirected the request to a login/logout page. Refresh your browser session and update the cookie in Settings.

### Corporate proxy or self-signed certificate errors

Set proxy and certificate options in `config/runtime.json`:

```json
{
  "network": {
    "integrationAllowSelfSignedCerts": true,
    "jiraAllowSelfSigned": true,
    "httpsProxy": "http://proxy.example.com:8080",
    "httpProxy": "http://proxy.example.com:8080",
    "nodeExtraCaCerts": "/data/config/certs/company-root-ca.pem"
  }
}
```

Use stricter TLS settings in production.

---

## Security checklist

Before committing or sharing logs:

- Do not commit real Excel exports.
- Do not commit `config/runtime.json` or `config/integrations.json` with credentials.
- Do not commit API keys, Jira tokens, Basic auth strings, Bearer tokens, or cookies.
- Do not commit real company Jira URLs unless the repository is private and approved for that usage.
- Use `https://jira.example.com` in examples and documentation.
- Redact `Authorization`, `Cookie`, `JSESSIONID`, XSRF tokens, API keys, project-specific confidential data, and user emails from shared logs.
- If a token, cookie, or API key is pasted into chat, logs, or source control, rotate it.

---

## Implementation checklist for new users

Use this checklist when setting up the project from scratch:

1. Clone repository.
2. Run `npm install`.
3. Start app using `./run.sh dev` or `npm run dev`.
4. Open `http://localhost:3000`.
5. Go to Settings.
6. Add Jira connection using `https://jira.example.com` style base URL.
7. Add QMetry connection with generic project key/project ID.
8. Add AI provider/model/API key for Narrative Summary.
9. Test Jira connection.
10. Test QMetry connection.
11. Upload Excel files if using file mode.
12. Select project and date range in dashboard.
13. Generate report from QA Report tab.
14. Review metrics and Narrative Summary.
15. Download PDF.
16. Run `npm run build --workspace=apps/batch && npm run build --workspace=apps/web && npm run build --workspace=apps/api` before pushing changes.
17. Run `npm test` before pushing changes.
18. Verify no secrets or company-specific URLs are included in committed files.
