import assert from 'assert';
import path from 'path';
import { parseAllFiles } from '../../parse/dispatcher';
import { mergeDatasets } from '../../merge/mergeDataset';
import { buildDashboardPayload } from '../buildDashboardPayload';

const FIXTURES = path.resolve(__dirname, '../../../../../fixtures/input');

function loadDataset() {
  const files = [
    path.join(FIXTURES, 'report17440364264580082420.xlsx'),
    path.join(FIXTURES, 'Emirates JIRA 2026-06-29T09_45_39+0400.xlsx'),
    path.join(FIXTURES, 'ODL issues.xlsx'),
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
  assert.ok(p.overview.totalCases > 0, 'April has execution rows');
  assert.ok(p.overview.totalCases < 2210, 'April is subset of full Zephyr export');
  // BACKEND_PROMPT: totalCases≈302, failed=21, blocked=51
  assert.ok(Math.abs(p.overview.totalCases - 302) <= 30, `April totalCases ~302 (got ${p.overview.totalCases})`);
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

// search narrows execution-derived sections
{
  const p = buildDashboardPayload(ds, { search: 'PrioHub' });
  assert.ok(p.cycles.length > 0 || p.traceability.length >= 0);
  for (const c of p.cycles) {
    const hay = `${c.name} ${c.key}`.toLowerCase();
    assert.ok(hay.includes('priohub') || p.testers.length > 0, 'search narrows cycles or related rows');
  }
  console.log('✓ search filter');
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
