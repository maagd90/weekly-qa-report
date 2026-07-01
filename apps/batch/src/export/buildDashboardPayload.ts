import type {
  DashboardPayload, Dataset, FilterParams, ExecutionRow,
} from '../types/dataset';
import { resultColor } from '../types/dataset';
import { applyFilters } from '../filters/applyFilters';

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
  return {
    ...a,
    exec,
    total,
    pr: exec ? Math.round((a.pass / exec) * 100) : 0,
    cov: total ? Math.round((exec / total) * 100) : 0,
  };
}

function cycleStatus(c: CycleAgg): string {
  if (c.exec === 0) return 'Not Started';
  if (c.pr >= 85) return 'Healthy';
  if (c.pr >= 60) return 'Watch';
  return 'At Risk';
}

const MLAB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildDashboardPayload(dataset: Dataset, params: FilterParams & { reportType?: string }): DashboardPayload {
  const filtered = applyFilters(dataset, params);
  const { executions, issues, uat } = filtered;
  const execTotals = cycleAgg(executions);

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
  const chartSeries = {
    resultMix: resultMix.map((r) => ({ name: r.label, value: r.count, color: r.color })),
  };

  const monthBuckets: Record<string, { pass: number; blocked: number; fail: number }> = {};
  for (const r of executions) {
    if (!r.executedAt) continue;
    const ym = r.executedAt.slice(0, 7);
    if (!monthBuckets[ym]) monthBuckets[ym] = { pass: 0, blocked: 0, fail: 0 };
    if (r.result === 'PASS') monthBuckets[ym].pass++;
    else if (r.result === 'BLOCKED') monthBuckets[ym].blocked++;
    else if (r.result === 'FAIL') monthBuckets[ym].fail++;
  }
  const byMonth = Object.keys(monthBuckets).sort().slice(-6)
    .map((ym) => {
      const bucket = monthBuckets[ym];
      const monthIndex = parseInt(ym.slice(5, 7), 10) - 1;
      return {
        ym,
        label: `${MLAB[monthIndex]} '${ym.slice(2, 4)}`,
        pass: bucket.pass,
        blocked: bucket.blocked,
        fail: bucket.fail,
      };
    })
    .filter((m) => m.pass + m.blocked + m.fail > 0);

  const testerNames = [...new Set(executions.map((r) => r.tester).filter(Boolean))] as string[];
  const testers = testerNames.map((name) => {
    const testerRows = executions.filter((r) => r.tester === name);
    const pass = testerRows.filter((r) => r.result === 'PASS').length;
    const fail = testerRows.filter((r) => r.result === 'FAIL').length;
    const blocked = testerRows.filter((r) => r.result === 'BLOCKED').length;
    const na = testerRows.filter((r) => r.result === 'NA').length;
    const executed = pass + fail + blocked + na;
    return {
      name,
      executed,
      pass,
      fail,
      blocked,
      na,
      passPct: executed ? Math.round((pass / executed) * 100) : 0,
    };
  }).filter((t) => t.executed > 0).sort((a, b) => b.executed - a.executed);

  const cycleKeys = [...new Set(executions.map((r) => r.cycleKey))];
  const cycles = cycleKeys.map((key) => {
    const cycleRows = executions.filter((r) => r.cycleKey === key);
    const cycleTotals = cycleAgg(cycleRows);
    return {
      key,
      name: cycleRows[0]?.cycleName || key,
      total: cycleTotals.total,
      pass: cycleTotals.pass,
      fail: cycleTotals.fail,
      blocked: cycleTotals.blocked,
      ne: cycleTotals.ne,
      na: cycleTotals.na,
      passPct: cycleTotals.pr,
      coverage: cycleTotals.cov,
      status: cycleStatus(cycleTotals),
    };
  }).sort((a, b) => b.total - a.total);
  const cyclesByPassPctAsc = [...cycles].sort((a, b) => a.passPct - b.passPct);

  const projects = [...new Set([
    ...dataset.projects,
    ...dataset.executions.map((e) => e.project),
    ...dataset.issues.map((i) => i.project),
  ].filter(Boolean))].sort();

  const jStory = issues.filter((r) => r.issueType === 'Story');
  const jBug = issues.filter((r) => r.issueType === 'Bug');
  const storyBug = {
    story: jStory.length,
    bug: jBug.length,
    storyOpen: jStory.filter((r) => r.status === 'open').length,
    storyDone: jStory.filter((r) => r.status === 'done').length,
    bugOpen: jBug.filter((r) => r.status === 'open').length,
    bugDone: jBug.filter((r) => r.status === 'done').length,
  };

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
    return {
      area,
      stories: stories.length,
      done,
      open,
      bugs: bugs.length,
      openBugs,
      completion,
      status,
    };
  }).filter((t) => t.stories > 0 || t.bugs > 0).sort((a, b) => b.stories - a.stories);

  const openBugs = issues.filter((r) => r.issueType === 'Bug' && r.status === 'open');
  const prioOrder = ['Highest', 'High', 'Medium', 'Low'];
  const bugTotByPrio: Record<string, number> = {};
  issues.filter((r) => r.issueType === 'Bug').forEach((r) => {
    bugTotByPrio[r.priority] = (bugTotByPrio[r.priority] || 0) + 1;
  });
  const byPriority = prioOrder.map((priority) => ({
    priority,
    open: openBugs.filter((b) => b.priority === priority).length,
    total: bugTotByPrio[priority] || 0,
  })).filter((p) => p.total > 0 || p.open > 0);

  const ownerMap: Record<string, number> = {};
  openBugs.forEach((b) => { ownerMap[b.assignee] = (ownerMap[b.assignee] || 0) + 1; });
  const byOwner = Object.entries(ownerMap)
    .map(([name, open]) => ({ name, open }))
    .sort((a, b) => b.open - a.open);

  let uatPayload: DashboardPayload['uat'] = null;
  if (uat.length > 0) {
    const total = uat.length;
    const closed = uat.filter((r) => !r.open).length;
    const open = total - closed;
    const stCounts: Record<string, number> = {};
    const prCounts: Record<string, number> = {};
    const areaCounts: Record<string, number> = {};
    const submitterCounts: Record<string, number> = {};
    const crCounts: Record<string, { total: number; open: number }> = {};
    const areaDetail: Record<string, { total: number; open: number }> = {};
    const openStCounts: Record<string, number> = {};
    uat.forEach((r) => {
      stCounts[r.status] = (stCounts[r.status] || 0) + 1;
      prCounts[r.priority] = (prCounts[r.priority] || 0) + 1;
      areaCounts[r.area] = (areaCounts[r.area] || 0) + 1;
      submitterCounts[r.submitter] = (submitterCounts[r.submitter] || 0) + 1;
      if (!crCounts[r.cr]) crCounts[r.cr] = { total: 0, open: 0 };
      crCounts[r.cr].total += 1;
      if (r.open) crCounts[r.cr].open += 1;
      if (!areaDetail[r.area]) areaDetail[r.area] = { total: 0, open: 0 };
      areaDetail[r.area].total += 1;
      if (r.open) areaDetail[r.area].open += 1;
      if (r.open) openStCounts[r.status] = (openStCounts[r.status] || 0) + 1;
    });
    uatPayload = {
      total,
      open,
      closed,
      closureRate: total ? Math.round((closed / total) * 100) : 0,
      urgentOpen: uat.filter((r) => r.open && r.priority === 'Urgent').length,
      byStatus: Object.entries(stCounts).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      byPriority: Object.entries(prCounts).map(([priority, count]) => ({ priority, count })).sort((a, b) => b.count - a.count),
      byArea: Object.entries(areaCounts).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      bySubmitter: Object.entries(submitterCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byCr: Object.entries(crCounts)
        .map(([cr, v]) => ({ cr, total: v.total, open: v.open, closed: v.total - v.open }))
        .sort((a, b) => b.total - a.total),
      byAreaDetail: Object.entries(areaDetail)
        .map(([area, v]) => ({ area, total: v.total, open: v.open, closed: v.total - v.open }))
        .sort((a, b) => b.total - a.total),
      openByStatus: Object.entries(openStCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      rows: uat.map((r) => ({
        id: r.id,
        subject: r.subject,
        area: r.area,
        priority: r.priority,
        status: r.status,
        submitter: r.submitter,
        submittedAt: r.submittedAt || '',
        updatedAt: r.updatedAt,
        cr: r.cr,
        project: r.project,
      })),
    };
  }

  return {
    scope: {
      startDate: params.startDate,
      endDate: params.endDate,
      search: params.search || '',
      result: params.result || 'all',
      project: params.project || 'all',
      projects,
    },
    overview: {
      totalCases: execTotals.total,
      executed: execTotals.exec,
      passRate: execTotals.exec ? Math.round((execTotals.pass / execTotals.exec) * 100) : 0,
      failed: execTotals.fail,
      blocked: execTotals.blocked,
      resultMix,
      byMonth,
      chartSeries,
    },
    testers,
    cycles,
    cyclesByPassPctAsc,
    storyBug,
    traceability,
    defectBacklog: {
      openTotal: openBugs.length,
      byPriority,
      topPriorities: byPriority.slice(0, 6),
      byOwner,
    },
    uat: uatPayload,
    files: dataset.files,
    meta: {
      generatedAt: new Date().toISOString(),
      parsedAt: dataset.meta.parsedAt,
      fetchedAt: dataset.meta.fetchedAt,
      warnings: dataset.meta.warnings,
      dataMin: filtered.dataMin,
      dataMax: filtered.dataMax,
    },
  };
}
