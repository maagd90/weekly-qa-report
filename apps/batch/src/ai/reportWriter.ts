import type {
  Dataset,
  FilterParams,
  GenerateParams,
  ProjectCapabilities,
  ReportNarrativeSection,
  ReportType,
  StructuredReportNarrative,
} from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { buildDashboardPayload } from '../export/buildDashboardPayload';
import { canonicalProjectOrUndefined, normalizeProjectPrimaryKey } from '../projects/projectKey';
import { loadReportConfig } from '../config/loadReportConfig';
import { defaultModelForProvider, generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';
import { generateTemplateNarrative, type TemplateNarrativeMetrics } from './templateNarrative';
import { toErrorMessage } from '../utils/errors';

const SYSTEM = [
  'You are a senior QA manager writing one scoped section of a business-ready QA sprint report narrative.',
  'Use only the verified JSON metrics supplied by the application. Never invent defect counts, ticket ids, people, dates, statuses, vendor names, project names, owners, priorities, risks, or conclusions that are not supported by the JSON.',
  'The PDF/print template already renders headings, KPI tables, charts, and the final summary from deterministic dashboard data.',
  'Write like an experienced QA manager: clear, evidence-based, concise, and suitable for senior management.',
  'Do not recreate a full report structure, add a QA SPRINT REPORT title, or use numbered headings.',
  'Do not mention AI, model names, prompts, tools, JSON, or automation.',
  'When evidence is missing, write Not available instead of guessing.',
].join(' ');

function normalizedLookup<T>(map: Record<string, T> | undefined, project?: string): T | undefined {
  const key = normalizeProjectPrimaryKey(project);
  if (!key) return undefined;
  return Object.entries(map || {}).find(([candidate]) => normalizeProjectPrimaryKey(candidate) === key)?.[1];
}

function projectDisplayName(params: GenerateParams, project?: string): string {
  const key = normalizeProjectPrimaryKey(project);
  if (!key) return 'All Projects';
  return normalizedLookup(params.projectNamesByKey, key)?.trim() || key;
}

function reportTypeLabel(reportType: ReportType): string {
  if (reportType === 'executive') return 'Executive';
  if (reportType === 'cycles') return 'Cycle Health';
  if (reportType === 'defects') return 'Defects';
  if (reportType === 'testers') return 'Quality Assurance Performance';
  return 'Full';
}

function reportPrompt(
  reportType: ReportType,
  filter: FilterParams,
  projectName: string,
  metricsJson: string,
): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  return [
    `Write one Narrative Summary section for a ${reportTypeLabel(reportType)} QA Sprint Report covering ${scope}. Project scope: ${projectName}.`,
    '',
    'Length and completeness rules:',
    '- Maximum output length is 15,000 characters, but this is a ceiling, not a target.',
    '- Write only as much as the verified metrics support. Do not pad, repeat, or add generic filler.',
    '- Normally use 3 to 8 concise paragraphs when enough evidence exists.',
    '- Include one short bullet list titled **Recommended follow-up** only when the evidence supports an action.',
    '- No report title, numbered section headings, or raw JSON.',
    '',
    'Content rules:',
    '- Use only numbers and facts present in the verified metrics JSON.',
    '- Keep every risk attributed to the project named in this request.',
    '- When get_project_comparison is present, compare projects without combining their ownership.',
    '- Describe counts as activity within the selected period, not an all-time backlog.',
    '- Do not create ticket IDs, defect names, owners, dates, or project names.',
    '',
    'Verified metrics JSON:',
    metricsJson,
  ].join('\n');
}

function projectCapabilities(params: GenerateParams, project?: string): ProjectCapabilities | undefined {
  return normalizedLookup(params.capabilitiesByProject, project);
}

