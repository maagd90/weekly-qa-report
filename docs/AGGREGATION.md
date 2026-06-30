# Dashboard aggregation — prototype parity

All metrics are computed in `apps/batch/src/export/buildDashboardPayload.ts` (equivalent to prototype `renderVals` in `qa-data.js`). The React UI only renders the JSON from `GET /api/dashboard`.

## Status thresholds (match prototype)

| Entity | Rule |
|---|---|
| **Cycle** | `Not Started` if exec=0; `Healthy` if passPct ≥ 85; `Watch` if ≥ 60; else `At Risk` |
| **Traceability area** | `At Risk` if openBugs > 0; `In Progress` if open stories > 0; else `Verified` |

## Filter semantics

| Dataset | Date filter |
|---|---|
| **Executions** | `executedAt` or `updatedAt` in range; NE rows drop when range is set |
| **Issues** | `updatedAt` in range OR `resolvedAt` in range OR (open AND `createdAt` ≤ end) |
| **UAT** | `submittedAt` or `updatedAt` in range |
| **All dates** | When start/end span full data bounds, no date filtering |

Issue filter uses `updatedAt` (per product requirement) in addition to BACKEND_PROMPT `resolvedAt` / open+`createdAt` rules.

## Payload fields for thin UI

- `scope.projects` — project dropdown options
- `overview.chartSeries.resultMix` — donut chart data with colors
- `overview.byMonth` — monthly pass/blocked/fail buckets (last 6 months with volume)
- `cyclesByPassPctAsc` — cycles sorted at-risk first (UI must not re-sort)
- `defectBacklog.topPriorities` — top 6 priority rows (UI must not slice)

## Sort order (backend-owned)

- `testers` — by `executed` desc
- `cycles` — by `total` desc
- `cyclesByPassPctAsc` — by `passPct` asc
- `traceability` — by `stories` desc
