import assert from 'assert';
import path from 'path';
import { parseAllFiles } from '../../parse/dispatcher';
import { mergeDatasets } from '../../merge/mergeDataset';
import { buildDashboardPayload } from '../buildDashboardPayload';
import { hasDashboardMetrics, noMetricsForScopeMessage } from '../reportMetrics';
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
    { project: 'DLM', key: 'DLM-101', summary: 'Global DMC complete story summary shown without fallback', area: 'Login', issueType: 'Story', status: 'open', priority: 'High', assignee: 'Owner One', createdAt: '2026-01-10', resolvedAt: null, updatedAt: '2026-07-03', sprint: 'Sprint 12', source: 'jira-api' },
    { project: 'DLM', key: 'DLM-102', summary: 'Reactive Maintenance complete bug summary shown without fallback', area: 'Login', issueType: 'Bug', status: 'open', priority: 'Highest', assignee: 'Owner Two', createdAt: '2026-02-10', resolvedAt: null, updatedAt: '2026-07-04', sprint: 'Sprint 13', source: 'jira-api' },
  ];
  dataset.projects = ['DLM', 'DP'];
  return dataset;
}

function duplicateDataset(): Dataset {
  const file = emptyDataset();
  file.executions = [
    { project: 'DN4_FT - Supply & DMC', cycleKey: 'DLM-CY-1', cycleName: 'Cycle 1', caseKey: 'DLM-TC-1', result: 'FAIL', tester: 's716363', executedAt: '2026-07-01', updatedAt: '2026-07-01', source: 'test-execution-file' },
    { project: 'DLM', cycleKey: 'DLM-CY-2', cycleName: 'Cycle 2', caseKey: 'DLM-TC-1', result: 'PASS', tester: 'Tester Two', executedAt: '2026-07-02', updatedAt: '2026-07-02', source: 'test-execution-file' },
  ];
  file.issues = [
    { project: 'DLM', key: 'DLM-500', area: 'Payments', issueType: 'Bug', status: 'open', priority: 'High', assignee: 'File Owner', createdAt: '2026-07-01', resolvedAt: null, updatedAt: '2026-07-01', source: 'jira-file' },
  ];
  file.projects = ['DN4_FT - Supply & DMC'];

  const live = emptyDataset();
  live.executions = [
    { project: 'DLM', cycleKey: 'DLM-CY-1', cycleName: 'Cycle 1', caseKey: 'DLM-TC-1', result: 'PASS', tester: 'Real Tester', executedAt: '2026-07-01', updatedAt: '2026-07-03', source: 'qmetry' },
  ];
  live.issues = [
    { project: 'DLM', key: 'DLM-500', area: 'Payments', issueType: 'Bug', status: 'done', priority: 'High', assignee: 'Api Owner', createdAt: '2026-07-01', resolvedAt: '2026-07-04', updatedAt: '2026-07-04', source: 'jira-api' },
  ];
  live.projects = ['DLM'];

  return mergeDatasets([file, live]);
}

