import assert from 'node:assert/strict';
import type { DashboardUatRow } from 'qa-dashboard-batch';
import {
  EMPTY_VENDOR_PORTAL_FILTERS,
  basicFilterOptions,
  basicFiltersToQuery,
  filterVendorPortalRows,
  visibleVendorPortalRowValues,
} from '../vendorPortalBugFilters.ts';
import {
  advancedQueryToBasicFilters,
  compileVendorPortalQuery,
} from '../vendorPortalQuery.ts';

function row(overrides: Partial<DashboardUatRow> & Pick<DashboardUatRow, 'id' | 'status'>): DashboardUatRow {
  return {
    id: overrides.id,
    status: overrides.status,
    subject: overrides.subject || 'Payment validation',
    area: overrides.area || 'Checkout',
    priority: overrides.priority || 'High',
    submitter: overrides.submitter || 'QA One',
    submittedAt: overrides.submittedAt ?? '2026-07-10',
    updatedAt: overrides.updatedAt || '2026-07-10',
    cr: overrides.cr ?? 'CR-100',
    note: overrides.note ?? '',
    reportedPhase: overrides.reportedPhase || 'phase1-uat',
    sourceFile: overrides.sourceFile || 'hidden-source.xlsx',
  };
}

const rows = [
  row({ id: 'VP-1', status: ' pending ', priority: 'High', cr: 'CR-100' }),
  row({ id: 'VP-2', status: 'PENDING', priority: 'Low', cr: 'CR-200', submittedAt: '2026-07-11' }),
  row({ id: 'VP-3', status: 'Closed', priority: 'Low', subject: 'Profile issue', cr: '', submittedAt: '' }),
  row({ id: 'VP-4', status: 'Awaiting Vendor', priority: 'Medium', area: 'Export' }),
];

const statusOptions = basicFilterOptions(rows, 'status', EMPTY_VENDOR_PORTAL_FILTERS);
assert.deepStrictEqual(statusOptions.map((option) => option.value), ['Pending', 'Closed', 'Awaiting Vendor']);
assert.deepStrictEqual(statusOptions.map((option) => option.count), [2, 1, 1]);

const lowPriority = { ...EMPTY_VENDOR_PORTAL_FILTERS, priority: 'Low' };
const lowCounts = basicFilterOptions(rows, 'status', lowPriority);
assert.deepStrictEqual(lowCounts.map((option) => [option.value, option.count]), [
  ['Pending', 1],
  ['Closed', 1],
  ['Awaiting Vendor', 0],
]);

assert.equal(filterVendorPortalRows(rows, { ...EMPTY_VENDOR_PORTAL_FILTERS, text: 'cr-200' }).length, 1);
assert.equal(filterVendorPortalRows(rows, { ...EMPTY_VENDOR_PORTAL_FILTERS, text: '2026-07-11' }).length, 1);
assert.equal(filterVendorPortalRows(rows, { ...EMPTY_VENDOR_PORTAL_FILTERS, text: 'hidden-source.xlsx' }).length, 0);
assert.equal(filterVendorPortalRows([row({ id: 'VP-NOTE', status: 'Pending', note: 'Vendor deployed a fix' })], { ...EMPTY_VENDOR_PORTAL_FILTERS, text: 'deployed' }).length, 1);
assert.deepStrictEqual(visibleVendorPortalRowValues(rows[2]).slice(-4), ['QA One', '—', '2026-07-10', '—']);

function matching(query: string): string[] {
  const compiled = compileVendorPortalQuery(query);
  assert.ok(compiled.predicate, compiled.error);
  return rows.filter(compiled.predicate!).map((item) => item.id);
}

assert.deepStrictEqual(matching('status IN ("Pending", "Closed")'), ['VP-1', 'VP-2', 'VP-3']);
assert.deepStrictEqual(matching('priority = "Low" AND status != "Closed"'), ['VP-2']);
assert.deepStrictEqual(matching('(status = "Closed" OR status = "Awaiting Vendor") AND NOT priority = "High"'), ['VP-3', 'VP-4']);
assert.deepStrictEqual(matching('text ~ "payment"'), ['VP-1', 'VP-2', 'VP-4']);
assert.deepStrictEqual(matching('submitted >= "2026-07-11"'), ['VP-2']);
assert.deepStrictEqual(matching('updated >= "2026-07-10"'), ['VP-1', 'VP-2', 'VP-3', 'VP-4']);
assert.deepStrictEqual(matching('changeRequest !~ "200"'), ['VP-1', 'VP-3', 'VP-4']);

const invalid = compileVendorPortalQuery('unknown = "x"');
assert.equal(invalid.predicate, undefined);
assert.match(invalid.error || '', /Unknown field/);
assert.equal(compileVendorPortalQuery('submitted > "July 10"').predicate, undefined);
assert.equal(compileVendorPortalQuery(`text ~ "${'x'.repeat(2_100)}"`).predicate, undefined);

const basic = {
  ...EMPTY_VENDOR_PORTAL_FILTERS,
  status: 'Pending',
  priority: 'High',
  text: 'payment',
};
const basicQuery = basicFiltersToQuery(basic);
assert.deepStrictEqual(advancedQueryToBasicFilters(basicQuery), basic);
assert.equal(advancedQueryToBasicFilters('status = "Pending" OR status = "Closed"'), null);

console.log('Vendor Portal basic and advanced search tests passed');
