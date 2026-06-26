import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { Dataset } from '../types/dataset';
import { filterWeeklyLog, filterProjectStatus, weeksOverlappingRange } from '../filters/dateFilters';

export interface ToolInput {
  startDate?: string;
  endDate?: string;
  year?: number;
  weekNumber?: number;
  projectId?: string;
  metric?: string;
}

function wlFilter(ds: Dataset, input: ToolInput) {
  return filterWeeklyLog(ds.weeklyLog, {
    year: input.year,
    week: input.weekNumber,
    startDate: input.startDate,
    endDate: input.endDate,
  });
}

function psFilter(ds: Dataset, input: ToolInput) {
  return filterProjectStatus(ds.projectStatusWeekly, {
    year: input.year,
    week: input.weekNumber,
    startDate: input.startDate,
    endDate: input.endDate,
  });
}

function resourceMap(ds: Dataset) {
  return new Map(ds.resources.map((r) => [r.resource_id, r]));
}

function crMap(ds: Dataset) {
  return new Map(ds.crs.map((c) => [c.cr_id, c]));
}

function projectMap(ds: Dataset) {
  return new Map(ds.projects.map((p) => [p.project_id, p]));
}

export function executeTool(name: string, input: ToolInput, dataset: Dataset): unknown {
  const wl = wlFilter(dataset, input);
  const ps = psFilter(dataset, input);
  const resources = resourceMap(dataset);
  const crs = crMap(dataset);
  const projects = projectMap(dataset);

  switch (name) {
    case 'get_resource_summary': {
      let testsPlanned = 0, testsExecuted = 0, testsPassed = 0, testsFailed = 0;
      let bugsReported = 0, bugsClosed = 0, totalHours = 0;
      const resIds = new Set<string>();
      const crIds = new Set<string>();
      for (const r of wl) {
        testsPlanned += r.tc_planned;
        testsExecuted += r.tc_executed;
        testsPassed += r.tc_passed;
        testsFailed += r.tc_failed;
        bugsReported += r.bugs_reported;
        bugsClosed += r.bugs_closed;
        totalHours += r.hours_spent;
        resIds.add(r.resource_id);
        crIds.add(r.cr_id);
      }
      return { testsPlanned, testsExecuted, testsPassed, testsFailed, bugsReported, bugsClosed, totalHours, activeResources: resIds.size, activeCRs: crIds.size };
    }

    case 'get_resource_breakdown': {
      const byRes = new Map<string, { testsExecuted: number; testsPassed: number; testsFailed: number; bugsReported: number; bugsClosed: number; hoursSpent: number; crs: Set<string> }>();
      for (const row of wl) {
        const cr = crs.get(row.cr_id);
        if (input.projectId && cr?.project_id !== input.projectId) continue;
        if (!byRes.has(row.resource_id)) {
          byRes.set(row.resource_id, { testsExecuted: 0, testsPassed: 0, testsFailed: 0, bugsReported: 0, bugsClosed: 0, hoursSpent: 0, crs: new Set() });
        }
        const agg = byRes.get(row.resource_id)!;
        agg.testsExecuted += row.tc_executed;
        agg.testsPassed += row.tc_passed;
        agg.testsFailed += row.tc_failed;
        agg.bugsReported += row.bugs_reported;
        agg.bugsClosed += row.bugs_closed;
        agg.hoursSpent += row.hours_spent;
        agg.crs.add(row.cr_id);
      }
      return [...byRes.entries()].map(([id, agg]) => {
        const r = resources.get(id);
        return {
          resource_name: r?.resource_name || id,
          team: r?.team || '',
          role: r?.role || '',
          ...agg,
          assignedCRs: [...agg.crs].join(', '),
        };
      }).sort((a, b) => b.testsExecuted - a.testsExecuted);
    }

    case 'get_project_status':
      return ps
        .filter((row) => !input.projectId || row.project_id === input.projectId)
        .map((row) => ({
          project_name: projects.get(row.project_id)?.project_name || row.project_id,
          ...row,
        }))
        .sort((a, b) => (projects.get(a.project_id)?.project_name || '').localeCompare(projects.get(b.project_id)?.project_name || ''));

    case 'get_cr_assignments': {
      const byKey = new Map<string, { resource_name: string; cr_id: string; testsExecuted: number; bugsReported: number; hoursSpent: number }>();
      for (const row of wl) {
        const cr = crs.get(row.cr_id);
        if (input.projectId && cr?.project_id !== input.projectId) continue;
        const key = `${row.resource_id}|${row.cr_id}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            resource_name: resources.get(row.resource_id)?.resource_name || row.resource_id,
            cr_id: row.cr_id,
            testsExecuted: 0,
            bugsReported: 0,
            hoursSpent: 0,
          });
        }
        const agg = byKey.get(key)!;
        agg.testsExecuted += row.tc_executed;
        agg.bugsReported += row.bugs_reported;
        agg.hoursSpent += row.hours_spent;
      }
      return [...byKey.values()].map((agg) => ({
        ...agg,
        cr_title: crs.get(agg.cr_id)?.cr_title || '',
        priority: crs.get(agg.cr_id)?.priority || '',
        cr_status: crs.get(agg.cr_id)?.status || '',
        project_name: projects.get(crs.get(agg.cr_id)?.project_id || '')?.project_name || '',
      }));
    }

    case 'get_bug_trend': {
      const overlap = input.startDate && input.endDate ? weeksOverlappingRange(input.startDate, input.endDate) : null;
      const yearFilter = overlap?.year ?? input.year ?? new Date().getFullYear();
      const byWeek = new Map<number, { bugsReported: number; bugsClosed: number; bugsOpen: number }>();
      for (const row of dataset.projectStatusWeekly.filter((r) => r.year === yearFilter)) {
        if (!byWeek.has(row.week_number)) byWeek.set(row.week_number, { bugsReported: 0, bugsClosed: 0, bugsOpen: 0 });
        const w = byWeek.get(row.week_number)!;
        w.bugsReported += row.bugs_reported;
        w.bugsClosed += row.bugs_closed;
        w.bugsOpen += row.bugs_open;
      }
      return [...byWeek.entries()].map(([week_number, v]) => ({ year: yearFilter, week_number, ...v })).sort((a, b) => a.week_number - b.week_number);
    }

    case 'get_test_execution_trend': {
      const yearFilter = input.year ?? new Date().getFullYear();
      const byWeek = new Map<number, { testsExecuted: number; testsPassed: number; testsFailed: number }>();
      for (const row of dataset.weeklyLog.filter((r) => r.year === yearFilter)) {
        if (!byWeek.has(row.week_number)) byWeek.set(row.week_number, { testsExecuted: 0, testsPassed: 0, testsFailed: 0 });
        const w = byWeek.get(row.week_number)!;
        w.testsExecuted += row.tc_executed;
        w.testsPassed += row.tc_passed;
        w.testsFailed += row.tc_failed;
      }
      return [...byWeek.entries()].map(([week_number, v]) => ({ week_number, ...v })).sort((a, b) => a.week_number - b.week_number);
    }

    case 'get_top_performers': {
      const byRes = new Map<string, { testsExecuted: number; bugsReported: number; bugsClosed: number; hoursSpent: number }>();
      for (const row of wl) {
        if (!byRes.has(row.resource_id)) byRes.set(row.resource_id, { testsExecuted: 0, bugsReported: 0, bugsClosed: 0, hoursSpent: 0 });
        const agg = byRes.get(row.resource_id)!;
        agg.testsExecuted += row.tc_executed;
        agg.bugsReported += row.bugs_reported;
        agg.bugsClosed += row.bugs_closed;
        agg.hoursSpent += row.hours_spent;
      }
      const list = [...byRes.entries()].map(([id, agg]) => ({
        resource_name: resources.get(id)?.resource_name || id,
        team: resources.get(id)?.team || '',
        ...agg,
      }));
      const sortKey = input.metric === 'bugs' ? 'bugsClosed' : 'testsExecuted';
      return list.sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 10);
    }

    case 'get_risk_summary':
      return ps
        .filter((row) => (!input.projectId || row.project_id === input.projectId) && (row.risks || row.blockers))
        .map((row) => ({
          project_name: projects.get(row.project_id)?.project_name || row.project_id,
          project_id: row.project_id,
          status: row.status,
          percent_complete: row.percent_complete,
          risks: row.risks,
          blockers: row.blockers,
          week_number: row.week_number,
          year: row.year,
        }))
        .sort((a, b) => b.week_number - a.week_number);

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export const AI_TOOLS: Tool[] = [
  { name: 'get_resource_summary', description: 'Aggregate resource totals for the period.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' } } } },
  { name: 'get_resource_breakdown', description: 'Per-resource metrics.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' }, projectId: { type: 'string' } } } },
  { name: 'get_project_status', description: 'Project status reports.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' }, projectId: { type: 'string' } } } },
  { name: 'get_cr_assignments', description: 'Resource CR assignments.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' }, projectId: { type: 'string' } } } },
  { name: 'get_bug_trend', description: 'Weekly bug trends.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' } } } },
  { name: 'get_test_execution_trend', description: 'Weekly test execution trends.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' } } } },
  { name: 'get_top_performers', description: 'Top performers by tests or bugs closed.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' }, metric: { type: 'string', enum: ['tests', 'bugs'] } } } },
  { name: 'get_risk_summary', description: 'Projects with risks or blockers.', input_schema: { type: 'object' as const, properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, year: { type: 'number' }, weekNumber: { type: 'number' }, projectId: { type: 'string' } } } },
];
