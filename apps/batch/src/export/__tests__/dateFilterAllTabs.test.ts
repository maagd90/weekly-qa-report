import assert from 'assert';
import { buildDashboardPayload } from '../buildDashboardPayload';
import { emptyDataset, type Dataset } from '../../types/dataset';

function dataset(): Dataset {
  const ds = emptyDataset();
  ds.projects = ['DLM'];
  ds.executions = [
    { project: 'DLM', cycleKey: 'DLM-CY-IN', cycleName: 'In-range cycle', caseKey: 'DLM-TC-IN', result: 'PASS', tester: 'In Range Tester', executedAt: '2026-02-10', updatedAt: '2026-02-10', source: 'qmetry' },
    { project: 'DLM', cycleKey: 'DLM-CY-OUT', cycleName: 'Old cycle', caseKey: 'DLM-TC-OUT', result: 'FAIL', tester: 'Old Tester', executedAt: '2020-02-10', updatedAt: '2020-02-10', source: 'qmetry' },
  ];
  ds.issues = [
    { project: 'DLM', key: 'DLM-2026', area: 'Current Area', issueType: 'Bug', status: 'open', priority: 'High', assignee: 'Current Owner', createdAt: '2026-01-05', resolvedAt: null, updatedAt: '2026-02-12', source: 'jira-api' },
    { project: 'DLM', key: 'DLM-2020', area: 'Old Area', issueType: 'Story', status: 'open', priority: 'Medium', assignee: 'Old Owner', createdAt: '2020-01-05', resolvedAt: null, updatedAt: '2020-02-12', source: 'jira-api' },
  ];
  ds.uat = [
    { id: 'UAT-2026', subject: 'Current UAT', area: 'Current Area', cr: 'CR-1', priority: 'Urgent', clientPriority: 'High', submitter: 'Current Submitter', submittedAt: '2026-03-01', updatedAt: '2026-03-02', status: 'Open', open: true, project: 'DLM', source: 'odl-file' },
    { id: 'UAT-2020', subject: 'Old UAT', area: 'Old Area', cr: 'CR-0', priority: 'Low', clientPriority: 'Low', submitter: 'Old Submitter', submittedAt: '2020-03-01', updatedAt: '2020-03-02', status: 'Closed', open: false, project: 'DLM', source: 'odl-file' },
  ];
  return ds;
}

const payload = buildDashboardPayload(dataset(), {
  project: 'DLM',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  result: 'all',
});

assert.strictEqual(payload.overview.totalCases, 1, 'Overview must exclude pre-2026 executions');
assert.deepStrictEqual(payload.testers.map((tester) => tester.name), ['In Range Tester'], 'Testers must use the same date window');
assert.deepStrictEqual(payload.cycles.map((cycle) => cycle.key), ['DLM-CY-IN'], 'Cycles must use the same date window');
assert.strictEqual(payload.storyBug.bug, 1, 'Overview/defect metrics must include only in-range JIRA issues');
assert.strictEqual(payload.storyBug.story, 0, 'Old JIRA stories must be excluded');
assert.deepStrictEqual(payload.traceability.map((row) => row.area), ['Current Area'], 'Traceability must use the same date window');
assert.strictEqual(payload.uat?.total, 1, 'UAT must use the same date window');
assert.strictEqual(payload.uat?.rows[0]?.id, 'UAT-2026');
assert.strictEqual(payload.scope.startDate, '2026-01-01');
assert.strictEqual(payload.scope.endDate, '2026-12-31');

console.log('All-tab date filter test passed');
