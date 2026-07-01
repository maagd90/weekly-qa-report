import assert from 'assert';
import path from 'path';
import { parseAllFiles } from '../../parse/dispatcher';
import { mergeDatasets } from '../../merge/mergeDataset';
import { buildDashboardPayload } from '../buildDashboardPayload';

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

// Empty search with impossible term
{
  const p = buildDashboardPayload(ds, { search: 'zzz_no_match_xyz_12345' });
  assert.strictEqual(p.overview.totalCases, 0);
  assert.strictEqual(p.testers.length, 0);
  assert.strictEqual(p.cycles.length, 0);
  console.log('✓ empty search match');
}

console.log('All dashboard filter tests passed');