function projectContext(
  dataset: Dataset,
  filter: FilterParams,
  params: GenerateParams,
): TemplateNarrativeMetrics['project_context'] {
  const project = canonicalProjectOrUndefined(filter.project);
  if (!project) return undefined;
  const capabilities = projectCapabilities(params, project);
  if (!capabilities) return undefined;
  const dashboard = buildDashboardPayload(dataset, filter);
  const context: NonNullable<TemplateNarrativeMetrics['project_context']> = {};

  if (capabilities.vendorPortal) {
    const total = dashboard.uat?.total || 0;
    context.vendorPortal = {
      total,
      state: total > 0
        ? 'populated'
        : dashboard.files.some((file) => file.source === 'file' && file.detectedType === 'odl')
          ? 'out-of-range'
          : 'not-uploaded',
    };
  }

  if (capabilities.wonderMilesExport) {
    const rows = (dashboard.workItems || []).filter((row) => Boolean(row.sourceFile));
    const stories = rows.filter((row) => row.issueType === 'Story').length;
    const bugs = rows.filter((row) => row.issueType === 'Bug').length;
    const openBugs = rows.filter((row) => row.issueType === 'Bug' && row.status === 'open').length;
    context.wonderMiles = {
      total: rows.length,
      stories,
      bugs,
      openBugs,
      state: rows.length > 0
        ? 'populated'
        : dashboard.files.some((file) => file.source === 'file' && file.detectedType === 'jira')
          ? 'out-of-range'
          : 'not-uploaded',
    };
  }

  return context;
}

function collectToolMetrics(dataset: Dataset, filter: FilterParams, params: GenerateParams) {
  const toolCalls: { toolName: string; rowCount: number }[] = [];
  const metrics: Record<string, unknown> = {};
  for (const tool of AI_TOOLS) {
    const result = executeTool(tool.name, dataset, filter);
    metrics[tool.name] = result;
    toolCalls.push({ toolName: tool.name, rowCount: Array.isArray(result) ? result.length : 1 });
  }
  const typed = metrics as TemplateNarrativeMetrics;
  const selectedProject = canonicalProjectOrUndefined(filter.project);
  const selectedCapabilities = projectCapabilities(params, selectedProject);
  if (!selectedProject || (selectedCapabilities && selectedCapabilities.vendorPortal !== true)) {
    typed.get_uat_summary = undefined;
  }
  if (typed.get_project_comparison) {
    typed.get_project_comparison = typed.get_project_comparison.map((item) => ({
      ...item,
      projectName: projectDisplayName(params, item.project),
    }));
  }
  typed.project_context = projectContext(dataset, filter, params);
  return { metrics: typed, toolCalls };
}

function hasNarrativeEvidence(metrics: TemplateNarrativeMetrics): boolean {
  return Boolean(
    metrics.get_result_mix?.some((item) => item.count > 0)
    || metrics.get_tester_stats?.some((item) => item.executed > 0)
    || metrics.get_cycle_health?.length
    || (metrics.get_story_bug_split && metrics.get_story_bug_split.story + metrics.get_story_bug_split.bug > 0)
    || metrics.get_defect_backlog?.openTotal
    || metrics.get_traceability?.length
    || (metrics.get_uat_summary && metrics.get_uat_summary.total > 0)
    || metrics.get_project_comparison?.length
    || metrics.project_context?.vendorPortal
    || metrics.project_context?.wonderMiles
  );
}

async function generateSection(args: {
  dataset: Dataset;
  params: GenerateParams;
  filter: FilterParams;
  llm: LlmResolvedConfig;
  project?: string;
}): Promise<{ section: ReportNarrativeSection; toolCalls: { toolName: string; rowCount: number }[] }> {
  const projectName = projectDisplayName(args.params, args.project);
  const { metrics, toolCalls } = collectToolMetrics(args.dataset, args.filter, args.params);
  const deterministic = generateTemplateNarrative(metrics, args.filter, args.params.reportType, projectName);
  const base = {
    project: args.project,
    projectName,
    markdown: deterministic,
  };

  if (!hasNarrativeEvidence(metrics)) {
    return { section: { ...base, status: 'unavailable' }, toolCalls };
  }
  if (args.llm.provider === 'template') {
    return { section: { ...base, status: 'generated' }, toolCalls };
  }

  try {
    const markdown = await generateLlmText({
      ...args.llm,
      system: SYSTEM,
      prompt: reportPrompt(
        args.params.reportType,
        args.filter,
        projectName,
        JSON.stringify({
          scope: { ...args.filter, project: args.project || 'all', projectName },
          reportType: reportTypeLabel(args.params.reportType),
          metrics,
        }, null, 2),
      ),
    });
    if (!markdown?.trim()) throw new Error('Narrative content was not returned by the configured provider.');
    return { section: { ...base, markdown, status: 'generated' }, toolCalls };
  } catch (error) {
    const warning = `Narrative provider failed for ${projectName}; deterministic narration was used. ${toErrorMessage(error)}`;
    return { section: { ...base, status: 'fallback', warning }, toolCalls };
  }
}

