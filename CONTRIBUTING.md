# Contributing

Thanks for contributing to the Weekly QA Metrics Dashboard. This guide keeps changes consistent and safe.

## Getting set up

```bash
git clone <repo-url> && cd weekly-qa-report
./run.sh setup     # .env, config, folders, deps
./run.sh dev       # web :3000, API :3001
```

Requires Node.js ≥ 20 and npm ≥ 9.

## Workflow

1. **Branch from `main`:** `git checkout -b feature/<short-name>` (or `fix/<short-name>`).
2. **Keep it type-safe:** the project is strict TypeScript. Run a full build before pushing:
   ```bash
   npm run build        # batch → api → web must all compile
   ```
3. **Run the tests:**
   ```bash
   npm test             # parser regressions + filter acceptance
   ```
   Add or update tests when you change parsing, filtering, or aggregation logic.
4. **Open a pull request** against `main` with a clear summary and a short test plan.

## Ground rules

- **Never commit secrets or real data.** `.env`, `config/integrations.json`, and `fixtures/input/` are
  gitignored — keep them that way. Use `*.example` templates for anything shared.
- **Backend computes metrics.** All aggregation belongs in `apps/batch` (`buildDashboardPayload`); the React
  UI stays display-only. Don't add client-side metric math.
- **No invented numbers in AI reports.** The AI report must use the dataset-query tools, never hardcoded or
  estimated figures.
- **Use placeholders in docs/config** — no real hostnames, emails, or IDs in tracked files.
- **Keep diffs focused.** Prefer small, reviewable changes over broad rewrites.

## Project layout

| Path | What lives here |
|---|---|
| `apps/batch` | Parsing, merge, filters, aggregation, AI tools, CLI |
| `apps/api` | Express endpoints (dashboard, generate, upload, PDF) |
| `apps/web` | React + Vite dashboard (display-only) |
| `config/` | `integrations.json`, `report.json` |
| `docs/AGGREGATION.md` | Metric definitions |
| `TECH_STACK.md` | Stack overview + architecture |

## Commit messages

Conventional, imperative style, e.g.:

```
feat: add UAT closure-rate card to overview
fix: correct April window date filter
docs: document AI report model config
```

## Reporting issues

Include steps to reproduce, expected vs actual behavior, and the relevant `.env`/integration mode
(Excel-only, API, Docker vs local) — with secrets redacted.
