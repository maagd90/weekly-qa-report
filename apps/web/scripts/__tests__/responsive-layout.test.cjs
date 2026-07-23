const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB_ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');
}

function hasAll(relativePath, tokens) {
  const contents = source(relativePath);
  for (const token of tokens) {
    assert.ok(contents.includes(token), `${relativePath} must include responsive contract token: ${token}`);
  }
}

function hasNone(relativePath, tokens) {
  const contents = source(relativePath);
  for (const token of tokens) {
    assert.equal(contents.includes(token), false, `${relativePath} must not include removed UI token: ${token}`);
  }
}

function hasNoUnscopedClass(relativePath, className) {
  const contents = source(relativePath);
  const pattern = new RegExp(`(?<![\\w:-])${className}(?![\\w-])`, 'g');
  assert.equal(pattern.test(contents), false, `${relativePath} must not use unscoped ${className} at the mobile breakpoint`);
}

hasAll('src/components/layout/QaTabNav.tsx', [
  'overflow-x-auto',
  'overscroll-x-contain',
  'min-w-max',
  'shrink-0',
  'scrollIntoView',
  "aria-current={active ? 'page' : undefined}",
]);

hasAll('src/components/layout/QaFilterBar.tsx', [
  'flex-col',
  'lg:flex-row',
  'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
  'w-full min-w-0 max-w-full',
  'sm:w-auto',
  'onSubmit=',
  'Apply dates',
  'showSearch',
  'datesChanged',
  'type="search"',
]);
hasNone('src/components/layout/QaFilterBar.tsx', ['FOCUS_CHIPS', 'onResultChange', '>Result<', 'onSearchApis']);

hasAll('src/components/layout/QaMasthead.tsx', [
  'flex flex-col items-stretch',
  'sm:flex-row',
  'w-full min-w-0 max-w-full',
  'sm:w-auto',
]);

hasAll('src/components/layout/QaPageShell.tsx', [
  'px-4',
  'sm:px-6',
  'lg:px-8',
  'flex-col',
  'sm:flex-row',
]);

hasAll('src/components/qa/QaBadge.tsx', [
  'max-w-full overflow-x-auto',
  'min-w-max',
]);

hasAll('src/pages/SettingsPage.tsx', [
  'grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2',
  'flex flex-wrap items-center gap-2',
  "initialLlm.provider || 'template'",
  'function saveNarrativeProvider()',
  'function saveBranding()',
  'function saveConnections()',
  'onClick={saveNarrativeProvider}',
  'onClick={saveBranding}',
  'if (saveConnections()) testMutation.mutate();',
  'if (saveConnections()) syncLiveMutation.mutate();',
  'Project management',
  'Update project',
  'Delete project',
  'Save connections',
  'Save & test',
  'Save & sync data',
  'allProjectsSelected &&',
  'Additional source keys',
  'Choose the applicable QMetry key',
  'All project connection summary',
  'all configured projects',
  'Under All Projects, expand any project to edit its connection.',
  'This never processes uploaded Excel files.',
  'if (projectsData.length === 0)',
  'Migrate saved connections',
  'never creates projects from API response rows',
]);
hasNone('src/pages/SettingsPage.tsx', ['saveAll', '+ Add JIRA connection', '+ Add QMetry connection']);

// The JIRA/QMetry connection card UI was extracted out of SettingsPage.tsx
// for readability; its responsive contract still applies there.
hasAll('src/components/settings/ConnectionSettings.tsx', [
  'grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2',
  'Only one JIRA connection is allowed per project.',
  'Only one QMetry connection is allowed per project.',
  'Project-scoped JQL',
  'JIRA source project keys',
]);

hasAll('src/lib/api.ts', [
  "? value : 'template'",
]);

