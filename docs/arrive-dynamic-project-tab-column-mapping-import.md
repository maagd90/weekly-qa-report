# Arrive: Dynamic Project Tab, Column Mapping, and Controlled Import

Source: Agreed implementation for projects that may not have Jira/QMetry connectivity, including user-configured project tabs, per-project spreadsheet mapping, reusable filters, and the explicit **Save Mapping → Import Data** workflow.

Status: **complete**

## Objective

Allow any project to upload and display its own spreadsheet data without requiring Jira/QMetry or project-specific application code.

When a project is created or edited, the user can enable a dedicated imported-data tab. The user can then upload a workbook, map its sheet columns to governed project fields, save the mapping, and explicitly import the data. The configured tab appears only when its owning project is selected.

## Implemented user journey

| Step | User action | System behaviour |
|---|---|---|
| 1 | Create a project | Ask whether a dedicated imported-data tab is required |
| 2 | Enable the tab | Save a project-owned tab configuration and user-defined tab label |
| 3 | Select the project | Display the configured tab only for that project |
| 4 | Open **Import Data** | Show only files belonging to the selected project |
| 5 | Upload a custom workbook | Stage the file without publishing its rows |
| 6 | Select **Map columns** | Inspect the sheet, header row, headers, sample values, and row count |
| 7 | Configure the mapping | Map source columns to governed project fields |
| 8 | Select **Save Mapping** | Save a versioned mapping profile without importing data |
| 9 | Review the saved mapping | Enable **Import Data** only when all required mappings are valid and saved |
| 10 | Select **Import Data** | Validate, convert, deduplicate, reconcile, and publish accepted rows |
| 11 | Open the project tab | Display mapped columns, filters, search, sorting, and pagination |
| 12 | Upload a matching workbook later | Reuse the saved mapping automatically through its header signature |

## Functional requirements delivered

### Project configuration and tab lifecycle

- [x] Advance: Ask during project creation whether the project requires a dedicated imported-data tab — verify: the project configuration form sends the tab configuration through the project API.
- [x] Advance: Allow the user to define the visible tab label without changing its immutable internal ID — verify: renaming changes navigation text while preserving the tab and its data.
- [x] Advance: Allow the tab to be enabled during creation or enabled later — verify: both project-create and project-update flows persist the same configuration contract.
- [x] Advance: Allow the tab to be disabled and re-enabled without deleting imported data or mappings — verify: disabled tabs reject reads and re-enabling restores the same tab ID and rows.
- [x] Advance: Render the tab only while its owning project is selected — verify: navigation eligibility is derived from the active project configuration.
- [x] Advance: Avoid generating new React components or routes for each project — verify: one generic table renderer supports all configured project tabs.

### Workbook staging and inspection

- [x] Advance: Keep an uploaded custom workbook in a staged state until the user explicitly imports it — verify: uploading or saving a mapping does not populate the project tab.
- [x] Advance: Inspect the selected sheet and identify its header row, headers, sample values, row count, and stable header signature — verify: mapped workbook parser tests assert the inspection output.
- [x] Advance: Reject duplicate or ambiguous source headers before mapping — verify: invalid workbooks return a controlled mapping error.
- [x] Advance: Keep recognised Jira/QMetry-style workbook imports backward compatible — verify: existing automatic parser paths and regression suites continue to pass.

### Per-project column mapping

- [x] Advance: Allow every selected source column to be mapped to a project-owned field — verify: the mapping request persists source header and target-field metadata.
- [x] Advance: Allow the user to create the visible column label and stable field key — verify: the generic tab renders labels while queries use stable keys.
- [x] Advance: Support `text`, `number`, `date`, and `boolean` field types — verify: parser tests cover successful and invalid conversions.
- [x] Advance: Allow each project field to be configured as visible, filterable, searchable, or required — verify: saved field settings drive rendering and filtering.
- [x] Advance: Require one unique record field for project-scoped deduplication — verify: repeat snapshots retain only the newest row for the same normalized identity.
- [x] Advance: Validate missing required values and invalid typed values — verify: rejected rows appear in reconciliation with source-row reasons.
- [x] Advance: Ensure different spreadsheet layouts targeting the same tab resolve to one compatible governed target schema — verify: incompatible target schema changes are rejected.

