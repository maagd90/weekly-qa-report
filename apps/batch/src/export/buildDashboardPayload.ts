import type {
  DashboardPayload, Dataset, FilterParams, ExecutionRow,
} from '../types/dataset';
import { resultColor } from '../types/dataset';
import { applyFilters } from '../filters/applyFilters';
import { canonicalProjectKey, canonicalProjectOrUndefined, uniqueCanonicalProjects } from '../projects/projectKey';

interface CycleAgg {
  pass: number; fail: number; blocked: number; ne: number; na: number;
  exec: number; total: number; pr: number; cov: number;
}

function cycleAgg(rows: ExecutionRow[]): CycleAgg {
  const a = { pass: 0, fail: 0, blocked: 0, ne: 0, na: 0 };
  for (const r of rows) {
    if (r.result === 'PASS') a.pass++;
    else if (r.result === 'FAIL') a.fail++;
    else if (r.result === 'BLOCKED') a.blocked++;
    else if (r.result === 'NA') a.na++;
    else a.ne++;
  }
  const exec = a.pass + a.fail + a.blocked + a.na;
  const total = exec + a.ne;
  return { ...a, exec, total, pr: exec ? Math.round((a.pass / exec) * 100) : 0, cov: total ? Math.round((exec / total) * 100) : 0 };
}

function cycleStatus(c: CycleAgg): string {
  if (c.exec === 0) return 'Not Started';
  if (c.pr >= 85) return 'Healthy';
  if (c.pr >= 60) return 'Watch';
  return 'At Risk';
}

function authoritativeMetricExecutions(rows: ExecutionRow[]): ExecutionRow[] {
  const summaryProjects = new Set(rows.filter((row) => row.summaryOnly).map((row) => canonicalProjectKey(row.project)));
  if (!summaryProjects.size) return rows;
  return rows.filter((row) => !row.summaryMarker && (row.summaryOnly || !summaryProjects.has(canonicalProjectKey(row.project))));
}

function monthBucket(row: ExecutionRow): { key: string; label?: string } | null {
  const date = row.executedAt || row.updatedAt;
  if (date) return { key: date.slice(0, 7) };
  if (!row.summaryOnly || !row.summaryScopeStart || !row.summaryScopeEnd) return null;
  const startMonth = row.summaryScopeStart.slice(0, 7);
  const endMonth = row.summaryScopeEnd.slice(0, 7);
  return startMonth === endMonth
    ? { key: startMonth }
    : { key: `${row.summaryScopeStart}..${row.summaryScopeEnd}`, label: 'Selected period' };
}