hasAll('src/pages/AiReportPage.tsx', [
  'px-4 py-4',
  'w-full min-w-0 sm:w-auto',
  'p-4 bg-[#f5f3ed] sm:p-6 lg:p-8',
  'Generate Report',
  'No report yet',
]);
hasNone('src/pages/AiReportPage.tsx', ['Generate AI report', 'No AI report yet', 'setReportProject', 'projectOptions']);

hasAll('src/App.tsx', [
  'showRuntimeSearch',
  'showSearch={showRuntimeSearch}',
  'datesChanged={datesChanged}',
  'searchQuery={filters.search}',
  "vars.tab === 'uat'",
  "vars.tab === 'wonder-miles'",
  'batchApi.getDashboard(vars.params)',
  'batchApi.getUploadedIssueDashboard',
  'batchApi.searchDashboardByDates(vars.params)',
  'selectedProjectRecord?.capabilities.wonderMilesExport',
  'selectedProjectRecord?.capabilities.vendorPortal',
  "filters.project !== 'all'",
  'projectRequestSequence.current === 0',
]);

hasAll('src/pages/TestersPage.tsx', [
  'qualityAssuranceSearch',
  'searchText.toLowerCase()',
  'Search updates this page instantly',
  'Quality Assurance Performance by Project',
  'Quality Assurance Performance by Project',
  'Quality Assurance project breakdown',
  'projectSliceAsDashboard',
]);

hasAll('src/components/qa/TestersPerformanceSection.tsx', [
  'notExecutedCases',
  'Not Executed test case{cases.length',
  'excluded from Total Executions, pass rate, and Quality Assurance rankings',
]);

hasAll('src/pages/CyclesPage.tsx', [
  'searchQuery.trim().toLowerCase()',
  'filters loaded cycle names and keys instantly',
  'Test Cycle Summary by Project',
  "`${c.project || ''}:${c.key}`",
  'Test Cycle project breakdown',
]);

hasAll('src/pages/TraceabilityPage.tsx', [
  'searchQuery.trim().toLowerCase()',
  'Search filters these rows instantly',
  'Requirements Traceability by Project',
  'projectDisplayName(w.project)',
  'Traceability project breakdown',
]);

hasAll('src/pages/ImportStatusPage.tsx', [
  'qa-import-project',
  "selectedProject === 'all' ? importProjectKey : selectedProject",
  'the masthead remains All Projects',
  'setImportProjectKey(event.target.value)',
]);

hasAll('src/components/qa/AiReportCharts.tsx', ['Project Comparison', 'dashboard.byProject!.map']);
hasAll('src/components/qa/ProjectBreakdownTabs.tsx', ['projectSliceAsDashboard', "['all', ...projects.map", 'projectDisplayName(project, dashboard.scope.projectNamesByKey)']);
hasAll('src/pages/AiReportPage.tsx', ['QA Report project breakdown', 'visibleChartData', 'projectSliceAsDashboard']);
hasAll('src/components/qa/AiReportWonderMilesSection.tsx', ['Wonder Miles Export Data', 'uploadedRows', 'Open Bugs', 'sourceFile']);
hasAll('src/components/qa/ReportPrintContent.tsx', ['Wonder Miles Export Data', '<WonderMilesRows dashboard={dashboard} />']);
hasAll('src/components/qa/ReportPrintContent.tsx', ['Portfolio Project Comparison', '<ProjectComparison dashboard={dashboard} />']);

hasAll('src/pages/WonderMilesExportPage.tsx', [
  'Wonder Miles Export Data',
  'uploaded spreadsheets only',
  'Live Jira and QMetry connection data is excluded',
  'Wonder Miles Stories',
  'Wonder Miles Bugs',
  'Source file',
  'StatusTabs',
  'Page {page + 1} of {totalPages}',
  'max-w-full overflow-x-auto overscroll-x-contain',
]);

hasAll('src/components/layout/QaTabNav.tsx', [
  "showWonderMilesExport = false",
  "append('wonder-miles', 'Wonder Miles Export Data')",
]);

