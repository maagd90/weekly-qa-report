# QA Metrics Dashboard

A weekly QA reporting dashboard powered by Excel. Your manager updates one Excel file — the dashboard auto-refreshes with charts showing resource assignments, test execution, bug tracking, and project status.

## Quick Start (Local)

### 1. Set up the Excel file

Copy the template and fill in your team's data:

```
cp templates/team-metrics-template.xlsx data/team-metrics.xlsx
```

Open `data/team-metrics.xlsx` and fill in:
- **Resources** — your team members
- **Projects** — active projects
- **CRs** — change requests linked to projects
- **Weekly_Log** — one row per resource/CR/week
- **Project_Status_Weekly** — one row per project/week

### 2. Configure the .env file

```
cp .env.example .env
```

Edit `.env` and set `EXCEL_SOURCE_PATH` to the full path of your Excel file.

### 3. Start the dashboard

```bash
# Install dependencies (one time)
npm install

# Start both API and web (opens on http://localhost:3000)
npm run dev
```

The dashboard will:
- Import the Excel file on startup
- Watch for file changes and auto-refresh
- Show all data at `http://localhost:3000`

## Excel Sheets

| Sheet | Purpose |
|-------|---------|
| `Resources` | Master list of team members |
| `Projects` | Active projects with dates and status |
| `CRs` | Change requests linked to projects |
| `Weekly_Log` | One row per resource/CR per week (test cases, bugs) |
| `Project_Status_Weekly` | Weekly project status report (%, risks, blockers) |
| `Weekly_Summary` | Optional pre-aggregated totals |

### Key columns in `Weekly_Log`

| Column | Description |
|--------|-------------|
| Year / WeekNumber | Identifies the week |
| ResourceID | Must match a row in Resources sheet |
| CR_ID | Must match a row in CRs sheet |
| TestCasesExecuted / Passed / Failed | Test execution KPIs |
| BugsReported / BugsClosed | Bug tracking |

### Key columns in `Project_Status_Weekly`

| Column | Description |
|--------|-------------|
| Year / WeekNumber | Identifies the week |
| ProjectID | Must match a row in Projects sheet |
| Status | On Track / At Risk / Delayed / Completed |
| PercentComplete | 0–100 |
| KeyAccomplishments / Risks / Blockers / NextWeekPlan | Free text |

## Dashboard Tabs

| Tab | What you see |
|-----|-------------|
| **Resources** | KPI cards, resource×CR assignment table, test execution and bug charts by resource, weekly trends |
| **Project Status** | Project health table with risks/blockers, status donut chart, completion bar, bug totals, completion trends |
| **Import** | Last import timestamp, row counts, validation errors |

## Manager Weekly Workflow

1. Open `team-metrics.xlsx`
2. Add rows to **Weekly_Log** for each resource/CR combination this week
3. Add/update rows in **Project_Status_Weekly** for each project (status, %, risks, blockers, accomplishments)
4. Save the file
5. The dashboard auto-refreshes within a few seconds — or click **Refresh** in the top bar

## Deployment on Internal Server (Docker)

```bash
# Build and start with Docker Compose
docker compose up --build -d
```

The app runs at `http://<server-ip>:3000`.

To use a shared network drive, update `docker-compose.yml`:

```yaml
volumes:
  - /path/to/shared/drive:/data   # Mount network path here
```

The Excel file at `/path/to/shared/drive/team-metrics.xlsx` will be watched for changes.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `EXCEL_SOURCE_PATH` | (required) | Full path to the Excel file |
| `PORT` | 3001 | API server port |
| `DB_PATH` | `apps/api/data/qa_dashboard.db` | SQLite database path |

## Project Structure

```
dashboard/
├── apps/
│   ├── api/        Express API + Excel importer + SQLite
│   └── web/        React dashboard (Vite + Tailwind + Recharts)
├── data/           Excel file and SQLite database (gitignored)
├── templates/      Blank Excel template
├── .env.example    Configuration template
└── docker-compose.yml
```
