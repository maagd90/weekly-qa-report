import type { DashboardPayload, Dataset } from '../types/dataset';
import { canonicalProjectKey } from '../projects/projectKey';

export function hasDashboardMetrics(payload?: DashboardPayload | null): boolean {
  if (!payload) return false;
  return Boolean(
    payload.overview.totalCases ||
    payload.overview.executed ||
    payload.storyBug.story ||
    payload.storyBug.bug ||
    payload.defectBacklog.openTotal ||
    payload.cycles.length ||
    payload.testers.length ||
    payload.uat?.total
  );
}

function projectRows(dataset: Dataset): Array<{ project: string; rows: number }> {
  const counts = new Map<string, number>();
  const add = (project?: string, rows = 1) => {
    const key = canonicalProjectKey(project || 'UNKNOWN') || 'UNKNOWN';
    counts.set(key, (counts.get(key) || 0) + rows);
  };
  for (const row of dataset.executions) add(row.project);
  for (const row of dataset.issues) add(row.project);
  for (const row of dataset.uat) add(row.project);
  return [...counts.entries()].map(([project, rows]) => ({ project, rows })).sort((a, b) => a.project.localeCompare(b.project));
}

export function datasetProjectsSummary(dataset: Dataset): string {
  const rows = projectRows(dataset);
  if (!rows.length) return 'no projects / 0 rows';
  return rows.map((p) => `${p.project} (${p.rows} rows)`).join(', ');
}

export function noMetricsForScopeMessage(args: { project?: string; startDate?: string; endDate?: string; dataset: Dataset }): string {
  const requestedProject = args.project ? canonicalProjectKey(args.project) : 'all projects';
  const start = args.startDate || 'any';
  const end = args.endDate || 'any';
  return `No metrics found for ${requestedProject} in ${start}..${end}. AI narrative was skipped. Dataset contains: ${datasetProjectsSummary(args.dataset)}.`;
}
