import assert from 'assert';
import path from 'path';
import { parseAllFiles } from '../../parse/dispatcher';
import { mergeDatasets } from '../../merge/mergeDataset';
import { buildDashboardPayload } from '../buildDashboardPayload';
import { emptyDataset, type Dataset } from '../../types/dataset';

const FIXTURES = path.resolve(__dirname, '../../../../../fixtures/synthetic');

function loadDataset() {
  const files = [
    path.join(FIXTURES, 'zephyr-regression.xlsx'),
    path.join(FIXTURES, 'jira-regression.xlsx'),
    path.join(FIXTURES, 'odl-regression.xlsx'),
  ];
  return mergeDatasets([parseAllFiles(files)]);
}

const ds = loadDataset();

function focusedDataset(): Dataset {
  const dataset = emptyDataset();
  dataset.executions = [
    { project: 'DLM', cycleKey: 'DLM-TR-1', cycleName: 'July live cycle', caseKey: 'DLM-TC-1', result: 'PASS', tester: 'Tester One', executedAt: null, updatedAt: '2026-07-03', source: 'qmetry' },
    { project: 'DLM', cycleKey: 'DLM-TR-1', cycleName: 'July live cycle', caseKey: 'DLM-TC-2', result: 'FAIL', tester: 'Tester Two', executedAt: null, updatedAt: '2026-07-04', source: 'qmetry' },
    { project: 'DP', cycleKey: 'DP-TR-1', cycleName: 'Excel cycle', caseKey: 'DP-TC-1', result: 'BLOCKED', tester: 'Tester Three', executedAt: '2026-06-15', updatedAt: '2026-06-15', source: 'test-execution-file' },
  ];
  dataset.issues = [
    { project: 'DLM', key: 'DLM-101', area: 'Login', issueType: 'Story', status: 'open', priority: 'High', assignee: 'Owner One', createdAt: '2026-01-10', resolvedAt: null, updatedAt: '2026-07-03', source: 'jira-api' },
    { project: 'DLM', key: 'DLM-102', area: 'Login', issueType: 'Bug', status: 'open', priority: 'Highest', assignee: 'Owner Two', createdAt: '2026-02-10', resolvedAt: null, updatedAt: '2026-07-04', source: 'jira-api' },
  ];
  dataset.projects = ['DLM', 'DP'];
  return dataset;
}

// Full dataset — no filter
{
  const p = buildDashboardPayload(ds, {});
  assert.ok(p.scope.projects.includes('DLM'), 'scope.projects includes DLM');
  assert.strictEqual(p.storyBug.story, 582);
  assert.strictEqual(p.storyBug.bug, 197);
  assert.ok(p.overview.chartSeries.resultMix.length >= 5);
  assert.ok(p.overview.chartSeries.resultMix.every((s: { color: string }) => s.color.startsWith('#')));
  assert.strictEqual(p.defectBacklog.topPriorities.length, Math.min(6, p.defectBacklog.byPriority.length));
  assert.ok(p.cyclesByPassPctAsc.length === p.cycles.length);
  if (p.cyclesByPassPctAsc.length >= 2) {
    assert.ok(p.cyclesByPassPctAsc[0].passPct <= p.cyclesByPassPctAsc[p.cyclesByPassPctAsc.length - 1].passPct);
  }
  console.log('✓ Full payload shape');
}

// April 2026 window (BACKEND_PROMPT acceptance)
{
  const p = buildDashboardPayload(ds, { startDate: '2026-04-01', endDate: '2026-04-30' });
  assert.strictEqual(p.overview.totalCases, 302, 'April totalCases');
  assert.strictEqual(p.overview.failed, 21, 'April failed count');
  assert.strictEqual(p.overview.blocked, 51, 'April blocked count');
  console.log('✓ April 2026 filter window');
}

// result=FAIL — execution sections only
{
  const all = buildDashboardPayload(ds, { startDate: '2026-01-01', endDate: '2026-12-31' });
  const failOnly = buildDashboardPayload(ds, { startDate: '2026-01-01', endDate: '2026-12-31', result: 'FAIL' });
  assert.ok(failOnly.overview.failed > 0);
  assert.strictEqual(failOnly.overview.failed, failOnly.overview.executed);
  assert.strictEqual(failOnly.storyBug.story, all.storyBug.story, 'FAIL filter does not change storyBug');
  assert.strictEqual(failOnly.storyBug.bug, all.storyBug.bug, 'FAIL filter does not change storyBug');
  console.log('✓ result=FAIL filter');
}

// project=DLM scopes data
{
  const p = buildDashboardPayload(ds, { project: 'DLM' });
  assert.strictEqual(p.scope.project, 'DLM');
  assert.ok(p.overview.totalCases > 0);
  console.log('✓ project filter');
}

// DLM display label must behave exactly like DLM
{
  const canonical = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  const displayLabel = buildDashboardPayload(focusedDataset(), { project: 'DN4_FT - Supply & DMC', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(displayLabel.scope.project, 'DLM');
  assert.strictEqual(displayLabel.overview.totalCases, canonical.overview.totalCases);
  assert.strictEqual(displayLabel.storyBug.story, canonical.storyBug.story);
  assert.strictEqual(displayLabel.storyBug.bug, canonical.storyBug.bug);
  assert.strictEqual(displayLabel.traceability.length, canonical.traceability.length);
  console.log('✓ DLM display label canonical filter');
}

// Empty search with impossible term
{
  const p = buildDashboardPayload(ds, { search: 'zzz_no_match_xyz_12345' });
  assert.strictEqual(p.overview.totalCases, 0);
  assert.strictEqual(p.testers.length, 0);
  assert.strictEqual(p.cycles.length, 0);
  console.log('✓ empty search match');
}

// Monthly chart uses updatedAt when QMetry omits executedAt
{
  const p = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  const july = p.overview.byMonth.find((m) => m.ym === '2026-07');
  assert.ok(july, 'July monthly bucket should exist from updatedAt fallback');
  assert.strictEqual(july.pass, 1);
  assert.strictEqual(july.fail, 1);
  console.log('✓ monthly updatedAt fallback');
}

// JIRA updatedAt keeps traceability rows in date-scoped views
{
  const p = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(p.storyBug.story, 1);
  assert.strictEqual(p.storyBug.bug, 1);
  assert.strictEqual(p.traceability.length, 1);
  assert.strictEqual(p.traceability[0].area, 'Login');
  console.log('✓ traceability updatedAt filter');
}

// Empty filtered result must preserve all project options
{
  const p = buildDashboardPayload(focusedDataset(), { startDate: '2030-01-01', endDate: '2030-01-31' });
  assert.strictEqual(p.overview.totalCases, 0);
  assert.deepStrictEqual(p.scope.projects, ['DLM', 'DP']);
  console.log('✓ empty filter preserves project list');
}

// Report/full range payload should have non-zero widgets for a populated dataset
{
  const p = buildDashboardPayload(focusedDataset(), { startDate: '2026-06-01', endDate: '2026-07-31', project: 'DLM' });
  assert.ok(p.overview.totalCases > 0);
  assert.ok(p.overview.byMonth.length > 0);
  assert.ok(p.storyBug.story + p.storyBug.bug > 0);
  console.log('✓ report payload non-zero in data range');
}

console.log('All dashboard filter tests passed');
