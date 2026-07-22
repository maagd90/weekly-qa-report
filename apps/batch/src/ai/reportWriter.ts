import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { loadReportConfig } from '../config/loadReportConfig';
import { defaultModelForProvider, generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';
import { generateTemplateNarrative, type TemplateNarrativeMetrics } from './templateNarrative';

const SYSTEM = [
  'You are a senior QA manager writing a business-ready QA sprint report narrative.',
  'Use only the verified JSON metrics supplied by the application. Never invent defect counts, ticket ids, people, dates, statuses, vendor names, project names, owners, priorities, risks, or conclusions that are not supported by the JSON.',
  'The PDF/print template already renders the report headings, KPI tables, charts, and final summary from deterministic dashboard data. Your output is inserted only inside the Narrative Summary section.',
  'Write like an experienced QA manager: clear, evidence-based, complete, and suitable for senior management.',
  'Do not recreate a full report structure, do not add a QA SPRINT REPORT title, and do not use numbered headings such as Objective, UAT, Test Execution, Defects, Risks, Sprint Plan, or Final Summary.',
  'Do not mention AI, model names, prompts, tools, JSON, or automation in the report text.',
  'When a metric or supporting evidence is missing, write Not available instead of guessing.',
  'Do not pad the report to reach a target length. Stop when the available evidence has been covered.',
].join(' ');

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
  if (reportType === 'defects') return 'Defects';
  if (reportType === 'testers') return 'Quality Assurance Performance';
  return 'Full';
}

function reportPrompt(reportType: ReportType, filter: FilterParams, metricsJson: string): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  const project = projectDisplayName(filter.project);
  const reportLabel = reportTypeLabel(reportType);
  return [
    `Write the Narrative Summary for a ${reportLabel} QA Sprint Report covering ${scope}. Project scope: ${project}.`,
    '',
    'This narrative is embedded inside a report whose headings and tables are already rendered by the application. Do not repeat or recreate those headings.',
    '',
    'Length and completeness rules:',
    '- Maximum output length is 15,000 characters, but this is a ceiling, not a target.',
    '- Write only as much as the verified metrics support. Do not pad, repeat, or add generic filler to reach the maximum length.',
    '- Prefer a complete management narrative: normally 5 to 9 concise paragraphs when enough evidence exists; fewer paragraphs are acceptable when data is limited.',
    '- Include one short bullet list titled **Recommended follow-up** with only evidence-backed actions.',
    '- No numbered section headings.',
    '- No full report title.',
    '- No raw JSON.',
    '- No mention of AI, model, prompt, or tools.',
    '',
    'Content rules:',
    '- Use only numbers and facts present in the verified metrics JSON.',
    '- Cover execution progress, pass/fail/block status, cycle health, defect position, ownership/risk concentration, traceability, and UAT only when those metrics exist.',
    '- When get_project_comparison is present, compare the registered projects and keep project-specific risks attributed to the correct project.',
    '- Explain what the metrics mean for sprint health and release readiness; do not only restate numbers.',
    '- Highlight risks only when supported by failed, blocked, open, at-risk, low-coverage, or pending metrics.',
    '- For missing areas, write Not available and state which data is missing.',
    '- Do not create ticket IDs, defect names, owners, dates, vendor names, or project names that are not in the JSON.',
    '',
    'IMPORTANT: all counts (including open defects) reflect only items with activity within the selected date range — describe them as period activity, not an all-time open backlog.',
    '',
    'Verified metrics JSON:',
    metricsJson,
  ].join('\n');
}

function collectToolMetrics(dataset: Dataset, filter: FilterParams) {
  const toolCalls: { toolName: string; rowCount: number }[] = [];
  const metrics: Record<string, unknown> = {};
  for (const tool of AI_TOOLS) {
    const result = executeTool(tool.name, dataset, filter);
    metrics[tool.name] = result;
    toolCalls.push({ toolName: tool.name, rowCount: Array.isArray(result) ? result.length : 1 });
  }
  return { metrics: metrics as TemplateNarrativeMetrics, toolCalls };
}

export function resolveReportLlmConfig(params: GenerateParams, configDir: string, legacyApiKey?: string): LlmResolvedConfig {
  const reportCfg = loadReportConfig(configDir);
  const provider = params.llm?.provider || reportCfg.provider;
  const model = (
    params.llm?.model ||
    (provider === reportCfg.provider ? reportCfg.model : defaultModelForProvider(provider))
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
): Promise<{ markdown: string; toolCalls: { toolName: string; rowCount: number }[]; llm: Omit<LlmResolvedConfig, 'apiKey'> }> {
  const configDir = params.configDir || process.env.CONFIG_DIR || 'config';
  const llm = resolveReportLlmConfig(params, configDir, apiKey);
  const { metrics, toolCalls } = collectToolMetrics(dataset, filter);
  if (llm.provider === 'template') {
    return {
      markdown: generateTemplateNarrative(metrics, filter, params.reportType),
      toolCalls,
      llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
    };
  }
  const markdown = await generateLlmText({
    ...llm,
    system: SYSTEM,
    prompt: reportPrompt(params.reportType, filter, JSON.stringify({ scope: { ...filter, projectLabel: projectDisplayName(filter.project) }, reportType: reportTypeLabel(params.reportType), metrics }, null, 2)),
  });
  return {
    markdown: markdown || 'Not available. Narrative content was not returned by the configured provider.',
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
