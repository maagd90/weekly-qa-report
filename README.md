<div align="center">

# Weekly QA Report Dashboard

**A file-based QA intelligence dashboard for test execution, defect tracking, traceability, AI summaries, and PDF reporting.**

</div>

QA teams usually collect weekly quality data from many places: test execution exports, JIRA issues, QMetry cycles, vendor-portal bugs, and manual spreadsheets. This project consolidates those sources into one dashboard, computes metrics on the backend, generates a management-ready AI report, and exports a print-ready PDF.

The application is intentionally **stateless and file-based**. It does not require a database and it no longer requires a `.env` file. Runtime state is stored in local folders such as `input/`, `output/`, and `config/`.

---

## What this project does

- Imports Excel files for test execution, JIRA issue exports, and vendor/UAT bug logs.
- Fetches live JIRA issues using `/rest/api/2/search`.
- Fetches live QMetry/QTM4J cycle and test-case data.
- Aggregates result mix, pass rate, tester productivity, cycle health, story/bug split, defect backlog, traceability, and vendor/UAT bug status.
- Generates business-ready AI sprint reports using configurable LLM providers.
- Exports PDF reports through a print-optimized React route and headless Chromium.
- Runs locally or through Docker without a database.

---

## Current implementation

| App | Location | Responsibility |
|---|---|---|
| Batch/core | `apps/batch` | Parse files, call integrations, merge data, aggregate metrics, generate AI report text |
| API | `apps/api` | Express API for dashboard data, generation, uploads, integrations, status, and PDF export |
| Web | `apps/web` | React/Vite dashboard UI, import screen, settings, AI report screen, and print route |

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

---

## Project structure

```text
weekly-qa-report/
├── apps/
│   ├── batch/                      # Parser, integration clients, aggregation, AI report logic
│   ├── api/                        # Express API, upload routes, dashboard routes, PDF routes
│   └── web/                        # React/Vite dashboard UI
├── config/
│   ├── integrations.example.json   # Template for JIRA/QMetry settings
│   ├── integrations.json           # Local integration settings; gitignored
│   ├── runtime.example.json        # Template for server runtime settings
│   ├── runtime.json                # Local runtime settings; gitignored
│   └── report.json                 # Optional LLM provider/model settings
├── input/                          # Uploaded/staged Excel exports; gitignored
├── output/                         # Generated JSON/report artifacts; gitignored
├── docker-compose.yml              # API and web containers
├── run.sh                          # Mac/Linux helper script
└── run.bat                         # Windows helper script
```

---

## Quick start

### Local development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

### Docker

```bash
docker compose down
docker compose up --build
```

Open:

```text
http://localhost:3000
```

The Docker setup does **not** use `env_file` and does **not** require a `.env` file. It mounts these folders:

```text
./input  -> /data/input
./output -> /data/output
./config -> /data/config
```

---

## Configuration without `.env`

Configuration is split into two places:

| Configuration type | Where to set it | Notes |
|---|---|---|
| User connections and API keys | **Settings** screen | Stored in browser local storage and sent to the API only when needed |
| Server runtime defaults | `config/runtime.json` | Optional file for Docker/server paths, proxy, TLS flags, and fallback credentials |
| JIRA/QMetry profile defaults | `config/integrations.json` | Optional file for non-UI integration profiles |

Create local config files from templates only when you need server-side defaults:

```bash
cp config/runtime.example.json config/runtime.json
cp config/integrations.example.json config/integrations.json
```

`config/runtime.json` is gitignored. It replaces the old `.env` workflow.

Example `config/runtime.json`:

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

For normal usage, prefer the **Settings** screen instead of editing files.

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

Supported JIRA auth formats in Settings:

| Input style | Example value |
|---|---|
| Email + token/password | email/user + token field |
| Raw base64 Basic value | token field contains base64 user/password |
| Full Basic header | token field contains `Basic <base64-user-colon-token>` |
| Full Bearer header | token field contains `Bearer <token>` |
| Session cookie | cookie field contains `JSESSIONID=<value>; atlassian.xsrf.token=<value>` |

For on-prem JIRA behind SSO, use the cookie field in Settings or the optional `jira.sessionHeader` value in `config/runtime.json`. Treat cookies and tokens as secrets.

### Office network / Docker certificate handling

Docker runs with integration TLS compatibility enabled by default:

```text
INTEGRATION_ALLOW_SELF_SIGNED_CERTS=true
JIRA_ALLOW_SELF_SIGNED=true
```

Those defaults are set directly in `docker-compose.yml`, not through `.env`. If a stricter setup is required, set this in `config/runtime.json` and mount your company CA:

```json
{
  "network": {
    "integrationAllowSelfSignedCerts": false,
    "jiraAllowSelfSigned": false,
    "nodeExtraCaCerts": "/data/config/certs/company-root-ca.pem"
  }
}
```

---

## AI report configuration

The AI report is generated from the current dataset. The report prompt is designed to produce a structured QA sprint report with objective, validation focus, defect verification summary, test execution summary, test-cycle health, risks, upcoming plan, and final summary.

Supported providers:

| Provider | Notes |
|---|---|
| Anthropic | Claude models |
| OpenAI | OpenAI models |
| Gemini | Google Gemini models |
| OpenAI-compatible | Custom compatible endpoint |

Configure provider/model/API key from the **Settings** screen. Optional server fallback values can be placed in `config/runtime.json` or `config/report.json`.

---

## Data sources

| Mode | Setup |
|---|---|
| Excel only | Upload `.xlsx` files through the UI or copy them into `input/`; keep integrations disabled |
| API only | Configure JIRA/QMetry from Settings or `config/integrations.json` + `config/runtime.json` |
| Mixed | Keep files in `input/` and enable integrations; the dataset is merged |

Uploaded files should not contain secrets. Real exports should remain in gitignored local folders only.

---

## Useful commands

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
| `DELETE` | `/api/input/:filename` | Delete a staged input file and refresh generated data |

---

## Security

- Do not commit real Excel exports.
- Do not commit `config/runtime.json` or `config/integrations.json`.
- Prefer the Settings screen for user-specific credentials.
- If a token, cookie, or API key is pasted into chat, logs, or source control, rotate it.
