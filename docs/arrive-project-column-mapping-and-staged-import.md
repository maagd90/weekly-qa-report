# Arrive: Project Column Mapping and Staged Import

Source: `arrive-import-only-project-workspace.md`, the agreed project-owned tab model, the agreed reusable Basic/Advanced filtering model, and the final Import Data interaction: upload a spreadsheet, map its fields, save the mapping without publishing, then explicitly select **Import Data**.

Status: **complete**. The implementation supports import-only projects without Jira/QMetry, reusable per-project column mappings, configuration-driven project tabs, and an explicit staged-to-published workflow.

## Implemented user journey

| Step | User action | Implemented result |
|---|---|---|
| 1 | Create or edit a project | The user can enable **Dedicated imported-data tab** and provide its visible label |
| 2 | Select the project and open **Import Data** | Only files owned by that project are displayed |
| 3 | Upload a recognised Jira/QMetry-style workbook | The existing automatic parser remains available |
| 4 | Upload a custom workbook | The file remains staged and is marked **Column mapping required** |
| 5 | Select **Map columns** | The application inspects the real sheet, header row, headers, sample values, and row count |
| 6 | Configure project columns | The user controls label, stable field key, type, visibility, filtering, searching, required status, and the unique record column |
| 7 | Select **Save Mapping** | A versioned project/tab-owned mapping is saved; no data is published |
| 8 | Review the saved mapping | **Import Data** becomes available only when the mapping is saved and all staged custom files are mapped |
| 9 | Select **Import Data** | Rows are converted, validated, deduplicated, reconciled, and published to the owning project tab |
| 10 | Open the project-owned tab | The mapped columns, data-driven filters, Search anything, sorting, pagination, and Advanced Search appear without project-specific UI code |
| 11 | Upload another workbook with the same headers | The saved mapping is matched by header signature and reused automatically |
| 12 | Disable, rename, or re-enable the tab | Tab identity and previously imported data are preserved; a disabled tab cannot be queried |

## System: apps/batch

### Component: Mapped workbook contract and parser (`apps/batch/src/parse/mappedImport.ts`)

- [x] Advance: Add a reusable mapped-column contract supporting `text`, `number`, `date`, and `boolean` project fields plus visible, filterable, searchable, and required behavior — verify: `apps/batch/src/parse/__tests__/mappedImport.test.ts` compiles and converts representative values.
- [x] Advance: Inspect a workbook to identify the active sheet, best header row, unique headers, source row count, bounded sample rows, detected built-in type, and stable header signature — verify: the mapped-import test asserts the inspected headers and row count.
- [x] Advance: Reject duplicate spreadsheet headers before mapping so a source column cannot resolve ambiguously — verify: parser validation returns a controlled duplicate-header error.
- [x] Advance: Bind saved mappings to a normalized SHA-256 header signature rather than filename or project name — verify: a mismatched signature is rejected and matching layouts reuse the profile.
- [x] Advance: Convert mapped values according to their configured project type and reject non-empty values that cannot be converted — verify: the test rejects an invalid number instead of silently publishing a blank value.
- [x] Advance: Validate required fields and the configured unique record column for every row — verify: rows with a missing required/unique value appear in reconciliation rejections.
- [x] Advance: Deduplicate repeated unique values inside a workbook using case-insensitive normalized identity — verify: the mapped-import test rejects the second occurrence of `C-1`.
- [x] Advance: Return source row, source record identity, accepted values, and actionable row-level rejection reasons — verify: the parser test asserts accepted and rejected row counts and reasons.

### Component: Batch package exports and regression execution (`apps/batch/src/index.ts`, `apps/batch/package.json`)

- [x] Advance: Export mapped-import inspection, parsing, and types through `qa-dashboard-batch` for API reuse — verify: API and batch TypeScript builds resolve the shared contract.
- [x] Advance: Add the mapped-import regression test to the batch test command — verify: `npm test` executes `dist/parse/__tests__/mappedImport.test.js`.

## System: apps/api

### Component: Project-owned tab and mapping persistence (`apps/api/src/services/projectImports.ts`)