function assembleNarrative(
  portfolio: ReportNarrativeSection | undefined,
  projectOrder: string[],
  projects: Record<string, ReportNarrativeSection>,
): string {
  if (!portfolio) return projectOrder.map((project) => projects[project]?.markdown).filter(Boolean).join('\n\n');
  const parts = [`## Portfolio summary\n\n${portfolio.markdown}`];
  for (const project of projectOrder) {
    const section = projects[project];
    if (section) parts.push(`## ${section.projectName}\n\n${section.markdown}`);
  }
  return parts.join('\n\n');
}

export function resolveReportLlmConfig(params: GenerateParams, configDir: string, legacyApiKey?: string): LlmResolvedConfig {
  const reportCfg = loadReportConfig(configDir);
  const provider = params.llm?.provider || reportCfg.provider;
  const model = (
    params.llm?.model
    || (provider === reportCfg.provider ? reportCfg.model : defaultModelForProvider(provider))
  ).trim();
  const userOrLegacyKey = provider === 'anthropic' ? (params.llm?.apiKey || legacyApiKey) : params.llm?.apiKey;
  const apiKey = resolveProviderApiKey(provider, userOrLegacyKey, process.env.ANTHROPIC_API_KEY);
  const baseUrl = params.llm?.baseUrl || (provider === reportCfg.provider ? reportCfg.baseUrl : undefined);
  return { provider, model, apiKey, baseUrl, maxTokens: reportCfg.maxTokens };
}

export async function generateReportFromDataset(
  dataset: Dataset,
  params: GenerateParams,
  apiKey: string,
  filter: FilterParams,
): Promise<{
  markdown: string;
  narrative: StructuredReportNarrative;
  toolCalls: { toolName: string; rowCount: number }[];
  llm: Omit<LlmResolvedConfig, 'apiKey'>;
}> {
  const configDir = params.configDir || process.env.CONFIG_DIR || 'config';
  const llm = { ...resolveReportLlmConfig(params, configDir, apiKey), apiKey };
  const selectedProject = canonicalProjectOrUndefined(filter.project);
  const toolCalls: { toolName: string; rowCount: number }[] = [];
  let portfolio: ReportNarrativeSection | undefined;
  const projects: Record<string, ReportNarrativeSection> = {};
  let projectOrder: string[] = [];

  if (selectedProject) {
    const generated = await generateSection({
      dataset,
      params,
      filter: { ...filter, project: selectedProject },
      llm,
      project: selectedProject,
    });
    projects[selectedProject] = generated.section;
    projectOrder = [selectedProject];
    toolCalls.push(...generated.toolCalls);
  } else {
    const portfolioResult = await generateSection({ dataset, params, filter: { ...filter, project: undefined }, llm });
    portfolio = portfolioResult.section;
    toolCalls.push(...portfolioResult.toolCalls);

    const dashboard = buildDashboardPayload(dataset, { ...filter, project: undefined });
    const availableProjects = dashboard.byProject?.map((slice) => slice.project) || dashboard.scope.projects;
    const configuredOrder = Object.keys(params.projectNamesByKey || {});
    projectOrder = [
      ...configuredOrder.filter((key) => availableProjects.includes(key)),
      ...availableProjects.filter((key) => !configuredOrder.includes(key)),
    ];

    const generatedProjects = await Promise.all(projectOrder.map(async (project) =>
      generateSection({
        dataset,
        params,
        filter: { ...filter, project },
        llm,
        project,
      })));
    generatedProjects.forEach((generated, index) => {
      projects[projectOrder[index]] = generated.section;
      toolCalls.push(...generated.toolCalls);
    });
  }

  const assembledMarkdown = assembleNarrative(portfolio, projectOrder, projects);
  const narrative: StructuredReportNarrative = {
    version: 1,
    portfolio,
    projectOrder,
    projects,
    assembledMarkdown,
  };
  return {
    markdown: assembledMarkdown,
    narrative,
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
