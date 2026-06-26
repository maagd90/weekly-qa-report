import type { FilterParams } from './api';

export interface Resource {
  resource_id: string;
  resource_name: string;
  team: string;
  role: string;
  active: string;
}

export interface Project {
  project_id: string;
  project_name: string;
  project_manager: string;
  start_date: string;
  target_end_date: string;
  overall_status: string;
  active: string;
}

export interface CR {
  cr_id: string;
  project_id: string;
  cr_title: string;
  priority: string;
  status: string;
  owner: string;
}

export interface WeeklyLogRow {
  year: number;
  week_number: number;
  week_start: string;
  week_end: string;
  resource_id: string;
  cr_id: string;
  tc_planned: number;
  tc_executed: number;
  tc_passed: number;
  tc_failed: number;
  bugs_reported: number;
  bugs_closed: number;
  hours_spent: number;
  notes: string;
}

export interface ProjectStatusRow {
  year: number;
  week_number: number;
  project_id: string;
  status: string;
  percent_complete: number;
  tests_executed: number;
  bugs_open: number;
  bugs_reported: number;
  bugs_closed: number;
  resources_assigned: number;
  key_accomplishments: string;
  risks: string;
  blockers: string;
  next_week_plan: string;
  reported_by: string;
}

export interface DashboardPayload {
  meta: {
    parsedAt: string;
    generatedAt: string;
    sourceFiles: string[];
    formats: string[];
    warnings: string[];
    generateParams: { startDate: string; endDate: string; reportType: string };
    years: number[];
    weeks: { year: number; week_number: number; week_start: string | null; week_end: string | null }[];
    dateRange: { minDate: string | null; maxDate: string | null };
  };
  resources: Resource[];
  projects: Project[];
  crs: CR[];
  weeklyLog: WeeklyLogRow[];
  projectStatusWeekly: ProjectStatusRow[];
}

function filterWeeklyLog(rows: WeeklyLogRow[], filter: FilterParams): WeeklyLogRow[] {
  if ('startDate' in filter && filter.startDate && filter.endDate) {
    return rows.filter((r) => r.week_start && r.week_end && r.week_start <= filter.endDate && r.week_end >= filter.startDate);
  }
  if ('year' in filter && filter.year !== undefined && filter.week !== undefined) {
    return rows.filter((r) => r.year === filter.year && r.week_number === filter.week);
  }
  return rows;
}

function filterProjectStatus(rows: ProjectStatusRow[], filter: FilterParams): ProjectStatusRow[] {
  if ('startDate' in filter && filter.startDate && filter.endDate) {
    const start = new Date(filter.startDate);
    const endDate = filter.endDate;
    const year = start.getFullYear();
    const weeks: number[] = [];
    for (let w = 1; w <= 53; w++) {
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const dow = jan4.getUTCDay() || 7;
      const mon = new Date(jan4);
      mon.setUTCDate(jan4.getUTCDate() - (dow - 1) + (w - 1) * 7);
      const sun = new Date(mon);
      sun.setUTCDate(mon.getUTCDate() + 6);
      if (mon <= new Date(endDate) && sun >= new Date(filter.startDate)) weeks.push(w);
      if (mon > new Date(endDate)) break;
    }
    return rows.filter((r) => r.year === year && weeks.includes(r.week_number));
  }
  if ('year' in filter && filter.year !== undefined && filter.week !== undefined) {
    return rows.filter((r) => r.year === filter.year && r.week_number === filter.week);
  }
  return rows;
}

const resourceMap = (d: DashboardPayload) => new Map(d.resources.map((r) => [r.resource_id, r]));
const crMap = (d: DashboardPayload) => new Map(d.crs.map((c) => [c.cr_id, c]));
const projectMap = (d: DashboardPayload) => new Map(d.projects.map((p) => [p.project_id, p]));

export function computeResourceSummary(d: DashboardPayload, filter: FilterParams) {
  const wl = filterWeeklyLog(d.weeklyLog, filter);
  let testsExecuted = 0, testsPassed = 0, testsFailed = 0, bugsReported = 0, bugsClosed = 0;
  const resIds = new Set<string>();
  for (const r of wl) {
    testsExecuted += r.tc_executed;
    testsPassed += r.tc_passed;
    testsFailed += r.tc_failed;
    bugsReported += r.bugs_reported;
    bugsClosed += r.bugs_closed;
    resIds.add(r.resource_id);
  }
  return {
    testsExecuted,
    testsPassed,
    testsFailed,
    bugsReported,
    bugsClosed,
    activeResources: resIds.size,
    bugClosureRate: bugsReported > 0 ? Math.round((bugsClosed / bugsReported) * 100) : 0,
  };
}

