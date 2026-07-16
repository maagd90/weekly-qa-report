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
]);

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
]);

hasAll('src/pages/AiReportPage.tsx', [
  'px-4 py-4',
  'w-full min-w-0 sm:w-auto',
  'p-4 bg-[#f5f3ed] sm:p-6 lg:p-8',
]);

hasAll('src/components/qa/VendorPortalPhaseChart.tsx', [
  'grid-cols-1',
  'sm:grid-cols-[minmax(130px,0.9fr)_minmax(160px,2.1fr)_auto]',
  'min-w-0',
  'unclassified',
  'onViewUnclassified',
  'View {fmt(unclassified.count)} unclassified',
]);

hasAll('src/pages/UatPage.tsx', [
  "uat.byReportedPhase || []",
  "row.reportedPhase || 'unclassified'",
  'flex max-w-full flex-wrap',
  'VendorPortalPhaseChart',
  "type BugView = 'uat' | 'production' | 'unclassified'",
  'max-w-full overflow-x-auto overscroll-x-contain',
  'Page {safePage + 1} of {totalPages}',
  'Source file',
  'pageRows.map',
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