### Mapping profiles

- [x] Advance: Save mappings as versioned profiles owned by `projectId` and `tabId` — verify: the first saved mapping is version 1 and later changes produce a new version.
- [x] Advance: Match future files to an existing profile using a normalized header signature — verify: compatible later uploads are marked mapped automatically.
- [x] Advance: Preserve mapping history for traceability — verify: published rows retain the mapping-profile version used during import.
- [x] Advance: Prevent one project's mapping from being used by another project — verify: API routes resolve mappings through the selected project and tab.

### Explicit Save Mapping and Import Data actions

- [x] Advance: Make **Save Mapping** a configuration-only action — verify: saving a valid mapping leaves the project tab empty.
- [x] Advance: Keep **Import Data** as the only publication action for staged custom files — verify: the project sync endpoint performs conversion and publication.
- [x] Advance: Disable **Import Data** when mapping changes are unsaved — verify: the web interface checks whether the current mapping matches the saved profile.
- [x] Advance: Disable **Import Data** while any staged custom file still requires mapping — verify: pending mapping count guards the import actions.
- [x] Advance: Refresh project files, dashboard output, navigation metadata, and tab data after successful import — verify: related client queries are invalidated after sync.

### Data validation, deduplication, and reconciliation

- [x] Advance: Scope every published row to its owning project, tab, source file, source row, mapping version, and import timestamp — verify: service tests assert ownership metadata.
- [x] Advance: Deduplicate repeated unique identities within the same workbook — verify: the parser rejects later duplicate rows in one file.
- [x] Advance: Deduplicate overlapping snapshot uploads inside the same project and tab — verify: importing a later overlapping file does not double the visible records.
- [x] Advance: Apply newest-record-wins behaviour for matching unique identities — verify: the latest accepted source row becomes the visible record.
- [x] Advance: Keep accepted, rejected, duplicate, and skipped totals in the reconciliation response — verify: import results expose actionable row counts and reasons.
- [x] Advance: Prevent records from one project or tab appearing in another — verify: API ownership and service isolation tests pass.

### Generic project-data tab

- [x] Advance: Render only columns marked visible in the saved mapping — verify: hidden fields do not appear in the table.
- [x] Advance: Keep long values readable through responsive sizing and horizontal scrolling — verify: responsive layout tests cover the generic data page.
- [x] Advance: Support column sorting, date-range filtering, result counts, clear filters, and 25-row pagination — verify: filtering resets or bounds the active page.
- [x] Advance: Show distinct empty states for no mapping, no imported data, and no matching filtered records — verify: each state retains the selected project and tab context.

### Basic Search

- [x] Advance: Enable Basic Search by default — verify: the generic tab initially displays simple filter controls.
- [x] Advance: Generate dropdown filters only for fields marked filterable — verify: non-filterable fields do not create controls.
- [x] Advance: Populate each dropdown only with values present in the active project's current dataset — verify: absent values do not create empty filters.
- [x] Advance: Add **Search anything** across fields marked searchable — verify: hidden or non-searchable values do not create unexplained matches.
- [x] Advance: Combine keyword, dropdown, date-range, sorting, and pagination locally — verify: no Jira/QMetry request is made when filters change.

### Advanced Search