export function computeCrAssignments(d: DashboardPayload, filter: FilterParams) {
  const wl = filterWeeklyLog(d.weeklyLog, filter);
  const resources = resourceMap(d);
  const crs = crMap(d);
  const projects = projectMap(d);
  const byKey = new Map<string, Record<string, unknown>>();

  for (const row of wl) {
    const key = `${row.resource_id}|${row.cr_id}`;
    if (!byKey.has(key)) {
      const res = resources.get(row.resource_id);
      const cr = crs.get(row.cr_id);
      byKey.set(key, {
        resource_id: row.resource_id,
        resource_name: res?.resource_name || row.resource_id,
        team: res?.team || '',
        cr_id: row.cr_id,
        cr_title: cr?.cr_title || '',
        project_id: cr?.project_id || '',
        project_name: projects.get(cr?.project_id || '')?.project_name || '',
        tc_executed: 0,
        tc_passed: 0,
        tc_failed: 0,
        bugs_reported: 0,
        bugs_closed: 0,
        hours_spent: 0,
      });
    }
    const agg = byKey.get(key)!;
    agg.tc_executed = (agg.tc_executed as number) + row.tc_executed;
    agg.tc_passed = (agg.tc_passed as number) + row.tc_passed;
    agg.tc_failed = (agg.tc_failed as number) + row.tc_failed;
    agg.bugs_reported = (agg.bugs_reported as number) + row.bugs_reported;
    agg.bugs_closed = (agg.bugs_closed as number) + row.bugs_closed;
    agg.hours_spent = (agg.hours_spent as number) + row.hours_spent;
  }
  return [...byKey.values()];
}

export function computeExecutionByResource(d: DashboardPayload, filter: FilterParams) {
  const wl = filterWeeklyLog(d.weeklyLog, filter);
  const resources = resourceMap(d);
  const byRes = new Map<string, { resource_name: string; planned: number; executed: number; passed: number; failed: number }>();
  for (const row of wl) {
    if (!byRes.has(row.resource_id)) {
      byRes.set(row.resource_id, {
        resource_name: resources.get(row.resource_id)?.resource_name || row.resource_id,
        planned: 0, executed: 0, passed: 0, failed: 0,
      });
    }
    const a = byRes.get(row.resource_id)!;
    a.planned += row.tc_planned;
    a.executed += row.tc_executed;
    a.passed += row.tc_passed;
    a.failed += row.tc_failed;
  }
  return [...byRes.values()].sort((a, b) => b.executed - a.executed);
}

export function computeBugsByResource(d: DashboardPayload, filter: FilterParams) {
  const wl = filterWeeklyLog(d.weeklyLog, filter);
  const resources = resourceMap(d);
  const byRes = new Map<string, { resource_name: string; reported: number; closed: number }>();
  for (const row of wl) {
    if (!byRes.has(row.resource_id)) {
      byRes.set(row.resource_id, { resource_name: resources.get(row.resource_id)?.resource_name || row.resource_id, reported: 0, closed: 0 });
    }
    const a = byRes.get(row.resource_id)!;
    a.reported += row.bugs_reported;
    a.closed += row.bugs_closed;
  }
  return [...byRes.values()];
}

export function computeWeeklyTrends(d: DashboardPayload, year: number) {
  const byWeek = new Map<number, { week: number; testsExecuted: number; bugsReported: number; bugsClosed: number; activeResources: number }>();
  for (const row of d.weeklyLog.filter((r) => r.year === year)) {
    if (!byWeek.has(row.week_number)) byWeek.set(row.week_number, { week: row.week_number, testsExecuted: 0, bugsReported: 0, bugsClosed: 0, activeResources: 0 });
    const w = byWeek.get(row.week_number)!;
    w.testsExecuted += row.tc_executed;
    w.bugsReported += row.bugs_reported;
    w.bugsClosed += row.bugs_closed;
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

export function computeProjectSummary(d: DashboardPayload, filter: FilterParams) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter);
  let onTrack = 0, atRisk = 0, delayed = 0, completed = 0, totalPct = 0, totalBugsOpen = 0;
  for (const row of ps) {
    if (row.status === 'On Track') onTrack++;
    else if (row.status === 'At Risk') atRisk++;
    else if (row.status === 'Delayed') delayed++;
    else if (row.status === 'Completed') completed++;
    totalPct += row.percent_complete;
    totalBugsOpen += row.bugs_open;
  }
  const n = ps.length || 1;
  return {
    totalProjects: ps.length,
    onTrack,
    atRisk,
    delayed,
    completed,
    avgCompletion: ps.length ? totalPct / ps.length : 0,
    totalBugsOpen,
  };
}

