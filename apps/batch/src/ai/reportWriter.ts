import type { Dataset, FilterParams, GenerateParams, ReportType, DashboardPayload } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { buildDashboardPayload } from '../export/buildDashboardPayload';

function projectDisplayName(project?: string): string {
  const key = (project || '').trim().toUpperCase();
  if (!key || key === 'ALL') return 'All Projects';
  if (key === 'DP') return 'WonderMiles';
  if (key === 'DLM') return 'DN4_FT - Supply & DMC';
  if (key === 'DN4_FT') return 'DN4 Flight';
  return project || key;
}

function reportTypeLabel(reportType: ReportType): string {
  if (reportType === 'executive') return 'Executive';
  if (reportType === 'cycles') return 'Cycle Health';
  if (reportType === 'defects' || reportType === 'testers') return 'Defects';
  return 'Full';
}

function pct(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function riskLevel(payload: DashboardPayload): string {
  if (payload.overview.failed || payload.overview.blocked || payload.defectBacklog.openTotal) return 'Attention required';
  if (payload.overview.executed && payload.overview.passRate >= 95) return 'Healthy';
  if (payload.overview.totalCases && !payload.overview.executed) return 'Not started';
  return 'In progress';
}

function topCycleRisk(payload: DashboardPayload): string {
  const cycle = payload.cyclesByPassPctAsc[0];
  if (!cycle) return 'No cycle health data is available for the selected scope.';
  return `${cycle.name} has the lowest pass rate in scope (${cycle.passPct}% pass, ${cycle.coverage}% coverage, ${cycle.total} cases).`;
}

function topDefectRisk(payload: DashboardPayload): string {
  const priority = payload.defectBacklog.topPriorities[0];
  const owner = payload.defectBacklog.byOwner[0];
  if (!payload.defectBacklog.openTotal) return 'No open defect backlog is visible in the selected scope.';
  const priorityText = priority ? `${priority.open} open ${priority.priority} defect(s)` : `${payload.defectBacklog.openTotal} open defect(s)`;
  const ownerText = owner ? `; highest owner backlog: ${owner.name} (${owner.open})` : '';
  return `${priorityText}${ownerText}.`;
}

function buildNarrative(payload: DashboardPayload, reportType: ReportType, filter: FilterParams): string {
  const project = projectDisplayName(filter.project || payload.scope.project);
  const scope = `${filter.startDate || payload.scope.startDate || 'all'} to ${filter.endDate || payload.scope.endDate || 'all'}`;
  const executedPct = pct(payload.overview.executed, payload.overview.totalCases);
  const failedBlocked = payload.overview.failed + payload.overview.blocked;
  const reportLabel = reportTypeLabel(reportType).toLowerCase();
  const lines: string[] = [];

  lines.push(`For ${project}, the ${reportLabel} report covers ${scope}. The selected scope contains ${payload.overview.totalCases} test case(s), ${payload.overview.executed} executed case(s), and an execution coverage of ${executedPct}%. The current pass rate is ${payload.overview.passRate}% with ${payload.overview.failed} failed and ${payload.overview.blocked} blocked case(s).`);

  if (reportType === 'defects' || reportType === 'testers') {
    lines.push(`The defect position shows ${payload.storyBug.bug} bug(s), including ${payload.storyBug.bugDone} closed/done and ${payload.storyBug.bugOpen} still open. ${topDefectRisk(payload)} This report should be used to drive fix ownership, retest priority, and closure follow-up.`);
  } else if (reportType === 'cycles') {
    lines.push(`Cycle health remains the main focus for this report. ${topCycleRisk(payload)} Failed or blocked cases should be reviewed against cycle ownership before sign-off.`);
  } else {
    lines.push(`Overall sprint status is: ${riskLevel(payload)}. ${topDefectRisk(payload)} ${topCycleRisk(payload)}`);
  }

  if (payload.uat?.total) {
    lines.push(`UAT evidence includes ${payload.uat.total} item(s), with ${payload.uat.closed} closed and ${payload.uat.open} open. The UAT closure rate is ${payload.uat.closureRate}%, and ${payload.uat.urgentOpen} urgent open item(s) require continued attention.`);
  } else {
    lines.push('UAT data is not available in the selected scope. If UAT evidence is expected, confirm that the relevant export or live source has been synced for the same date range.');
  }

  const recommendations = [
    failedBlocked > 0 ? `Prioritize retest and closure for ${failedBlocked} failed/blocked execution item(s).` : 'Maintain regression coverage and keep evidence ready for sign-off.',
    payload.defectBacklog.openTotal > 0 ? `Track ${payload.defectBacklog.openTotal} open defect(s) by owner and priority until closure.` : 'Continue monitoring new defects and reopen trends during the next validation window.',
    payload.cycles.some((c) => c.status === 'AT RISK' || c.status === 'At Risk') ? 'Review at-risk cycles with delivery owners before release readiness discussions.' : 'Keep cycle health under review and refresh the report after the next execution run.',
  ];

  return `${lines.join('\n\n')}\n\n**Recommended follow-up**\n\n${recommendations.map((r) => `- ${r}`).join('\n')}`;
}

function collectToolMetrics(dataset: Dataset, filter: FilterParams) {
  const toolCalls: { toolName: string; rowCount: number }[] = [];
  for (const tool of AI_TOOLS) {
    const result = executeTool(tool.name, dataset, filter);
    toolCalls.push({ toolName: tool.name, rowCount: Array.isArray(result) ? result.length : 1 });
  }
  return { toolCalls };
}

export async function generateReportFromDataset(
  dataset: Dataset,
  params: GenerateParams,
  _apiKey: string,
  filter: FilterParams,
): Promise<{ markdown: string; toolCalls: { toolName: string; rowCount: number }[]; llm?: never }> {
  const payload = buildDashboardPayload(dataset, filter);
  const { toolCalls } = collectToolMetrics(dataset, filter);
  return {
    markdown: buildNarrative(payload, params.reportType, filter),
    toolCalls,
  };
}