const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildDashboardPayload(
  dataset: Dataset,
  params: FilterParams & { reportType?: string },
  opts: { includeByProject?: boolean } = {},
): DashboardPayload {
  const { includeByProject = true } = opts;
  const normalizedProject = canonicalProjectOrUndefined(params.project);
  const filterParams = { ...params, project: normalizedProject };
  const filtered = applyFilters(dataset, filterParams);
  const { executions, issues, uat } = filtered;
  const metricExecutions = authoritativeMetricExecutions(executions);
  const cycleExecutions = executions.filter((row) => !row.summaryOnly);
  const execTotals = cycleAgg(metricExecutions);

  const resultDefs = [
    { code: 'PASS', label: 'Passed', key: 'pass' as const },
    { code: 'NE', label: 'Not Executed', key: 'ne' as const },
    { code: 'BLOCKED', label: 'Blocked', key: 'blocked' as const },
    { code: 'FAIL', label: 'Failed', key: 'fail' as const },
    { code: 'NA', label: 'Not Applicable', key: 'na' as const },
  ];
  const totalForPct = execTotals.total || 1;
  const resultMix = resultDefs.map((def) => ({
    code: def.code,
    label: def.label,
    count: execTotals[def.key],
    pct: Math.round((execTotals[def.key] / totalForPct) * 100),
    color: resultColor(def.code),
  }));
  const chartSeries = { resultMix: resultMix.map((r) => ({ name: r.label, value: r.count, color: r.color })) };

  const monthBuckets: Record<string, { pass: number; blocked: number; fail: number; label?: string }> = {};
  for (const r of metricExecutions) {
    const period = monthBucket(r);
    if (!period) continue;
    const ym = period.key;
    if (!monthBuckets[ym]) monthBuckets[ym] = { pass: 0, blocked: 0, fail: 0 };
    if (period.label) monthBuckets[ym].label = period.label;
    if (r.result === 'PASS') monthBuckets[ym].pass++;
    else if (r.result === 'BLOCKED') monthBuckets[ym].blocked++;
    else if (r.result === 'FAIL') monthBuckets[ym].fail++;
  }
  const byMonth = Object.keys(monthBuckets).sort().slice(-6).map((ym) => {
    const bucket = monthBuckets[ym];
    const monthIndex = /^\d{4}-\d{2}$/.test(ym) ? parseInt(ym.slice(5, 7), 10) - 1 : -1;
    const label = bucket.label || (monthIndex >= 0 ? `${MLAB[monthIndex]} '${ym.slice(2, 4)}` : 'Selected period');
    return { ym, label, pass: bucket.pass, blocked: bucket.blocked, fail: bucket.fail };
  }).filter((m) => m.pass + m.blocked + m.fail > 0);

  const testerNames = [...new Set(metricExecutions.map((r) => r.tester).filter(Boolean))] as string[];
  const testers = testerNames.map((name) => {
    const testerRows = metricExecutions.filter((r) => r.tester === name);
    const pass = testerRows.filter((r) => r.result === 'PASS').length;
    const fail = testerRows.filter((r) => r.result === 'FAIL').length;
    const blocked = testerRows.filter((r) => r.result === 'BLOCKED').length;
    const na = testerRows.filter((r) => r.result === 'NA').length;
    const executed = pass + fail + blocked + na;
    return { name, executed, pass, fail, blocked, na, passPct: executed ? Math.round((pass / executed) * 100) : 0 };
  }).filter((t) => t.executed > 0).sort((a, b) => b.executed - a.executed);

  const cycleKeys = [...new Set(cycleExecutions.map((r) => r.cycleKey))];
  const cycles = cycleKeys.map((key) => {
    const cycleRows = cycleExecutions.filter((r) => r.cycleKey === key);
    const cycleTotals = cycleAgg(cycleRows);
    return { key, name: cycleRows[0]?.cycleName || key, total: cycleTotals.total, pass: cycleTotals.pass, fail: cycleTotals.fail, blocked: cycleTotals.blocked, ne: cycleTotals.ne, na: cycleTotals.na, passPct: cycleTotals.pr, coverage: cycleTotals.cov, status: cycleStatus(cycleTotals) };
  }).sort((a, b) => b.total - a.total);
  const cyclesByPassPctAsc = [...cycles].sort((a, b) => a.passPct - b.passPct);

  const projects = uniqueCanonicalProjects([...dataset.projects, ...dataset.executions.map((e) => e.project), ...dataset.issues.map((i) => i.project)]);
  const jStory = issues.filter((r) => r.issueType === 'Story');
  const jBug = issues.filter((r) => r.issueType === 'Bug');
  const storyBug = { story: jStory.length, bug: jBug.length, storyOpen: jStory.filter((r) => r.status === 'open').length, storyDone: jStory.filter((r) => r.status === 'done').length, bugOpen: jBug.filter((r) => r.status === 'open').length, bugDone: jBug.filter((r) => r.status === 'done').length };

  const workItems = issues.map((r) => ({
    key: r.key,
    summary: (r as any).summary || r.area,
    issueType: r.issueType,
    status: r.status,
    priority: r.priority,
    assignee: r.assignee,
    sprint: (r as any).sprint || 'Not mapped',
    sprintId: (r as any).sprintId,
    area: r.area,
    project: canonicalProjectKey(r.project),
    updatedAt: r.updatedAt,
  })).sort((a, b) => (a.sprint === b.sprint ? a.key.localeCompare(b.key) : a.sprint.localeCompare(b.sprint)));

  const areaKeys = [...new Set(issues.map((i) => i.area))];
  const traceability = areaKeys.map((area) => {
    const stories = issues.filter((r) => r.area === area && r.issueType === 'Story');
    const bugs = issues.filter((r) => r.area === area && r.issueType === 'Bug');
    const done = stories.filter((r) => r.status === 'done').length;
    const open = stories.filter((r) => r.status === 'open').length;
    const openBugs = bugs.filter((r) => r.status === 'open').length;
    const completion = stories.length ? Math.round((done / stories.length) * 100) : 0;
    let status = 'Verified';
    if (openBugs > 0) status = 'At Risk';
    else if (open > 0) status = 'In Progress';
    return { area, stories: stories.length, done, open, bugs: bugs.length, openBugs, completion, status };
  }).filter((t) => t.stories > 0 || t.bugs > 0).sort((a, b) => b.stories - a.stories);

  const openBugs = issues.filter((r) => r.issueType === 'Bug' && r.status === 'open');
  const prioOrder = ['Highest', 'High', 'Medium', 'Low'];
  const bugTotByPrio: Record<string, number> = {};
  issues.filter((r) => r.issueType === 'Bug').forEach((r) => { bugTotByPrio[r.priority] = (bugTotByPrio[r.priority] || 0) + 1; });
  const byPriority = prioOrder.map((priority) => ({ priority, open: openBugs.filter((b) => b.priority === priority).length, total: bugTotByPrio[priority] || 0 })).filter((p) => p.total > 0 || p.open > 0);
  const ownerMap: Record<string, number> = {};
  openBugs.forEach((b) => { ownerMap[b.assignee] = (ownerMap[b.assignee] || 0) + 1; });
  const byOwner = Object.entries(ownerMap).map(([name, open]) => ({ name, open })).sort((a, b) => b.open - a.open);

  let uatPayload: DashboardPayload['uat'] = null;
  if (uat.length > 0 && (!normalizedProject || normalizedProject === 'DLM')) {
    const total = uat.length;
    const closed = uat.filter((r) => !r.open).length;
    const open = total - closed;
    const stCounts: Record<string, number> = {};
    const prCounts: Record<string, number> = {};
    const areaCounts: Record<string, number> = {};
    const submitterCounts: Record<string, number> = {};
    uat.forEach((r) => { stCounts[r.status] = (stCounts[r.status] || 0) + 1; prCounts[r.priority] = (prCounts[r.priority] || 0) + 1; areaCounts[r.area] = (areaCounts[r.area] || 0) + 1; submitterCounts[r.submitter] = (submitterCounts[r.submitter] || 0) + 1; });
    uatPayload = { total, open, closed, closureRate: total ? Math.round((closed / total) * 100) : 0, urgentOpen: uat.filter((r) => r.open && r.priority === 'Urgent').length, byStatus: Object.entries(stCounts).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count), byPriority: Object.entries(prCounts).map(([priority, count]) => ({ priority, count })).sort((a, b) => b.count - a.count), byArea: Object.entries(areaCounts).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count).slice(0, 8), bySubmitter: Object.entries(submitterCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), rows: uat.map((r) => ({ id: r.id, subject: r.subject, area: r.area, priority: r.priority, status: r.status, submitter: r.submitter, submittedAt: r.submittedAt || '', updatedAt: r.updatedAt, cr: r.cr })) };
  }

  const isAllProjects = !normalizedProject;
  const byProject = includeByProject && isAllProjects && projects.length > 1 ? projects.map((project) => {
    const slice = buildDashboardPayload(dataset, { ...params, project }, { includeByProject: false });
    return { project, overview: slice.overview, storyBug: slice.storyBug, defectBacklog: slice.defectBacklog, cycles: slice.cycles, testers: slice.testers, uat: slice.uat };
  }) : undefined;

  return {
    scope: { startDate: params.startDate, endDate: params.endDate, search: params.search || '', result: params.result || 'all', project: normalizedProject || 'all', projects },
    overview: { totalCases: execTotals.total, executed: execTotals.exec, passRate: execTotals.exec ? Math.round((execTotals.pass / execTotals.exec) * 100) : 0, failed: execTotals.fail, blocked: execTotals.blocked, resultMix, byMonth, chartSeries },
    testers,
    cycles,
    cyclesByPassPctAsc,
    storyBug,
    traceability,
    workItems,
    defectBacklog: { openTotal: openBugs.length, byPriority, topPriorities: byPriority.slice(0, 6), byOwner },
    uat: uatPayload,
    byProject,
    files: dataset.files,
    meta: { generatedAt: new Date().toISOString(), parsedAt: dataset.meta.parsedAt, fetchedAt: dataset.meta.fetchedAt, warnings: dataset.meta.warnings, dataMin: filtered.dataMin, dataMax: filtered.dataMax, deduped: dataset.meta.deduped },
  } as DashboardPayload & { workItems: typeof workItems };
}