- [x] Advance: Show the JQL-style editor only after the user selects **Advanced Search** — verify: Basic Search remains the default mode.
- [x] Advance: Build allowed query fields from the active project's mapped schema — verify: unknown fields return a controlled validation error.
- [x] Advance: Support `=`, `!=`, `IN`, `NOT IN`, `~`, `!~`, `>`, `>=`, `<`, and `<=` with `AND`, `OR`, `NOT`, and parentheses — verify: query-engine tests cover supported expressions.
- [x] Advance: Validate number and ISO-date operands according to field type — verify: invalid typed comparisons do not replace the last valid results.
- [x] Advance: Limit query length, token count, and nesting depth — verify: boundary tests return safe validation messages.
- [x] Advance: Evaluate advanced queries only against the already loaded project-tab rows — verify: advanced search performs no Jira/QMetry calls.

## System implementation

### `apps/batch`

- [x] Advance: Implement the mapped workbook contract, inspection, signature, type conversion, required-field validation, and within-file deduplication in `apps/batch/src/parse/mappedImport.ts` — verify: `apps/batch/src/parse/__tests__/mappedImport.test.ts`.
- [x] Advance: Export mapped-import types and functions through `qa-dashboard-batch` — verify: batch and API TypeScript builds pass.

### `apps/api`

- [x] Advance: Implement project-tab configuration, mapping persistence, mapping versioning, mapped-row publication, cross-file deduplication, and reconciliation in `apps/api/src/services/projectImports.ts` — verify: `apps/api/src/services/__tests__/projectImports.test.ts`.
- [x] Advance: Add project-owned workbook inspection, mapping save, tab-data read, and explicit import routes in `apps/api/src/routes/batchRoutes.ts` — verify: API tests enforce project and tab ownership.

### `apps/web`

- [x] Advance: Add dedicated-tab configuration to `apps/web/src/pages/SettingsPage.tsx` — verify: project create and update requests compile and persist successfully.
- [x] Advance: Implement the staged workbook and column-mapping workflow in `apps/web/src/pages/ImportStatusPage.tsx` — verify: mapping save and Import Data are independent actions.
- [x] Advance: Implement the generic configured tab in `apps/web/src/pages/ProjectDataPage.tsx` — verify: mapped fields drive table columns and Basic Search.
- [x] Advance: Implement governed advanced querying in `apps/web/src/lib/genericTableQuery.ts` — verify: `apps/web/src/lib/__tests__/genericTableQuery.test.ts`.
- [x] Advance: Drive navigation and per-tab date filters from the selected project's configuration — verify: `App.tsx`, `QaTabNav.tsx`, and `usePerTabFilters.ts` regression checks pass.

## Acceptance criteria

- [x] A project can operate with imported spreadsheet data and no Jira/QMetry connection.
- [x] A user can enable a dedicated data tab during project creation or later.
- [x] A project tab appears only for its owning project.
- [x] A user can map or create project columns from the workbook's real sheet headers.
- [x] Saving a mapping does not import or publish data.
- [x] Importing is an explicit action after mapping review.
- [x] A saved mapping is reused for future workbooks with the same schema.
- [x] Invalid rows are rejected with actionable reconciliation details.
- [x] Overlapping uploads do not create duplicate visible records.
- [x] Basic and Advanced Search use the active project's mapped schema and imported data.
- [x] Existing Jira/QMetry, Vendor Portal, Wonder Miles, reporting, and portfolio behaviour remains compatible.

## Verification evidence

- [x] Full `npm test` passed.
- [x] Full production `npm run build` passed.
- [x] Mapped workbook inspection and conversion tests passed.
- [x] Project/tab ownership, mapping versioning, and deduplication tests passed.
- [x] Save Mapping without publication and explicit Import Data publication tests passed.
- [x] Basic/Advanced search and query validation tests passed.
- [x] Responsive layout and navigation regression tests passed.
- [x] Vendor Portal, Wonder Miles, portfolio reporting, and existing import regression tests passed.

## Repository delivery

- Branch: `agent/project-scoped-import-connections`
- Commit: `c782ae4721c7f0ee2394eff2ac3df0350ee841c1`
- Pull request: `https://github.com/maagd90/weekly-qa-report/pull/17`
