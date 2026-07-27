import type {
  DashboardCycleItem,
  DashboardDefectBacklog,
  DashboardResultMixItem,
  DashboardStoryBug,
  DashboardTesterItem,
  DashboardTraceabilityItem,
  DashboardUatPayload,
  FilterParams,
  ReportType,
} from '../types/dataset';

/**
 * Verified dashboard metrics consumed by the deterministic narrative writer.
 *
 * The property names intentionally match the existing grounded-data tool names
 * so the network-backed and deterministic providers use the same calculations.
 */
export interface TemplateNarrativeMetrics {
  get_result_mix?: DashboardResultMixItem[];
  get_tester_stats?: DashboardTesterItem[];
  get_cycle_health?: DashboardCycleItem[];
  get_story_bug_split?: DashboardStoryBug;
  get_defect_backlog?: DashboardDefectBacklog;
  get_traceability?: DashboardTraceabilityItem[];
  get_uat_summary?: DashboardUatPayload | { total: number; open: number; closed: number; message?: string };
  get_project_comparison?: Array<{ project: string; projectName?: string; totalCases: number; executed: number; passRate: number; failed: number; blocked: number; openBugs: number; cycles: number; traceabilityAreas: number }>;
  project_context?: {
    vendorPortal?: { state: 'populated' | 'out-of-range' | 'not-uploaded'; total: number };
    wonderMiles?: { state: 'populated' | 'out-of-range' | 'not-uploaded'; total: number; stories: number; bugs: number; openBugs: number };
  };
}

/** Converts a project key into the business-facing report name. */
function projectDisplayName(project?: string): string {
  const key = (project || '').trim().toUpperCase();
  if (!key || key === 'ALL') return 'All Projects';
  if (key === 'DP') return 'WonderMiles';
  if (key === 'DLM') return 'DN4_FT - Supply & DMC';
  if (key === 'DN4_FT') return 'DN4 Flight';
  return project || key;
}

/** Returns the business-facing label used in the narrative introduction. */
function reportTypeLabel(reportType: ReportType): string {
  if (reportType === 'executive') return 'Executive';
  if (reportType === 'cycles') return 'Cycle Health';
  if (reportType === 'defects') return 'Defect';
  if (reportType === 'testers') return 'Quality Assurance Performance';
  return 'Full';
}

/** Calculates a rounded percentage while protecting against division by zero. */
function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

/** Joins count/label pairs while omitting zero-value entries. */
function nonZeroList(pairs: Array<[label: string, count: number]>): string {
  return pairs
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(', ');
}

/** Describes execution volume and pass rate using the dashboard result mix. */
function resultMixParagraph(resultMix: DashboardResultMixItem[] | undefined): string | null {
  if (!resultMix?.length) return null;
  const total = resultMix.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return null;

  const byCode = new Map(resultMix.map((item) => [item.code, item.count]));
  const pass = byCode.get('PASS') ?? 0;
  const fail = byCode.get('FAIL') ?? 0;
  const blocked = byCode.get('BLOCKED') ?? 0;
  const notApplicable = byCode.get('NA') ?? 0;
  const notExecuted = byCode.get('NE') ?? 0;
  const executed = pass + fail + blocked + notApplicable;
  const passRate = percentage(pass, executed);
  const breakdown = nonZeroList([
    ['passed', pass],
    ['failed', fail],
    ['blocked', blocked],
    ['not applicable', notApplicable],
  ]);

  const health = passRate >= 90
    ? 'This reflects strong execution health for the period.'
    : passRate >= 70
      ? 'Execution health is acceptable, with some areas requiring attention.'
      : executed > 0
        ? 'The execution result indicates release risk that warrants review.'
        : '';

  return [
    `${total} test case result${total === 1 ? '' : 's'} ${total === 1 ? 'was' : 'were'} in scope, with ${executed} executed${notExecuted > 0 ? ` and ${notExecuted} not executed` : ''}.`,
    executed > 0 && breakdown ? `The pass rate across executed cases was ${passRate}% (${breakdown}).` : '',
    health,
  ].filter(Boolean).join(' ');
}

