import type { DashboardPayload, Dataset, FilterParams, ReportType } from '../types/dataset';
import { applyFilters } from '../filters/applyFilters';
import { buildDashboardPayload } from '../export/buildDashboardPayload';

export const AI_TOOLS = [
  { name: 'get_result_mix', description: 'Result distribution (PASS/FAIL/BLOCKED/NE/NA) for filtered executions' },
  { name: 'get_tester_stats', description: 'Per-tester execution stats for the filtered date range' },
  { name: 'get_cycle_health', description: 'Test cycle pass rates and coverage for filtered executions' },
  { name: 'get_story_bug_split', description: 'Story vs Bug counts (open/done) for filtered JIRA issues' },
  { name: 'get_defect_backlog', description: 'Open bugs by priority and assignee' },
  { name: 'get_traceability', description: 'Feature area traceability matrix (stories, bugs, completion)' },
  { name: 'get_uat_summary', description: 'Vendor Portal bugs: totals, open/closed, reported phase/environment, CR, area, submitter, status, and priority' },
] as const;

export type ToolName = typeof AI_TOOLS[number]['name'];

export function executeTool(name: string, dataset: Dataset, filter: FilterParams): unknown {
  const payload = buildDashboardPayload(dataset, filter);
  switch (name) {
    case 'get_result_mix':
      return payload.overview.resultMix;
    case 'get_tester_stats':
      return payload.testers;
    case 'get_cycle_health':
      return payload.cycles;
    case 'get_story_bug_split':
      return payload.storyBug;
    case 'get_defect_backlog':
      return payload.defectBacklog;
    case 'get_traceability':
      return payload.traceability;
    case 'get_uat_summary':
      return payload.uat ?? { total: 0, open: 0, closed: 0, message: 'No Vendor Portal bugs in scope for this date range' };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export function getFilteredSlice(dataset: Dataset, filter: FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filter);
}

export function summarizeForPrompt(payload: DashboardPayload): string {
  return JSON.stringify({
    scope: payload.scope,
    overview: payload.overview,
    storyBug: payload.storyBug,
    uat: payload.uat ? { total: payload.uat.total, open: payload.uat.open, closed: payload.uat.closed } : null,
    testerCount: payload.testers.length,
    cycleCount: payload.cycles.length,
  });
}
