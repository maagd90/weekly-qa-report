import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { loadReportConfig } from '../config/loadReportConfig';
import { generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';

const SYSTEM = [
  'You are a senior QA lead writing a business-ready QA sprint report.',
  'Use only the verified JSON metrics supplied by the application. Never invent defect counts, ticket ids, people, dates, statuses, vendor names, or project names.',
  'Match the formal QA Sprint Report style: red-banner business report, numbered sections, validation focus, defect verification, integration validation, risks, upcoming plan, and final summary.',
  'Use clean markdown with short paragraphs, compact tables, and concise bullets.',
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
    `Generate a ${reportType} QA Sprint Report for ${scope}. Project scope: ${project}.`,
    '',
    'Required report structure. Use these exact section headings:',
    '1. Objective',
    '2. Change Requests Validated',
    '3. UAT Defect Verification Summary',
    '4. Integration Validation',
    '5. Payment Flow Validation',
    '6. Endpoint Product Validation',
    '7. Source Market Validation',
    '8. Reports Validation',
    '9. Booking / Status Change Validation',
    '10. Defects Still Open / Under Fix',
    '11. Overall Sprint Status',
    '12. Risks / Attention Required',
    '13. Upcoming Sprint Plan',
    '14. Final Summary',
    '',
    'Formatting requirements:',
    '- Use markdown tables for defect counts, bugs/open items, and area/status summaries.',
    '- Use concise bullets for validation focus, risks, and upcoming sprint plan.',
    '- Use a business tone suitable for senior management.',
    '- Do not include raw JSON.',
    '- Do not mention AI, model names, or tool names.',
    '- If a section cannot be supported by the verified metrics, write Not available and explain what data is missing.',
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
    markdown: markdown || '# QA Sprint Report\n\nNo content generated.',
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
