# Weekly QA Metrics Dashboard — DLM

File-based QA dashboard for the **DLM** project. Parses Zephyr exports, JIRA issues, and ODL UAT spreadsheets (or fetches live from JIRA/QMetry APIs), aggregates metrics, and serves a React UI with date-range filtering — **no database required**.

---

## Overview

| Source | Data |
|---|---|
| **Zephyr / QMetry** | Test cycle executions (PASS/FAIL/BLOCKED/NE/NA) |
| **JIRA** | Stories and Bugs |
| **ODL** | UAT issues (optional) |

Stage Excel files in `input/`, or enable `config/integrations.json` to pull from Emirates JIRA/QMetry. Click **Generate Report** to parse, cache `raw-dataset.json`, write `dashboard-data.json`, and optionally run a Claude AI report.

**Updated-date filtering:** rows updated within the selected date range appear even if created earlier.

---

## Architecture

**All dashboard metrics are computed on the backend.** The React UI is display-only — it calls `GET /api/dashboard` with filter query params and renders the JSON. See [docs/AGGREGATION.md](docs/AGGREGATION.md) for parity with the prototype `renderVals` logic.

```
input/ + integrations → parse → raw-dataset.json → applyFilters → buildDashboardPayload → JSON
                                                                                              ↓
                                                                                    React (render only)
```

## Quick start

```bash
chmod +x run.sh
./run.sh setup
cp fixtures/input/*.xlsx input/   # optional sample data
./run.sh dev                      # local: UI http://localhost:5173
```

### Docker

```bash
./run.sh setup
cp fixtures/input/*.xlsx input/
./run.sh docker                   # UI http://localhost:3000, API http://localhost:3001
./run.sh docker down              # stop
./run.sh docker logs              # follow logs
```

Or use Docker Compose directly:

```bash
docker compose up --build -d
```

### Manual (without run.sh)

```bash
npm install
cp .env.example .env
cp config/integrations.example.json config/integrations.json
cp fixtures/input/*.xlsx input/
npm run dev
```

Generate from CLI:

```bash
./run.sh generate 2026-06-24 2026-06-30 full
# or
npm run generate -- --start-date 2026-06-24 --end-date 2026-06-30 --report-type full
```

Run regression tests:

```bash
npm test
```

---

## Dashboard tabs

| Tab | Content |
|---|---|
| **Overview** | Result mix, pass rate, story/bug split, defect backlog |
| **Testers** | Per-tester execution stats |
| **Test Cycles** | Cycle health, coverage, pass % |
| **Traceability** | Feature area matrix (stories, bugs, completion) |
| **UAT** | ODL UAT issues (shown when ODL data loaded) |
| **Import Data** | Upload Excel to `input/` |
| **AI Report** | Generate Claude narrative with 6 dataset tools |
| **Settings** | Integration status, env hints |

---

## Integrations

Copy `config/integrations.example.json` → `config/integrations.json` and set:

```json
{
  "jira": { "enabled": true, "projectKeys": ["DLM"] },
  "qmetry": { "enabled": true, "cycleIds": ["Qr0MHaDZtj"] }
}
```

Credentials in `.env`:

```
JIRA_EMAIL=you@emirates.com
JIRA_API_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...   # optional — dashboard works without it
```

- **JIRA:** `POST /rest/api/2/search` on `jiraagile.emirates.com`
- **QMetry:** `GET /rest/qtm4j/ui/latest/testcycles/{cycleId}/testcases/search`

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard?startDate&endDate&search&result&project` | Re-filter cached dataset |
| `POST` | `/api/generate` | Parse/fetch, write JSON + AI report |
| `GET` | `/api/integrations` | Integration config summary |
| `POST` | `/api/integrations/test` | Test API fetch |
| `POST` | `/api/upload` | Stage file to `input/` |
| `GET` | `/api/input/files` | List staged files |

---

## Regression totals (fixture files)

| Source | Rows | Key metrics |
|---|---|---|
| Zephyr | 2210 | PASS 1319, NE 715, BLOCKED 109, FAIL 46, NA 21 |
| JIRA | 779 | Story 582, Bug 197; 63 open bugs |
| ODL | 74 | 43 closed, 31 open |

---

## Project structure

```
apps/batch/     Parse, merge, aggregate, AI tools
apps/api/       Express file server
apps/web/       React dashboard UI
config/         integrations.json
input/          Staged Excel exports
output/         dashboard-data.json, raw-dataset.json, report.md
fixtures/input/ Sample regression files
```

---

## AI report tools

Claude calls six tools against the filtered in-memory dataset:

1. `get_result_mix` — execution result distribution
2. `get_tester_stats` — per-tester stats
3. `get_cycle_health` — cycle pass rates
4. `get_story_bug_split` — story vs bug counts
5. `get_defect_backlog` — open bugs by priority/owner
6. `get_traceability` — feature area matrix

No invented metrics — if a tool returns empty data, the report says so.