export function computeStatusReport(d: DashboardPayload, filter: FilterParams) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter);
  const projects = projectMap(d);
  return ps.map((row) => ({
    ...row,
    project_name: projects.get(row.project_id)?.project_name || row.project_id,
    project_manager: projects.get(row.project_id)?.project_manager || '',
    target_end_date: projects.get(row.project_id)?.target_end_date || '',
  }));
}

export function computeStatusDistribution(d: DashboardPayload, filter: FilterParams) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter);
  const counts = new Map<string, number>();
  for (const row of ps) counts.set(row.status, (counts.get(row.status) || 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

export function computeCompletionByProject(d: DashboardPayload, filter: FilterParams) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter);
  const projects = projectMap(d);
  const byProject = new Map<string, { project_id: string; project_name: string; percent_complete: number; status: string }>();
  for (const row of ps) {
    const existing = byProject.get(row.project_id);
    if (!existing || row.percent_complete > existing.percent_complete) {
      byProject.set(row.project_id, {
        project_id: row.project_id,
        project_name: projects.get(row.project_id)?.project_name || row.project_id,
        percent_complete: row.percent_complete,
        status: row.status,
      });
    }
  }
  return [...byProject.values()].sort((a, b) => b.percent_complete - a.percent_complete);
}

export function computeBugsByProject(d: DashboardPayload, filter: FilterParams) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter);
  const projects = projectMap(d);
  const byProject = new Map<string, { project_id: string; project_name: string; reported: number; closed: number; open: number }>();
  for (const row of ps) {
    if (!byProject.has(row.project_id)) {
      byProject.set(row.project_id, {
        project_id: row.project_id,
        project_name: projects.get(row.project_id)?.project_name || row.project_id,
        reported: 0, closed: 0, open: 0,
      });
    }
    const a = byProject.get(row.project_id)!;
    a.reported += row.bugs_reported;
    a.closed += row.bugs_closed;
    a.open = Math.max(a.open, row.bugs_open);
  }
  return [...byProject.values()];
}

export function computeCompletionTrends(d: DashboardPayload, year: number) {
  const projects = projectMap(d);
  return d.projectStatusWeekly
    .filter((r) => r.year === year)
    .map((row) => ({
      week: row.week_number,
      project_id: row.project_id,
      project_name: projects.get(row.project_id)?.project_name || row.project_id,
      percent_complete: row.percent_complete,
      status: row.status,
    }));
}

export function computeProjectDetail(d: DashboardPayload, filter: FilterParams, projectId: string) {
  const ps = filterProjectStatus(d.projectStatusWeekly, filter).filter((r) => r.project_id === projectId);
  const status = ps.sort((a, b) => b.week_number - a.week_number)[0];
  if (!status) return null;
  const wl = d.weeklyLog.filter((r) => r.year === status.year && r.week_number === status.week_number);
  const crs = d.crs.filter((c) => c.project_id === projectId);
  const crIds = new Set(crs.map((c) => c.cr_id));
  const resourceIds = new Set(wl.filter((w) => crIds.has(w.cr_id)).map((w) => w.resource_id));
  const resources = d.resources
    .filter((r) => resourceIds.has(r.resource_id))
    .map((r) => {
      const rows = wl.filter((w) => w.resource_id === r.resource_id && crIds.has(w.cr_id));
      return {
        ...r,
        testsExecuted: rows.reduce((s, x) => s + x.tc_executed, 0),
        bugsReported: rows.reduce((s, x) => s + x.bugs_reported, 0),
        hoursSpent: rows.reduce((s, x) => s + x.hours_spent, 0),
      };
    });
  const project = projectMap(d).get(projectId);
  return {
    status: { ...status, project_name: project?.project_name, project_manager: project?.project_manager, start_date: project?.start_date, target_end_date: project?.target_end_date },
    crs,
    resources,
    prevStatus: null,
  };
}
