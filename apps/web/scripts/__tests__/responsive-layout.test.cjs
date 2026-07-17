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
  'saveConnections(); syncLiveMutation.mutate();',
  'saveConnections(); testMutation.mutate();',
]);
hasNone('src/pages/SettingsPage.tsx', ['saveAll']);

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
hasNone('src/pages/AiReportPage.tsx', ['Generate AI report', 'No AI report yet']);

hasAll('src/App.tsx', [
  'showRuntimeSearch',
  'showSearch={showRuntimeSearch}',
  'datesChanged={datesChanged}',
  'searchQuery={filters.search}',
]);

hasAll('src/pages/TestersPage.tsx', [
  'qualityAssuranceSearch',
  'searchText.toLowerCase()',
  'Search updates this page instantly',
]);

hasAll('src/components/qa/TestersPerformanceSection.tsx', [
  'notExecutedCases',
  'Not Executed test case{cases.length',
  'excluded from Total Executions, pass rate, and Quality Assurance rankings',
]);

hasAll('src/pages/CyclesPage.tsx', [
  'searchQuery.trim().toLowerCase()',
  'filters loaded cycle names and keys instantly',
]);

hasAll('src/pages/TraceabilityPage.tsx', [
  'searchQuery.trim().toLowerCase()',
  'Search filters these rows instantly',
]);

hasAll('src/pages/UatPage.tsx', [
  'searchQuery.trim().toLowerCase()',
  'searchedRows',
  'Search filters the bug rows instantly',
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
  "row.reportedPhase || 'unclassified'",
  "category === 'other-uat'",
  'VendorPortalPhaseChart',
  'Bug Distribution by Environment & Phase',
  'every other non-empty subject → Phase 1',
  'availableBugViews',
  "viewCounts.unclassified > 0",
  "type BugView = 'uat' | 'production' | 'unclassified'",
  'max-w-full overflow-x-auto overscroll-x-contain',
  'Page {safePage + 1} of {totalPages}',
  'Source file',
  'pageRows.map',
]);
hasNone('src/pages/UatPage.tsx', ['ODL source file', "(['uat', 'production', 'unclassified'] as BugView[])"]);

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
]);

hasAll('src/App.tsx', [
  'min-w-0 overflow-x-hidden',
  'overflow-x-hidden overflow-y-auto',
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
