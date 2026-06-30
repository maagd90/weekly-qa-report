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
  const A = cycleAgg(executions);

  const resultDefs = [
    { code: 'PASS', label: 'Passed', key: 'pass' as const },
    { code: 'NE', label: 'Not Executed', key: 'ne' as const },
    { code: 'BLOCKED', label: 'Blocked', key: 'blocked' as const },
    { code: 'FAIL', label: 'Failed', key: 'fail' as const },
    { code: 'NA', label: 'Not Applicable', key: 'na' as const },
  ];
  const dTot = A.total || 1;
  const resultMix = resultDefs.map((d) => ({
    code: d.code,
    label: d.label,
    count: A[d.key],
    pct: Math.round((A[d.key] / dTot) * 100),
    color: resultColor(d.code),
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
      const b = monthBuckets[ym];
      const mi = parseInt(ym.slice(5, 7), 10) - 1;
      return {
        ym,
        label: `${MLAB[mi]} '${ym.slice(2, 4)}`,
        pass: b.pass,
        blocked: b.blocked,
        fail: b.fail,
      };
    })
    .filter((m) => m.pass + m.blocked + m.fail > 0);

  const testerNames = [...new Set(executions.map((r) => r.tester).filter(Boolean))] as string[];
  const testers = testerNames.map((name) => {
    const tr = executions.filter((r) => r.tester === name);
    const pass = tr.filter((r) => r.result === 'PASS').length;
    const fail = tr.filter((r) => r.result === 'FAIL').length;
    const blocked = tr.filter((r) => r.result === 'BLOCKED').length;
    const na = tr.filter((r) => r.result === 'NA').length;
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
    const cr = executions.filter((r) => r.cycleKey === key);
    const a = cycleAgg(cr);
    return {
      key,
      name: cr[0]?.cycleName || key,
      total: a.total,
      pass: a.pass,
      fail: a.fail,
      blocked: a.blocked,
      ne: a.ne,
      na: a.na,
      passPct: a.pr,
      coverage: a.cov,
      status: cycleStatus(a),
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
    uat.forEach((r) => {
      stCounts[r.status] = (stCounts[r.status] || 0) + 1;
      prCounts[r.priority] = (prCounts[r.priority] || 0) + 1;
      areaCounts[r.area] = (areaCounts[r.area] || 0) + 1;
      submitterCounts[r.submitter] = (submitterCounts[r.submitter] || 0) + 1;
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
      rows: uat.map((r) => ({
        id: r.id,
        subject: r.subject,
        area: r.area,
        priority: r.priority,
        status: r.status,
        submitter: r.submitter,
        submittedAt: r.submittedAt,
        updatedAt: r.updatedAt,
        cr: r.cr,
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
      totalCases: A.total,
      executed: A.exec,
      passRate: A.exec ? Math.round((A.pass / A.exec) * 100) : 0,
      failed: A.fail,
      blocked: A.blocked,
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
