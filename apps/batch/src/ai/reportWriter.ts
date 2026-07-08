import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { loadReportConfig } from '../config/loadReportConfig';
import { generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';

const SYSTEM = [
  'You are a senior QA manager writing a business-ready QA sprint report narrative.',
  'Use only the verified JSON metrics supplied by the application. Never invent defect counts, ticket ids, people, dates, statuses, vendor names, or project names.',
  'The PDF/print template already renders the numbered QA report sections, KPI tables, charts, and final summary. Your output is embedded only inside the Narrative Summary section.',
  'Write analytical prose only. Do not recreate a full report structure, do not add a QA SPRINT REPORT title, and do not use numbered section headings like Objective, UAT, Test Execution, Defects, Risks, Sprint Plan, or Final Summary.',
  'Use clean markdown with short paragraphs, concise bullets, and compact tables only when they add clarity.',
  'When a metric is missing, say Not available instead of guessing.',
].join(' ');

function projectDisplayName(project?: string): string {
  const key = (project || '').trim().toUpperCase();
  if (!key || key === 'ALL') return 'All Projects';
  if (key === 'DP') return 'WonderMiles';
  if (key === 'DN4_FT') return 'DN4 Flight';
  return project || key;
}

function reportPrompt(reportType: ReportType, filter: FilterParams, metricsJson: string): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  const project = projectDisplayName(filter.project);
  return [
    `Write the Narrative Summary for a ${reportType} QA Sprint Report covering ${scope}. Project scope: ${project}.`,
    '',
    'Important context:',
    '- The dashboard/PDF template already renders the numbered report sections and tables separately.',
    '- This text will be inserted inside the existing "AI Narrative Summary" / "Narrative Summary" section.',
    '- Do not repeat the report skeleton and do not start a new report.',
    '',
    'Narrative content to cover:',
    '- What the execution, cycle, defect, and UAT metrics indicate about sprint health.',
    '- Notable risks, bottlenecks, or areas needing attention.',
    '- A brief forward-looking recommendation for the next review period.',
    '',
    'Formatting requirements:',
    '- Use 2 to 4 short paragraphs plus concise bullets if needed.',
    '- Do not use numbered headings such as "1. Objective" or "2. Change Requests Validated".',
    '- Do not include a title such as "QA Sprint Report".',
    '- Do not repeat every table already present in the PDF; summarize the meaning of the metrics.',
    '- Use a business tone suitable for senior management.',
    '- Do not include raw JSON.',
    '- Do not mention AI, model names, or tool names.',
    '- If a point cannot be supported by the verified metrics, write Not available and explain what data is missing.',
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
  return { metrics, toolCalls };
}

export function resolveReportLlmConfig(params: GenerateParams, configDir: string, legacyApiKey?: string): LlmResolvedConfig {
  const reportCfg = loadReportConfig(configDir);
  const provider = params.llm?.provider || reportCfg.provider;
  const model = (params.llm?.model || reportCfg.model).trim();
  const userOrLegacyKey = provider === 'anthropic' ? (params.llm?.apiKey || legacyApiKey) : params.llm?.apiKey;
  const apiKey = resolveProviderApiKey(provider, userOrLegacyKey, process.env.ANTHROPIC_API_KEY);
  return { provider, model, apiKey, baseUrl: params.llm?.baseUrl || reportCfg.baseUrl, maxTokens: reportCfg.maxTokens };
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
  const markdown = await generateLlmText({
    ...llm,
    system: SYSTEM,
    prompt: reportPrompt(params.reportType, filter, JSON.stringify({ scope: { ...filter, projectLabel: projectDisplayName(filter.project) }, metrics }, null, 2)),
  });
  return {
    markdown: markdown || 'No narrative content generated.',
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
