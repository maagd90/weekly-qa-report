import type { Dataset, ExecutionRow, FilterParams, IssueRow, UatRow } from '../types/dataset';
import { canonicalProjectKey } from '../projects/projectKey';

interface DateWindow {
  start?: string;
  end?: string;
  allDates: boolean;
}

function inRange(date: string | null | undefined, start: string, end: string): boolean {
  if (!date) return false;
  return date >= start && date <= end;
}

function dataDateBounds(dataset: Dataset): { min: string | null; max: string | null } {
  const dates: string[] = [];
  for (const e of dataset.executions) {
    if (e.executedAt) dates.push(e.executedAt);
    if (e.updatedAt) dates.push(e.updatedAt);
  }
  for (const i of dataset.issues) {
    if (i.createdAt) dates.push(i.createdAt);
    if (i.updatedAt) dates.push(i.updatedAt);
    if (i.resolvedAt) dates.push(i.resolvedAt);
  }
  for (const u of dataset.uat) {
    if (u.submittedAt) dates.push(u.submittedAt);
    if (u.updatedAt) dates.push(u.updatedAt);
  }
  if (!dates.length) return { min: null, max: null };
  dates.sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

function dateWindow(filter: FilterParams, bounds: { min: string | null; max: string | null }): DateWindow {
  const hasStart = Boolean(filter.startDate);
  const hasEnd = Boolean(filter.endDate);
  if (!hasStart && !hasEnd) return { allDates: true };

  const start = filter.startDate || bounds.min || undefined;
  const end = filter.endDate || bounds.max || undefined;
  const allDates = Boolean(start && end && bounds.min && bounds.max && start <= bounds.min && end >= bounds.max);
  return { start, end, allDates };
}

function filterByProject<T extends { project: string }>(rows: T[], project?: string): T[] {
  const selected = canonicalProjectKey(project);
  if (!selected || selected === 'all') return rows;
  return rows.filter((r) => canonicalProjectKey(r.project) === selected);
}

function filterExecutions(rows: ExecutionRow[], filter: FilterParams, window: DateWindow): ExecutionRow[] {
  let out = rows;
  if (!window.allDates && window.start && window.end) {
    out = out.filter((r) =>
      inRange(r.executedAt, window.start!, window.end!) ||
      inRange(r.updatedAt, window.start!, window.end!)
    );
  }
  const q = (filter.search || '').trim().toLowerCase();
  if (q) {
    out = out.filter((r) =>
      `${r.cycleName} ${r.cycleKey} ${r.tester || ''} ${r.caseKey}`.toLowerCase().includes(q)
    );
  }
  if (filter.result && filter.result !== 'all') {
    out = out.filter((r) => r.result === filter.result);
  }
  return out;
}

function filterIssues(rows: IssueRow[], filter: FilterParams, window: DateWindow): IssueRow[] {
  let out = rows;
  if (!window.allDates && window.start && window.end) {
    const { start, end } = window;
    out = out.filter((r) =>
      inRange(r.updatedAt, start!, end!) ||
      (r.resolvedAt ? inRange(r.resolvedAt, start!, end!) : false) ||
      (r.createdAt ? inRange(r.createdAt, start!, end!) : false)
      // A2 (strictly in-period): an issue counts only if it was created, updated, or
      // resolved within [startDate, endDate]. The previous "open && createdAt <= endDate"
      // clause is removed — it ignored startDate and made open-defect counts grow with the
      // end date regardless of the period, which read as "the date filter is broken".
    );
  }
  const q = (filter.search || '').trim().toLowerCase();
  if (q) {
    out = out.filter((r) =>
      `${r.area} ${r.assignee} ${r.key} ${r.issueType} ${r.priority}`.toLowerCase().includes(q)
    );
  }
  return out;
}

function filterUat(rows: UatRow[], filter: FilterParams, window: DateWindow): UatRow[] {
  let out = rows;
  if (!window.allDates && window.start && window.end) {
    out = out.filter((r) =>
      inRange(r.submittedAt, window.start!, window.end!) ||
      inRange(r.updatedAt, window.start!, window.end!)
    );
  }
  const q = (filter.search || '').trim().toLowerCase();
  if (q) {
    out = out.filter((r) =>
      `${r.id} ${r.subject} ${r.area} ${r.submitter} ${r.status} ${r.priority} ${r.cr}`.toLowerCase().includes(q)
    );
  }
  return out;
}

export interface FilteredDataset {
  executions: ExecutionRow[];
  issues: IssueRow[];
  uat: UatRow[];
  dataMin: string | null;
  dataMax: string | null;
  allDates: boolean;
}

export function applyFilters(dataset: Dataset, filter: FilterParams): FilteredDataset {
  const bounds = dataDateBounds(dataset);
  const window = dateWindow(filter, bounds);

  let executions = filterByProject(dataset.executions, filter.project);
  let issues = filterByProject(dataset.issues, filter.project);
  let uat = filterByProject(dataset.uat, filter.project);

  executions = filterExecutions(executions, filter, window);
  issues = filterIssues(issues, filter, window);
  uat = filterUat(uat, filter, window);

  return { executions, issues, uat, dataMin: bounds.min, dataMax: bounds.max, allDates: window.allDates };
}

export { dataDateBounds };