/** Describes cycle risk without treating Not Started cycles as 0% execution. */
function cycleHealthParagraph(cycles: DashboardCycleItem[] | undefined): string | null {
  if (!cycles?.length) return null;
  const atRisk = cycles.filter((cycle) => /at risk/i.test(cycle.status));
  const cyclesWithExecutions = cycles
    .filter((cycle) => cycle.total - cycle.ne > 0)
    .sort((left, right) => left.passPct - right.passPct);
  const lowest = cyclesWithExecutions[0];
  const lowestExecuted = lowest ? lowest.total - lowest.ne : 0;

  return [
    `${cycles.length} test cycle${cycles.length === 1 ? ' was' : 's were'} in scope this period.`,
    atRisk.length > 0
      ? `${atRisk.length} cycle${atRisk.length === 1 ? ' is' : 's are'} flagged At Risk: ${atRisk.slice(0, 5).map((cycle) => cycle.name).join(', ')}${atRisk.length > 5 ? ', and others' : ''}.`
      : '',
    lowest && lowest.passPct < 70
      ? `The lowest pass rate among cycles with executed cases is on "${lowest.name}" at ${lowest.passPct}% (${lowest.pass} of ${lowestExecuted} executed cases passed).`
      : '',
  ].filter(Boolean).join(' ');
}

/** Describes execution attributed to named Quality Assurance members. */
function qualityAssuranceParagraph(items: DashboardTesterItem[] | undefined): string | null {
  if (!items?.length) return null;
  const attributedExecutions = items.reduce((sum, item) => sum + item.executed, 0);
  if (attributedExecutions === 0) return null;
  const topContributor = [...items].sort((left, right) => right.executed - left.executed)[0];

  return `${items.length} Quality Assurance member${items.length === 1 ? '' : 's'} had attributed activity this period, covering ${attributedExecutions} execution${attributedExecutions === 1 ? '' : 's'} with an Executed By value. ${topContributor.name} had the highest attributed volume with ${topContributor.executed} executions at a ${topContributor.passPct}% pass rate.`;
}

/** Describes non-zero JIRA story and bug activity. */
function storyBugParagraph(storyBug: DashboardStoryBug | undefined): string | null {
  if (!storyBug || (storyBug.story === 0 && storyBug.bug === 0)) return null;
  const clauses: string[] = [];

  if (storyBug.story > 0) {
    clauses.push(`${storyBug.story} ${storyBug.story === 1 ? 'story' : 'stories'}${storyBug.storyOpen > 0 ? ` (${storyBug.storyOpen} open)` : ''}`);
  }
  if (storyBug.bug > 0) {
    clauses.push(`${storyBug.bug} ${storyBug.bug === 1 ? 'bug' : 'bugs'}${storyBug.bugOpen > 0 ? ` (${storyBug.bugOpen} open)` : ''}`);
  }

  return `JIRA activity in scope included ${clauses.join(' and ')}.`;
}

/** Describes period-active open defects, omitting zero-value buckets. */
function defectBacklogParagraph(backlog: DashboardDefectBacklog | undefined): string | null {
  if (!backlog || backlog.openTotal === 0) return null;
  const priorities = backlog.topPriorities
    .filter((priority) => priority.open > 0)
    .slice(0, 3)
    .map((priority) => `${priority.priority}: ${priority.open}`)
    .join(', ');
  const topOwner = backlog.byOwner.find((owner) => owner.open > 0);

  return [
    `${backlog.openTotal} defect${backlog.openTotal === 1 ? ' is' : 's are'} open with activity in this period.`,
    priorities ? `By priority: ${priorities}.` : '',
    topOwner ? `${topOwner.name} carries the largest attributed share with ${topOwner.open} open.` : '',
  ].filter(Boolean).join(' ');
}

