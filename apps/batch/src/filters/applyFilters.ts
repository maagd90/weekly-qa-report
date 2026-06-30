import type { Dataset, ExecutionRow, FilterParams, IssueRow, UatRow } from '../types/dataset';

function inRange(date: string | null | undefined, start: string, end: string): boolean {
  if (!date) return false;
  return date >= start && date <= end;
}

function isAllDates(start?: string, end?: string, dataMin?: string | null, dataMax?: string | null): boolean {
  if (!start || !end || !dataMin || !dataMax) return !start && !end;
  return start <= dataMin && end >= dataMax;
}

function dataDateBounds(dataset: Dataset): { min: string | null; max: string | null } {
  const dates: string[] = [];
  for (const e of dataset.executions) {
    if (e.executedAt) dates.push(e.executedAt);
    if (e.updatedAt) dates.push(e.updatedAt);
  }
  for (const i of dataset.issues) {
    dates.push(i.createdAt, i.updatedAt);
    if (i.resolvedAt) dates.push(i.resolvedAt);
  }
  for (const u of dataset.uat) {
    dates.push(u.submittedAt, u.updatedAt);
  }
  if (!dates.length) return { min: null, max: null };
  dates.sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

function filterByProject<T extends { project: string }>(rows: T[], project?: string): T[] {
  if (!project || project === 'all') return rows;
  return rows.filter((r) => r.project === project);
}

function filterExecutions(rows: ExecutionRow[], filter: FilterParams, allDates: boolean): ExecutionRow[] {
  let out = rows;
  if (!allDates && filter.startDate && filter.endDate) {
    out = out.filter((r) =>
      inRange(r.executedAt, filter.startDate!, filter.endDate!) ||
      inRange(r.updatedAt, filter.startDate!, filter.endDate!)
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

function filterIssues(rows: IssueRow[], filter: FilterParams, allDates: boolean): IssueRow[] {
  let out = rows;
  if (!allDates && filter.startDate && filter.endDate) {
    const { startDate, endDate } = filter;
    out = out.filter((r) =>
      inRange(r.updatedAt, startDate, endDate) ||
      (r.resolvedAt ? inRange(r.resolvedAt, startDate, endDate) : false) ||
      (r.status === 'open' && r.createdAt <= endDate)
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

function filterUat(rows: UatRow[], filter: FilterParams, allDates: boolean): UatRow[] {
  let out = rows;
  if (!allDates && filter.startDate && filter.endDate) {
    out = out.filter((r) =>
      inRange(r.submittedAt, filter.startDate!, filter.endDate!) ||
      inRange(r.updatedAt, filter.startDate!, filter.endDate!)
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
  const allDates = isAllDates(filter.startDate, filter.endDate, bounds.min, bounds.max);

  let executions = filterByProject(dataset.executions, filter.project);
  let issues = filterByProject(dataset.issues, filter.project);
  let uat = dataset.uat;

  executions = filterExecutions(executions, filter, allDates);
  issues = filterIssues(issues, filter, allDates);
  uat = filterUat(uat, filter, allDates);

  return { executions, issues, uat, dataMin: bounds.min, dataMax: bounds.max, allDates };
}

export { dataDateBounds };
