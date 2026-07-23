import assert from 'assert';
import { buildDashboardPayload } from '../buildDashboardPayload';
import { emptyDataset, type Dataset } from '../../types/dataset';

function fixture(): Dataset {
  const dataset = emptyDataset();
  dataset.projects = ['VENDOR', 'TRAVEL', 'EMPTY'];
  dataset.uat = [{
    id: 'VP-101',
    subject: 'UAT payment validation',
    area: 'Payments',
    cr: 'CR-101',
    priority: 'High',
    clientPriority: '',
    submitter: 'QA One',
    submittedAt: '2026-07-10',
    updatedAt: '2026-07-10',
    status: 'Under Review',
    open: true,
    project: 'VENDOR',
    source: 'odl-file',
    sourceFile: 'vendor-daily.xlsx',
  }];
  dataset.issues = [{
    project: 'TRAVEL',
    key: 'TVL-101',
    summary: 'Wonder export story',
    area: 'Export',
    issueType: 'Story',
    status: 'open',
    priority: 'Medium',
    assignee: 'QA Two',
    createdAt: '2026-07-09',
    resolvedAt: null,
    updatedAt: '2026-07-11',
    source: 'jira-file',
    sourceFile: 'travel-export.xlsx',
  }];
  dataset.files = [
    { name: 'vendor-daily.xlsx', ext: '.xlsx', project: 'VENDOR', rows: 1, status: 'parsed', detectedType: 'odl', source: 'file' },
    { name: 'travel-export.xlsx', ext: '.xlsx', project: 'TRAVEL', rows: 1, status: 'parsed', detectedType: 'jira', source: 'file' },
    { name: 'empty-old.xlsx', ext: '.xlsx', project: 'EMPTY', rows: 2, status: 'parsed', detectedType: 'jira', source: 'file' },
  ];
  return dataset;
}

const dashboard = buildDashboardPayload(fixture(), {
  startDate: '2026-07-01',
  endDate: '2026-07-31',
});
assert.deepStrictEqual(dashboard.byProject?.map((slice) => slice.project), ['VENDOR', 'TRAVEL', 'EMPTY']);

const vendor = dashboard.byProject?.find((slice) => slice.project === 'VENDOR');
const travel = dashboard.byProject?.find((slice) => slice.project === 'TRAVEL');
const empty = dashboard.byProject?.find((slice) => slice.project === 'EMPTY');
assert.equal(vendor?.uat?.total, 1, 'Vendor Portal payload must not be restricted to a hard-coded project key');
assert.deepStrictEqual(vendor?.files?.map((file) => file.name), ['vendor-daily.xlsx']);
assert.deepStrictEqual(travel?.files?.map((file) => file.name), ['travel-export.xlsx']);
assert.deepStrictEqual(empty?.files?.map((file) => file.name), ['empty-old.xlsx']);
assert.deepStrictEqual(vendor?.workItems, []);
assert.deepStrictEqual(travel?.workItems.map((row) => row.key), ['TVL-101']);

const outOfRange = buildDashboardPayload(fixture(), {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});
const outOfRangeVendor = outOfRange.byProject?.find((slice) => slice.project === 'VENDOR');
assert.equal(outOfRangeVendor?.uat, null);
assert.deepStrictEqual(outOfRangeVendor?.files?.map((file) => file.name), ['vendor-daily.xlsx'], 'project file metadata must survive date filtering');

console.log('portfolio specialised section isolation tests passed');