- [x] Advance: Persist a generic `ProjectTabConfig` under the owning project with immutable tab ID, editable label, enabled state, approved `generic-table` renderer, mapping history, and active mapping version — verify: `apps/api/src/services/__tests__/projectImports.test.ts` creates Project C with `Project C Export Data`.
- [x] Advance: Allow the dedicated tab to be enabled during project creation or enabled, renamed, disabled, and re-enabled later — verify: the project-import test confirms re-enabling preserves the original tab ID and published rows.
- [x] Advance: Keep custom spreadsheet files staged until their mapping is saved and the user explicitly starts Import Data — verify: the project-import test asserts zero project-tab rows immediately after `saveFileMapping`.
- [x] Advance: Validate mapping field keys, source headers, labels, types, duplicate source/target mappings, visible fields, and the unique key before saving a profile — verify: service validation fails safely for invalid mappings.
- [x] Advance: Version each mapping inside the owning project tab and activate the newest compatible version — verify: the first Project C profile is stored as version 1 and stamped on the staged file.
- [x] Advance: Require different source layouts targeting one tab to resolve to the same governed project-column schema — verify: incompatible target schema changes are rejected rather than reinterpreting older rows.
- [x] Advance: Match new staged files to an existing mapping through the header signature — verify: the second Project C snapshot is automatically marked mapped with profile version 1.
- [x] Advance: Publish accepted rows only during project sync and scope every row to `projectId`, `tabId`, source file, source row, profile version, and import timestamp — verify: all 779 fixture rows carry the Project C and tab ownership.
- [x] Advance: Deduplicate across overlapping snapshots inside the owning project/tab using the configured unique field, with the newer file winning — verify: importing the same 779-record layout twice leaves 779 rows and reports skipped duplicates.
- [x] Advance: Preserve mapped rows while a tab is disabled and reject direct reads of the disabled tab — verify: the project-import test confirms the read is blocked while disabled and rows return after re-enabling.
- [x] Advance: Extend reconciliation totals with custom mapped rows without changing the existing execution, issue, and Vendor Portal totals — verify: the Project C sync reports `rowCounts.generic` and `newTotals.customRows`.

### Component: Project import HTTP routes (`apps/api/src/routes/batchRoutes.ts`)

- [x] Advance: Accept dedicated-tab configuration during project create and update requests — verify: the web API contract and API build pass.
- [x] Advance: Return mapping-aware upload messages for required, mapped, and built-in layouts — verify: staged custom files instruct the user to map columns before publication.
- [x] Advance: Add a project/file-owned inspection endpoint — verify: `GET /projects/:projectId/files/:fileId/inspect` resolves only through the selected project store.
- [x] Advance: Add a mapping-save endpoint that saves configuration without publishing rows — verify: `PUT /projects/:projectId/files/:fileId/mapping` returns the saved profile and instructs the user to review it before importing.
- [x] Advance: Add a project/tab-owned data endpoint — verify: `GET /projects/:projectId/tabs/:tabId/data` enforces both project and tab identity.
- [x] Advance: Keep the existing project sync endpoint as the single explicit publication boundary — verify: only `POST /projects/:projectId/imports/sync` rebuilds the mapped tab dataset and dashboard cache.

## System: apps/web

### Component: Project configuration (`apps/web/src/pages/SettingsPage.tsx`)

- [x] Advance: Ask whether the project needs a dedicated imported-data tab during project creation and allow the tab label to be configured — verify: Settings sends the dedicated-tab contract to the project API.
- [x] Advance: Allow the tab to be enabled, disabled, renamed, or re-enabled later without generating React source code — verify: saved project metadata drives navigation after the project query refreshes.

### Component: Import Data mapping workflow (`apps/web/src/pages/ImportStatusPage.tsx`)

- [x] Advance: Keep custom files staged after upload and show whether they require mapping or already match a saved profile — verify: the upload status and project-file list render the mapping state.
- [x] Advance: Replace the static column-mapping description with a real sheet-backed mapping table — verify: the UI renders every inspected source header and sample values.
- [x] Advance: Allow each selected source column to define its project label, stable key, type, visible/filterable/searchable/required settings, and unique record role — verify: all configuration fields are bound to the mapping request.
- [x] Advance: Separate **Save Mapping** from **Import Data** so saving never silently publishes data — verify: the interface has independent actions and the service regression asserts no rows exist after mapping alone.
- [x] Advance: Disable **Import Data** when the current mapping has unsaved changes or any staged custom file still requires mapping — verify: `currentMappingIsSaved` and `pendingMappingCount` guard both Import Data actions.
- [x] Advance: After explicit import, refresh project files, project metadata, dashboard output, and the project-owned tab dataset — verify: successful sync invalidates the related queries and calls the existing imported-data refresh callback.
- [x] Advance: Preserve automatic import for recognised built-in layouts while pausing only custom layouts for mapping — verify: upload messaging and regression contracts distinguish both paths.
- [x] Advance: Explain that the unique field prevents yesterday's overlapping rows from appearing again in today's import — verify: the mapping panel documents the newest-record-wins behavior.

