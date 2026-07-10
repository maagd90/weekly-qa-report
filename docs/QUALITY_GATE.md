# Automated Quality Gate

The workspace-isolation branch is not approved by a person manually checking a list. The repository quality gate performs the build, unit/regression, API integration, and browser E2E checks.

## Commands

```bash
npm run test:unit
npm run test:api
npm run test:e2e
npm run test:quality-gate
```

Or:

```bash
./run.sh quality
```

`test:quality-gate` is the merge gate. It runs the production build first and then all automated test layers.

## WonderMiles credential model

The automated suite intentionally does **not** require WonderMiles JIRA credentials.

- DLM fixture: execution export + JIRA export + UAT export.
- WonderMiles fixture: QMetry execution export only.
- WonderMiles live integration test: local mock of the on-premises QMetry contract.
- WonderMiles assertions require `0 JIRA / 1 QMetry` and verify that story/bug metrics remain zero rather than leaking from DLM.

Real office credentials are never stored in the repository or CI secrets for these tests.

## Test layers

### Batch/unit regression

Covers parsing, deduplication, date filters, result filters, DLM source aliases, workspace creation, DLM isolation, and QMetry-only WonderMiles isolation.

### API integration

Starts the compiled API against temporary data/config folders and verifies:

- Project-specific upload, list, sync, dashboard, and cache behavior.
- DLM files and metrics never appear in WonderMiles.
- WonderMiles files and metrics never appear in DLM.
- Search, result, and date filters remain isolated.
- All report types build against the selected workspace.
- Regeneration does not serve stale date-range data.
- Mixed-project legacy migration is rejected before files are moved.
- WonderMiles QMetry works without a JIRA connection.
- QMetry folder/cycle/test-case contract behavior.
- Large connection/session headers do not regress to HTTP 431.

### Browser E2E

Starts the compiled API and Vite UI, opens Chrome/Chromium through `puppeteer-core`, and verifies:

- Workspace options come from connection names.
- WonderMiles is shown as QMetry-only.
- Import lists are workspace-specific.
- Project selection survives browser refresh.
- Testers and cycles stay scoped to the selected workspace.
- Settings shows the correct JIRA/QMetry connection counts.
- A workspace-scoped WonderMiles PDF is rendered through the real print page and begins with a valid `%PDF` signature.

Set `CHROME_BIN` when Chrome or Chromium is not auto-detected.

## CI evidence

`.github/workflows/quality-gate.yml` runs on pull requests and uploads:

- API and web process logs.
- Machine-readable JSON results.
- Browser screenshots, including a failure screenshot when possible.
- The generated WonderMiles PDF when the PDF check succeeds.

The GitHub `Build, unit, API and E2E` check should be configured as a required branch-protection status before merging.

## External smoke testing

The CI suite uses mocks and synthetic data. An optional office-environment smoke check may use real DLM and WonderMiles QMetry connections, but it does not replace the deterministic CI gate.
