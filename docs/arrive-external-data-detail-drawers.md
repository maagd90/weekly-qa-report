# Arrive: Detail Drawers for External Data Tabs

Status: **complete**

## Project brief

Add accessible right-side detail drawers to the two external-data tabs:

- Vendor Portal Bugs
- Wonder Miles Export Data

Users can open a drawer by clicking a row or focusing it and pressing Enter/Space. Vendor Portal Bugs remain sorted by the most recent update and display the latest vendor note. All other dashboard tabs remain unchanged.

## Solution intent

- Preserve who last updated imported external rows through optional `updatedBy` metadata.
- Retain the Wonder Miles export fields needed for traceability: created date, environment, change request, update metadata, and source file.
- Reuse one accessible drawer shell for both tab-specific detail views.
- Make external-data rows mouse and keyboard operable.
- Close drawers with Escape or the backdrop, trap focus while open, lock background scrolling, and restore focus to the originating row.
- Keep Vendor Portal rows sorted by `updatedAt` descending, with `submittedAt` as the fallback.

## Implemented advances

### System: `apps/batch`

- [x] Advance: Extend `UatRow` and `IssueRow` with optional `updatedBy` metadata — verify: `apps/batch/src/types/dataset.ts`.
- [x] Advance: Extend dashboard-facing external-row types so the web receives update and traceability metadata — verify: `DashboardUatRow` and `DashboardWorkItem` include the required optional fields.
- [x] Advance: Extract the Vendor Portal updater from `Updated By`, `Last Updated By`, or `Submittedby` — verify: `parseOdlFromRows` populates `updatedBy`.
- [x] Advance: Extract the Wonder Miles updater from `Updated By`/`Last Updated By`, falling back to the assignee — verify: `parseJiraFromRows` populates `updatedBy`.
- [x] Advance: Retain optional Wonder Miles environment and change-request values from common export headers — verify: parser regression covers `Environment` and `Change Request`.
- [x] Advance: Carry created/update/source metadata into dashboard work items and Vendor Portal rows — verify: `buildDashboardPayload` maps the fields.
- [x] Advance: Preserve the latest Vendor Portal note/comment from common headers and select the row with the newest `LastUpdate` for duplicate Ticket IDs — verify: parser/deduplication regression.

### System: `apps/web`

- [x] Advance: Create `DetailDrawerBase` as the single drawer-behaviour implementation — verify: renders only while open; Escape closes; Tab/Shift+Tab remain inside; focus returns to the trigger; body overflow is restored.
- [x] Advance: Create `UatBugDetailDrawer` — verify: shows Ticket ID, subject, status, client/source priority, area, change request, submitted metadata, prominent Last Updated At/By, latest note, and source file.
- [x] Advance: Create `WonderMilesDetailDrawer` — verify: shows key, summary, type, status, priority, area, environment, change request, sprint, assignee, update owner, created/updated dates, and source file.
- [x] Advance: Make Vendor Portal rows clickable and keyboard operable — verify: click or Enter/Space opens the selected bug.
- [x] Advance: Make Wonder Miles Story and Bug rows clickable and keyboard operable — verify: click or Enter/Space opens the selected work item.
- [x] Advance: Keep Vendor Portal default ordering newest-update-first — verify: `updatedAt`, then `submittedAt`, then ticket ID determines the stable order.
- [x] Advance: Add visible `Updated` and `Note` columns to Vendor Portal Bugs — verify: the table, global text search, and Advanced Search include both fields.
- [x] Advance: Add Advanced Search fields for `updated` and `note` — verify: expressions such as `updated >= "2026-07-01"` and `note ~ "retest"` are supported.

## User journeys

### Vendor Portal Bugs

1. Select a project with the Vendor Portal capability.
2. Open **Vendor Portal Bugs**.
3. Review bugs ordered by their latest update.
4. Review the latest Note directly in the table.
5. Click a row or press Enter/Space on a focused row.
6. Review the full details, with **Last Updated At** and **Last Updated By** highlighted.
7. Press Escape or select **Back to list**.
8. Focus returns to the row that opened the drawer.

### Wonder Miles Export Data

1. Select a project with the Wonder Miles Export capability.
2. Open **Wonder Miles Export Data**.
3. Click a Story or Bug row, or focus it and press Enter/Space.
4. Review the full imported work-item metadata and source file.
5. Press Escape or select **Back to list**.
6. Focus returns to the originating row.

## Accessibility and responsive contract

- The drawer uses `role="dialog"`, `aria-modal="true"`, and a programmatically associated title.
- The close action receives a tab-specific accessible label.
- Escape closes the active drawer.
- Tab and Shift+Tab cycle within the drawer.
- Background scrolling is locked only while the drawer is open.
- Focus is restored when the drawer closes.
- Rows expose an accessible detail-action label and visible focus indicator.
- The drawer is full-width on mobile and constrained to `max-w-md` on larger screens.
- The backdrop is hidden on mobile and available on larger screens.

## Acceptance criteria

- [x] Vendor Portal and Wonder Miles rows open their corresponding drawers.
- [x] Mouse and keyboard interactions are supported.
- [x] Vendor Portal displays newest-updated bugs first.
- [x] Vendor Portal shows the latest note in the table and drawer.
- [x] Vendor Portal highlights the last update time and person.
- [x] Wonder Miles shows full available imported details with source-file traceability.
- [x] Escape closes each drawer.
- [x] Focus is trapped while open and restored after close.
- [x] Mobile and desktop drawer layouts meet the responsive contract.
- [x] Existing external-row payloads remain compatible because new fields are optional.
- [x] No code in Overview, Quality Assurance, Test Cycles, Traceability, Import Data, QA Report, or Settings is changed.

## Verification checklist

- [x] `npm run build --workspace=apps/batch`
- [x] Batch parser and payload regression tests
- [x] Web drawer and Vendor Portal unit tests
- [x] Web responsive contract tests
- [x] `npm run build --workspace=apps/web`
- [x] Full repository `npm test`
- [x] Full production `npm run build`
- [x] `git diff --check`

## Files

### Batch

- `apps/batch/src/types/dataset.ts`
- `apps/batch/src/parse/parseOdl.ts`
- `apps/batch/src/parse/parseJira.ts`
- `apps/batch/src/export/buildDashboardPayload.ts`
- `apps/batch/src/parse/__tests__/regression.test.ts`

### Web

- `apps/web/src/components/qa/DetailDrawerBase.tsx`
- `apps/web/src/components/qa/UatBugDetailDrawer.tsx`
- `apps/web/src/components/qa/WonderMilesDetailDrawer.tsx`
- `apps/web/src/pages/UatPage.tsx`
- `apps/web/src/pages/WonderMilesExportPage.tsx`
- `apps/web/src/lib/vendorPortalBugFilters.ts`
- `apps/web/src/lib/vendorPortalQuery.ts`
- `apps/web/src/components/qa/__tests__/externalDetailDrawers.test.tsx`
- `apps/web/src/components/qa/__tests__/vendorPortalPage.test.tsx`
- `apps/web/scripts/__tests__/responsive-layout.test.cjs`

## Out of scope

The following tabs and their behaviour remain unchanged:

- Overview/KPIs
- Quality Assurance
- Test Cycles
- Traceability
- Import Data
- QA Report
- Settings

## Delivery

- Repository: `maagd90/weekly-qa-report`
- Branch: `agent/project-scoped-import-connections`
- Pull request: `https://github.com/maagd90/weekly-qa-report/pull/17`