function vendorPortalFilesDataset(): Dataset {
  const dataset = emptyDataset();
  dataset.uat = [
    { id: 'ODL-1', subject: 'UAT login issue', area: 'Login', cr: 'CR-1', priority: 'High', clientPriority: '', submitter: 'QA One', submittedAt: '2026-07-01', updatedAt: '2026-07-01', status: 'Open', open: true, project: 'DLM', source: 'odl-file', sourceFile: 'daily-odl.xlsx' },
    { id: 'ODL-2', subject: 'Phase 2B UAT payment issue', area: 'Payments', cr: 'CR-2', priority: 'Medium', clientPriority: '', submitter: 'QA Two', submittedAt: '2026-07-02', updatedAt: '2026-07-03', status: 'Closed', open: false, project: 'DLM', source: 'odl-file', sourceFile: 'daily-odl.xlsx' },
    { id: 'INC-1', subject: 'INC001234 production outage', area: 'Checkout', cr: 'N/A', priority: 'Urgent', clientPriority: '', submitter: 'Support', submittedAt: '2026-07-04', updatedAt: '2026-07-05', status: 'Open', open: true, project: 'DLM', source: 'odl-file', sourceFile: 'production.xlsx' },
    { id: 'OTHER-1', subject: 'Missing naming prefix', area: 'Checkout', cr: 'N/A', priority: 'Low', clientPriority: '', submitter: 'Support', submittedAt: '2026-07-05', updatedAt: '2026-07-05', status: 'Open', open: true, project: 'DLM', source: 'odl-file', sourceFile: 'production.xlsx' },
  ];
  dataset.projects = ['DLM'];
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

// Two uploaded Vendor Portal sheets merge into one payload but retain source
// traceability and separate rows by their Subject prefix.
{
  const p = buildDashboardPayload(vendorPortalFilesDataset(), { project: 'DLM' });
  assert.ok(p.uat);
  assert.deepStrictEqual(
    p.uat?.byReportedPhase?.map(({ category, count }) => ({ category, count })),
    [
      { category: 'phase1-uat', count: 2 },
      { category: 'phase2-uat', count: 1 },
      { category: 'production', count: 1 },
      { category: 'unclassified', count: 0 },
    ],
  );
  assert.deepStrictEqual(p.uat?.sourceFiles, [
    { name: 'daily-odl.xlsx', rows: 2 },
    { name: 'production.xlsx', rows: 2 },
  ]);
  assert.strictEqual(p.uat?.rows.find((row) => row.id === 'INC-1')?.reportedPhase, 'production');

  const productionOnly = buildDashboardPayload(vendorPortalFilesDataset(), { project: 'DLM', search: 'INC001234' });
  assert.strictEqual(productionOnly.uat?.total, 1, 'search filtering happens before phase aggregation');
  assert.strictEqual(productionOnly.uat?.byReportedPhase?.find((item) => item.category === 'production')?.count, 1);
  assert.deepStrictEqual(productionOnly.uat?.sourceFiles, [{ name: 'production.xlsx', rows: 1 }]);

  const sourceFileSearch = buildDashboardPayload(vendorPortalFilesDataset(), { project: 'DLM', search: 'production.xlsx' });
  assert.strictEqual(sourceFileSearch.uat?.total, 2, 'Vendor Portal search includes source-file provenance');
  console.log('✓ Vendor Portal files remain traceable and phase-separated');
}

// Traceability search includes sprint and normalized issue status, not only
// the issue key/summary fields shown in the original filter implementation.
{
  const sprintSearch = buildDashboardPayload(focusedDataset(), { project: 'DLM', search: 'Sprint 13' });
  assert.strictEqual(sprintSearch.storyBug.story, 0);
  assert.strictEqual(sprintSearch.storyBug.bug, 1);
  assert.strictEqual(sprintSearch.workItems?.[0]?.key, 'DLM-102');

  const statusSearch = buildDashboardPayload(focusedDataset(), { project: 'DLM', search: 'open' });
  assert.strictEqual(statusSearch.workItems?.length, 2, 'Traceability search includes normalized open/done status');
  console.log('✓ Traceability sprint and status search');
}

// April 2026 window (BACKEND_PROMPT acceptance)
{
  const p = buildDashboardPayload(ds, { startDate: '2026-04-01', endDate: '2026-04-30' });
  assert.strictEqual(p.overview.totalCases, 302, 'April totalCases');
  assert.strictEqual(p.overview.failed, 21, 'April failed count');
  assert.strictEqual(p.overview.blocked, 51, 'April blocked count');
  console.log('✓ April 2026 filter window');
}

// Partial date bounds should still filter instead of silently returning all data.
{
  const startOnly = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-04' });
  const explicitStart = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-04', endDate: '2026-07-04' });
  assert.strictEqual(startOnly.overview.totalCases, explicitStart.overview.totalCases, 'startDate-only uses dataMax as implicit endDate');
  assert.strictEqual(startOnly.storyBug.bugOpen, explicitStart.storyBug.bugOpen, 'startDate-only issue filter matches explicit bound');
  assert.strictEqual(startOnly.overview.totalCases, 1);
  assert.strictEqual(startOnly.storyBug.bugOpen, 1);

  const endOnly = buildDashboardPayload(focusedDataset(), { project: 'DLM', endDate: '2026-07-03' });
  const explicitEnd = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-01-10', endDate: '2026-07-03' });
  assert.strictEqual(endOnly.overview.totalCases, explicitEnd.overview.totalCases, 'endDate-only uses dataMin as implicit startDate');
  assert.strictEqual(endOnly.storyBug.storyOpen, explicitEnd.storyBug.storyOpen, 'endDate-only issue filter matches explicit bound');
  assert.strictEqual(endOnly.overview.totalCases, 1);
  assert.strictEqual(endOnly.storyBug.storyOpen, 1);
  console.log('✓ partial date bounds filter correctly');
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

// Dedupe keeps API rows over duplicate file rows and preserves same case in two cycles
{
  const merged = duplicateDataset();
  const p = buildDashboardPayload(merged, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(merged.executions.length, 2, 'same case in two cycles is not a duplicate');
  assert.strictEqual(merged.issues.length, 1, 'same issue key from file and API is deduped');
  assert.strictEqual(merged.issues[0].status, 'done', 'API issue wins over file issue');
  assert.strictEqual(merged.executions.find((e) => e.cycleKey === 'DLM-CY-1')?.tester, 'Real Tester', 'API execution wins over raw file tester');
  assert.strictEqual(p.overview.totalCases, 2);
  assert.strictEqual(p.storyBug.bug, 1);
  assert.strictEqual(p.meta.deduped?.executions, 1);
  assert.strictEqual(p.meta.deduped?.issues, 1);
  console.log('✓ dataset dedupe rules');
}

// Empty search with impossible term
{
  const p = buildDashboardPayload(ds, { search: 'zzz_no_match_xyz_12345' });
  assert.strictEqual(p.overview.totalCases, 0);
  assert.strictEqual(p.testers.length, 0);
  assert.strictEqual(p.cycles.length, 0);
  console.log('✓ empty search match');
}

// Empty report metrics guard must block AI narrative generation
{
  const emptyPayload = buildDashboardPayload(ds, { search: 'zzz_no_match_xyz_12345', project: 'DLM' });
  assert.strictEqual(hasDashboardMetrics(emptyPayload), false, 'empty payload has no report metrics');
  const populatedPayload = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(hasDashboardMetrics(populatedPayload), true, 'populated payload has report metrics');
  const msg = noMetricsForScopeMessage({ project: 'DLM', startDate: '2030-01-01', endDate: '2030-01-31', dataset: ds });
  assert.ok(msg.includes('AI narrative was skipped'));
  assert.ok(msg.includes('Dataset contains:'));
  console.log('✓ empty metrics report guard');
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

// Execution-level QMetry summary is authoritative for overview/tester metrics,
// while detailed testcase rows remain available for cycle health.
{
  const summaryDataset = focusedDataset();
  summaryDataset.executions.push(
    ...Array.from({ length: 8 }, (_, index) => ({
      project: 'DLM',
      cycleKey: 'DLM-EXECUTION-SUMMARY-2026-07-01-2026-07-14',
      cycleName: 'QMetry execution summary (2026-07-01 to 2026-07-14)',
      caseKey: `DLM-SUMMARY-PASS-${index}`,
      result: 'PASS' as const,
      tester: 'Summary Tester',
      executedAt: null,
      updatedAt: null,
      source: 'qmetry' as const,
      summaryOnly: true,
      summaryScopeStart: '2026-07-01',
      summaryScopeEnd: '2026-07-14',
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      project: 'DLM',
      cycleKey: 'DLM-EXECUTION-SUMMARY-2026-07-01-2026-07-14',
      cycleName: 'QMetry execution summary (2026-07-01 to 2026-07-14)',
      caseKey: `DLM-SUMMARY-FAIL-${index}`,
      result: 'FAIL' as const,
      tester: 'Summary Tester',
      executedAt: null,
      updatedAt: null,
      source: 'qmetry' as const,
      summaryOnly: true,
      summaryScopeStart: '2026-07-01',
      summaryScopeEnd: '2026-07-14',
    })),
  );

  const exact = buildDashboardPayload(summaryDataset, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14' });
  assert.strictEqual(exact.overview.totalCases, 10, 'summary must replace incomplete detailed rows for overview counts');
  assert.strictEqual(exact.overview.passRate, 80);
  assert.strictEqual(exact.testers.length, 1, 'mismatched detail totals must not replace authoritative tester attribution');
  assert.strictEqual(exact.testers[0]?.name, 'Summary Tester');
  assert.strictEqual(exact.testers[0]?.executed, 10);
  assert.ok(exact.cycles.every((cycle) => !cycle.key.includes('EXECUTION-SUMMARY')), 'summary rows must not create a fake test cycle');
  assert.strictEqual(exact.overview.byMonth.find((month) => month.ym === '2026-07')?.pass, 8);

  const differentRange = buildDashboardPayload(summaryDataset, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.notStrictEqual(differentRange.overview.totalCases, 10, 'a scoped summary must not leak into another date window');
  console.log('✓ QMetry execution summary is authoritative and scope-safe');
}

// When detailed QMetry rows reconcile exactly with every executed summary
// result bucket, they may safely provide the more complete tester names. N/A
// is an executed result and participates in the reconciliation rather than
// being treated as an attribution balancing bucket.
{
  const reconciledDataset = emptyDataset();
  const summaryBase = {
    project: 'DLM',
    cycleKey: 'DLM-EXECUTION-SUMMARY-2026-07-01-2026-07-14',
    cycleName: 'QMetry execution summary (2026-07-01 to 2026-07-14)',
    tester: 'Summary Tester',
    executedAt: null,
    updatedAt: null,
    source: 'qmetry' as const,
    summaryOnly: true,
    summaryScopeStart: '2026-07-01',
    summaryScopeEnd: '2026-07-14',
  };
  const detailTesterNames = ['Tester One', 'Tester Two', 'Tester Three', 'Tester Four'];
  reconciledDataset.executions = [
    ...Array.from({ length: 100 }, (_, index) => ({ ...summaryBase, caseKey: `DLM-SUMMARY-${index}`, result: index < 6 ? 'PASS' as const : 'NA' as const })),
    ...Array.from({ length: 100 }, (_, index) => ({
      project: 'DLM',
      cycleKey: 'DLM-TR-1',
      cycleName: 'Reconciled cycle',
      caseKey: `DLM-TC-${index + 1}`,
      result: index < 6 ? 'PASS' as const : 'NA' as const,
      tester: detailTesterNames[Math.floor(index / 25)],
      executedAt: '2026-07-05',
      updatedAt: '2026-07-05',
      source: 'qmetry' as const,
    })),
  ];
  reconciledDataset.projects = ['DLM'];

  const payload = buildDashboardPayload(reconciledDataset, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14' });
  assert.strictEqual(payload.overview.totalCases, 100, 'authoritative summary total must remain unchanged');
  assert.strictEqual(payload.overview.executed, 100, 'N/A must remain included in executed totals');
  assert.strictEqual(payload.overview.resultMix.find((item) => item.code === 'NA')?.count, 94);
  assert.deepStrictEqual(payload.testers.map((tester) => tester.name), detailTesterNames);
  assert.strictEqual(payload.testers.reduce((sum, tester) => sum + tester.executed, 0), 100, 'reconciled tester totals must not exceed the authoritative total');
  assert.strictEqual(payload.testers.reduce((sum, tester) => sum + tester.na, 0), 94, 'all 94 N/A results must remain attributed without changing the total');
  console.log('✓ reconciled detail rows restore complete tester names without double-counting N/A');
}

// JIRA updatedAt keeps traceability rows in date-scoped views
{
  const p = buildDashboardPayload(focusedDataset(), { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(p.storyBug.story, 1);
  assert.strictEqual(p.storyBug.bug, 1);
  assert.strictEqual(p.traceability.length, 1);
  assert.strictEqual(p.traceability[0].area, 'Login');
  assert.strictEqual(p.workItems?.find((item) => item.key === 'DLM-101')?.summary, 'Global DMC complete story summary shown without fallback');
  assert.strictEqual(p.workItems?.find((item) => item.key === 'DLM-102')?.summary, 'Reactive Maintenance complete bug summary shown without fallback');
  console.log('✓ traceability updatedAt filter');
}

// Browser-side Quality Assurance search metadata and Not Executed diagnostics
// must come from the already-filtered QMetry detail rows. They are read-only
// additions and must not alter authoritative dashboard totals.
{
  const diagnosticDataset = emptyDataset();
  diagnosticDataset.executions = [
    { project: 'DLM', cycleKey: 'DLM-CY-SEARCH', cycleName: 'Searchable Checkout Cycle', caseKey: 'DLM-TC-EXECUTED', result: 'PASS', tester: 'QA Search Person', executedAt: '2026-07-10', updatedAt: '2026-07-10', source: 'qmetry' },
    { project: 'DLM', cycleKey: 'DLM-CY-SEARCH', cycleName: 'Searchable Checkout Cycle', caseKey: 'DLM-TC-PENDING', result: 'NE', tester: null, executedAt: null, updatedAt: '2026-07-10', source: 'qmetry' },
  ];
  diagnosticDataset.projects = ['DLM'];

  const payload = buildDashboardPayload(diagnosticDataset, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.strictEqual(payload.overview.totalCases, 2);
  assert.strictEqual(payload.overview.executed, 1, 'diagnostic fields must not make Not Executed count as executed');
  assert.match(payload.qualityAssuranceSearch?.[0]?.searchText || '', /Searchable Checkout Cycle/);
  assert.match(payload.qualityAssuranceSearch?.[0]?.searchText || '', /DLM-TC-EXECUTED/);
  assert.deepStrictEqual(payload.notExecutedCases, [{
    project: 'DLM',
    cycleKey: 'DLM-CY-SEARCH',
    cycleName: 'Searchable Checkout Cycle',
    caseKey: 'DLM-TC-PENDING',
    updatedAt: '2026-07-10',
  }]);
  console.log('✓ runtime QA search metadata and Not Executed diagnostics');
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

// A2 date-leak regression: open issues must NOT leak across periods.
// DLM-101 (open Story, created 2026-01-10, updated 2026-07-03) and
// DLM-102 (open Bug, created 2026-02-10, updated 2026-07-04).
// The old buggy clause (status==='open' && createdAt <= endDate) kept both for ANY later
// range because it ignored startDate. Under A2 an issue counts only if created/updated/
// resolved falls inside [start,end].
{
  // A period BEFORE either issue's activity: must be empty (this is what the leak broke).
  const pre = buildDashboardPayload(focusedDataset(), { startDate: '2026-03-01', endDate: '2026-03-31', project: 'DLM' });
  assert.strictEqual(pre.storyBug.bugOpen, 0, 'A2: no open bugs in a period with no issue activity (was leaking before)');
  assert.strictEqual(pre.storyBug.story + pre.storyBug.bug, 0, 'A2: no issues at all in an inactive period');

  // The window where both were updated: both count.
  const active = buildDashboardPayload(focusedDataset(), { startDate: '2026-07-01', endDate: '2026-07-31', project: 'DLM' });
  assert.strictEqual(active.storyBug.bugOpen, 1, 'A2: the open bug counts in the period it was updated');
  assert.strictEqual(active.storyBug.story + active.storyBug.bug, 2, 'A2: both issues count in their active period');

  // Monotonicity: extending endDate later must NOT increase open-bug count when startDate
  // is fixed after all activity — the exact "count stuck/growing" symptom, now impossible.
  const narrow = buildDashboardPayload(focusedDataset(), { startDate: '2026-08-01', endDate: '2026-08-02', project: 'DLM' });
  assert.strictEqual(narrow.storyBug.bugOpen, 0, 'A2: a period after all activity shows zero, not the full backlog');
  console.log('✓ A2 date-leak regression (open issues do not cross periods)');
}

console.log('All dashboard filter tests passed');