/** Describes traceability areas only when traceability data exists. */
function traceabilityParagraph(items: DashboardTraceabilityItem[] | undefined): string | null {
  if (!items?.length) return null;
  const lagging = items.filter((item) => item.completion < 70 || /open|risk/i.test(item.status));

  return [
    `Traceability was tracked across ${items.length} feature area${items.length === 1 ? '' : 's'}.`,
    lagging.length > 0
      ? `${lagging.length} area${lagging.length === 1 ? '' : 's'} ${lagging.length === 1 ? 'shows' : 'show'} lower completion or open risk: ${lagging.slice(0, 5).map((item) => item.area).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');
}

/** Describes non-zero Vendor Portal bug activity for the selected period. */
function uatParagraph(uat: TemplateNarrativeMetrics['get_uat_summary']): string | null {
  if (!uat || uat.total === 0) return null;
  const breakdown = nonZeroList([['open', uat.open], ['closed', uat.closed]]);
  const closureRate = 'closureRate' in uat ? uat.closureRate : percentage(uat.closed, uat.total);
  const closure = closureRate > 0 ? ` (${closureRate}% closure rate)` : '';

  return `Vendor Portal Bugs recorded ${uat.total} item${uat.total === 1 ? '' : 's'} this period${breakdown ? `: ${breakdown}` : ''}${closure}.`;
}

function projectComparisonParagraph(items: TemplateNarrativeMetrics['get_project_comparison']): string | null {
  if (!items?.length) return null;
  const rows = items.map((item) => `${item.projectName || projectDisplayName(item.project)}: ${item.executed}/${item.totalCases} executed, ${item.passRate}% pass rate, ${item.failed} failed, ${item.blocked} blocked, ${item.openBugs} open bugs`);
  const riskProjects = items.filter((item) => item.failed > 0 || item.blocked > 0 || item.openBugs > 0);
  return `Portfolio comparison across ${items.length} projects. ${rows.join('; ')}. ${riskProjects.length ? `${riskProjects.length} project${riskProjects.length === 1 ? '' : 's'} show${riskProjects.length === 1 ? 's' : ''} active execution or defect risk in the selected period.` : 'No failed, blocked, or open-bug risk is shown in the selected period.'}`;
}

function specialisedProjectParagraph(context: TemplateNarrativeMetrics['project_context']): string | null {
  if (!context) return null;
  const statements: string[] = [];
  if (context.vendorPortal?.state === 'out-of-range') {
    statements.push('A Vendor Portal export is available, but no Vendor Portal bugs fall within the selected reporting period.');
  } else if (context.vendorPortal?.state === 'not-uploaded') {
    statements.push('Vendor Portal data is not available because no eligible export has been uploaded for this project.');
  }
  if (context.wonderMiles?.state === 'populated') {
    statements.push(`Wonder Miles export data contains ${context.wonderMiles.total} row${context.wonderMiles.total === 1 ? '' : 's'} in this period: ${context.wonderMiles.stories} stories and ${context.wonderMiles.bugs} bugs (${context.wonderMiles.openBugs} open).`);
  } else if (context.wonderMiles?.state === 'out-of-range') {
    statements.push('A Wonder Miles export is available, but no rows fall within the selected reporting period.');
  } else if (context.wonderMiles?.state === 'not-uploaded') {
    statements.push('Wonder Miles export data is not available because no eligible Story/Bug spreadsheet has been uploaded for this project.');
  }
  return statements.length ? statements.join(' ') : null;
}

/** Builds evidence-backed follow-up actions appropriate to the report type. */
function followUpBullets(metrics: TemplateNarrativeMetrics, reportType: ReportType): string[] {
  const bullets: string[] = [];
  const includeExecution = reportType === 'full' || reportType === 'executive' || reportType === 'cycles' || reportType === 'testers';
  const includeCycles = reportType === 'full' || reportType === 'executive' || reportType === 'cycles';
  const includeDefects = reportType === 'full' || reportType === 'executive' || reportType === 'defects';

  const atRisk = metrics.get_cycle_health?.filter((cycle) => /at risk/i.test(cycle.status)) ?? [];
  if (includeCycles && atRisk.length > 0) {
    bullets.push(`Review the ${atRisk.length} At Risk cycle${atRisk.length === 1 ? '' : 's'} (${atRisk.slice(0, 3).map((cycle) => cycle.name).join(', ')}) before sign-off.`);
  }

  const critical = metrics.get_defect_backlog?.topPriorities.filter((priority) => /highest|high|urgent|critical/i.test(priority.priority) && priority.open > 0) ?? [];
  if (includeDefects && critical.length > 0) {
    const criticalCount = critical.reduce((sum, priority) => sum + priority.open, 0);
    bullets.push(`Prioritize ${criticalCount} open high-priority defect${criticalCount === 1 ? '' : 's'} for triage.`);
  }

  const blocked = metrics.get_result_mix?.find((result) => result.code === 'BLOCKED')?.count ?? 0;
  if (includeExecution && blocked > 0) {
    bullets.push(`Investigate the ${blocked} blocked test case${blocked === 1 ? '' : 's'} to unblock remaining execution.`);
  }

  return bullets;
}

/** Selects narrative paragraphs that match the chosen report type. */
function reportParagraphs(metrics: TemplateNarrativeMetrics, reportType: ReportType): Array<string | null> {
  const projects = () => projectComparisonParagraph(metrics.get_project_comparison);
  const resultMix = () => resultMixParagraph(metrics.get_result_mix);
  const cycles = () => cycleHealthParagraph(metrics.get_cycle_health);
  const qualityAssurance = () => qualityAssuranceParagraph(metrics.get_tester_stats);
  const storyBug = () => storyBugParagraph(metrics.get_story_bug_split);
  const defects = () => defectBacklogParagraph(metrics.get_defect_backlog);
  const traceability = () => traceabilityParagraph(metrics.get_traceability);
  const uat = () => uatParagraph(metrics.get_uat_summary);
  const specialised = () => specialisedProjectParagraph(metrics.project_context);

  if (reportType === 'cycles') return [projects(), resultMix(), cycles()];
  if (reportType === 'defects') return [projects(), storyBug(), defects(), uat(), specialised()];
  if (reportType === 'testers') return [projects(), resultMix(), qualityAssurance()];
  if (reportType === 'executive') return [projects(), resultMix(), cycles(), storyBug(), defects(), uat(), specialised()];
  return [projects(), resultMix(), cycles(), qualityAssurance(), storyBug(), defects(), traceability(), uat(), specialised()];
}

/**
 * Builds a deterministic Narrative Summary from verified dashboard metrics.
 *
 * @param metrics Tool-name-keyed metrics shared with the network-backed path.
 * @param filter Active project, date, search, and result filters.
 * @param reportType Report variant controlling which paragraphs are included.
 * @returns Business-ready Markdown without an API key or network request.
 */
export function generateTemplateNarrative(
  metrics: TemplateNarrativeMetrics,
  filter: FilterParams,
  reportType: ReportType,
  configuredProjectName?: string,
): string {
  const project = configuredProjectName?.trim() || projectDisplayName(filter.project);
  const scope = `${filter.startDate || 'all time'} to ${filter.endDate || 'present'}`;
  const intro = `${reportTypeLabel(reportType)} QA summary for ${project}, covering ${scope}.`;
  const paragraphs = reportParagraphs(metrics, reportType)
    .filter((paragraph): paragraph is string => Boolean(paragraph?.trim()));
  const bullets = followUpBullets(metrics, reportType);

  if (paragraphs.length === 0) {
    return `${intro} Not available: insufficient data to generate a narrative for this scope.`;
  }

  const followUp = bullets.length > 0
    ? `\n\n**Recommended follow-up**\n${bullets.map((bullet) => `- ${bullet}`).join('\n')}`
    : '';
  return [intro, ...paragraphs].join('\n\n') + followUp;
}