hasAll('src/pages/UatPage.tsx', [
  'searchQuery.trim().toLocaleLowerCase()',
  'visibleVendorPortalRowValues',
  'Use Basic Search for quick criteria',
]);

hasAll('src/components/qa/VendorPortalPhaseChart.tsx', [
  'grid-cols-1',
  'sm:grid-cols-[minmax(130px,0.9fr)_minmax(160px,2.1fr)_auto]',
  'min-w-0',
  'unclassified',
  'legacyOtherUat',
  'onViewUnclassified',
  'View {fmt(unclassified.count)} unclassified',
]);

hasAll('src/pages/UatPage.tsx', [
  "uat?.byReportedPhase || []",
  'rowsForBugView',
  'VendorPortalPhaseChart',
  'Bug Distribution by Environment & Phase',
  'every other non-empty subject → Phase 1',
  'availableBugViews',
  "viewCounts.unclassified > 0",
  'VendorPortalBugView',
  'max-w-full overflow-x-auto overscroll-x-contain',
  'Page {safePage + 1} of {totalPages}',
  "label: 'Change Request'",
  'Advanced Search',
  'JQL-style query',
  'pageRows.map',
]);
hasNone('src/pages/UatPage.tsx', ['ODL source file', 'Source file', 'Phase / Env']);

hasAll('src/pages/TraceabilityPage.tsx', [
  'compareNewestFirst',
  'StatusTabs',
  "type WorkItemStatusFilter = 'all' | WorkItem['status']",
  'Done / Closed',
  'max-w-full overflow-x-auto overscroll-x-contain',
  'setStoryPage(0)',
  'setBugPage(0)',
]);

hasAll('src/components/qa/ReportPrintContent.tsx', [
  "import { VendorPortalPhaseChart } from './VendorPortalPhaseChart'",
  'Vendor Portal Bug Distribution by Environment & Phase',
  '<VendorPortalPhaseChart items={vendorPortalPhases} />',
  'qa-business-vendor-phase-chart',
]);

hasAll('src/lib/printReadiness.ts', [
  '[data-testid="vendor-portal-phase-chart"]',
]);

hasAll('src/pages/AiReportPage.tsx', [
  'userFacingWarnings(reportData.dashboard.meta.warnings)',
  'userFacingWarnings(result.warnings)',
]);

hasAll('src/pages/SettingsPage.tsx', [
  'userFacingWarnings(syncResult?.warnings)',
  'syncWarnings.join',
]);

hasAll('src/pages/ImportStatusPage.tsx', [
  'Promise.all(selectedFiles.map',
  'multiple className="hidden"',
  'handleFiles(e.dataTransfer.files)',
  'File project',
  'Choose which project files to manage; the masthead remains All Projects',
  "disabled={selectedProject !== 'all'}",
  'uploads sync automatically',
  'batchApi.syncInputFiles(selected.id',
  'onImportedDataChanged?.(result.dashboard ?? null)',
  '!selected ?',
]);
hasNone('src/pages/ImportStatusPage.tsx', ['New project key', 'New project name', 'Create project']);

hasAll('src/App.tsx', [
  'min-w-0 overflow-x-hidden',
  'overflow-x-hidden overflow-y-auto',
  'setBaseDashboard(freshDashboard)',
  'setFilteredByTab({})',
]);

hasAll('src/index.css', [
  'overflow-x: hidden',
]);

for (const file of [
  'src/components/layout/QaMasthead.tsx',
  'src/components/layout/QaTabNav.tsx',
  'src/components/layout/QaFilterBar.tsx',
  'src/components/layout/QaPageShell.tsx',
  'src/components/layout/QaFooter.tsx',
  'src/components/common/EmptyDashboard.tsx',
]) {
  hasNoUnscopedClass(file, 'px-8');
}

for (const file of [
  'src/pages/SettingsPage.tsx',
  'src/components/qa/CycleDetailDrawer.tsx',
]) {
  hasNoUnscopedClass(file, 'grid-cols-2');
}

console.log('responsive layout contract tests passed');