### Component: Generic project tab (`apps/web/src/pages/ProjectDataPage.tsx`)

- [x] Advance: Render an enabled project tab from its saved mapping and rows without project-key checks or a new component per project — verify: `App.tsx` and `QaTabNav.tsx` resolve the active project's generic tab configuration.
- [x] Advance: Show only mapped columns marked visible and keep long values inside a horizontally scrollable responsive table — verify: the responsive contract covers the generic project-data page.
- [x] Advance: Build Basic Search dropdowns only for configured filterable fields and only from values present in the active project/date dataset — verify: the generic tab derives distinct value/count pairs from its owned rows.
- [x] Advance: Add case-insensitive **Search anything** across configured searchable columns — verify: non-searchable or hidden data cannot create unexplained matches.
- [x] Advance: Add local sorting, date filtering, filtered result counts, clear filters, and 25-row pagination — verify: the page resets or bounds pagination when filters or result counts change.
- [x] Advance: Show actionable empty states when a tab has no mapping, no published rows, or no matching filtered rows — verify: each state retains the active project/tab context and directs the user back to Import Data when needed.

### Component: Advanced local query engine (`apps/web/src/lib/genericTableQuery.ts`)

- [x] Advance: Generate allowed query fields from the project's configured searchable/filterable columns — verify: `apps/web/src/lib/__tests__/genericTableQuery.test.ts` rejects unknown fields.
- [x] Advance: Support `=`, `!=`, `IN`, `NOT IN`, `~`, `!~`, `>`, `>=`, `<`, and `<=` according to column type, plus `AND`, `OR`, `NOT`, and parentheses — verify: query tests cover logical combinations and type-aware comparisons.
- [x] Advance: Validate number and ISO date operands before applying a query — verify: malformed typed comparisons return a controlled error.
- [x] Advance: Limit query length, token count, and nesting depth so an invalid expression cannot freeze the page — verify: boundary tests return validation errors without replacing the last applied results.
- [x] Advance: Keep query evaluation local to the already loaded project/tab dataset — verify: the query engine accepts only project-tab rows and performs no Jira/QMetry or API execution.

### Component: Navigation, filters, and API typing (`apps/web/src/App.tsx`, `apps/web/src/components/layout/QaTabNav.tsx`, `apps/web/src/hooks/usePerTabFilters.ts`, `apps/web/src/lib/api.ts`)

- [x] Advance: Show the configured project-owned tab only while its owning project is selected — verify: navigation eligibility comes from the selected project's enabled tabs.
- [x] Advance: Preserve the standard tabs and existing Vendor Portal/Wonder Miles capability behavior — verify: the existing report, Vendor Portal, portfolio PDF, and responsive tests continue to pass.
- [x] Advance: Give the generic tab an independent per-tab date range — verify: `usePerTabFilters` includes the dynamic project-data tab key.
- [x] Advance: Model project tabs, mappings, inspections, rows, and sync reconciliation in the web API client — verify: the web TypeScript build passes without untyped route responses.

## End-to-end verification

- [x] Advance: Verify an import-only Project C can be created with a dedicated tab and no Jira/QMetry connection — verify: project-import service tests create and operate Project C using only staged workbooks.
- [x] Advance: Verify mapping is a non-publishing step and **Import Data** is the explicit publication step — verify: the API service test sees zero rows after save and 779 after sync.
- [x] Advance: Verify repeat snapshots do not create duplicate visible records — verify: the second 779-record import still produces 779 project-tab rows and duplicate/skipped reconciliation entries.
- [x] Advance: Verify project/tab isolation — verify: every row has the expected `projectId` and `tabId`, disabled tabs reject reads, and re-enabling restores the same data.
- [x] Advance: Verify parser correctness for valid text/number/date/boolean values, invalid typed values, required fields, duplicate identities, and incompatible headers — verify: `mappedImport.test.ts` passes.
- [x] Advance: Verify Basic Search and Advanced Search operate from the mapped field configuration — verify: `genericTableQuery.test.ts`, web unit tests, and the production web build pass.
- [x] Advance: Verify backward compatibility — verify: batch, API, Vendor Portal, Wonder Miles, portfolio-report, responsive-layout, development-cache, and npm-spawn regression checks pass.
- [x] Advance: Run the release checks — verify: full `npm test` and full production `npm run build` pass; the localhost-only LLM endpoint test also passes when the workspace proxy is excluded from its temporary `127.0.0.1` mock server.
