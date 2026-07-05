import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { loadReportConfig } from '../config/loadReportConfig';
import { generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';

const SYSTEM = [
  'You are a senior QA lead writing a business-ready QA sprint report.',
  'Use only the verified JSON metrics supplied by the application. Never invent defect counts, ticket ids, people, dates, or statuses.',
  'Write in the same formal style as a business QA sprint report: objective, validated scope, defect verification, integration validation, risks, upcoming plan, and final summary.',
  'Use clean markdown. Prefer numbered sections with short paragraphs, concise bullets, and compact tables.',
  'When a metric is missing, say Not available instead of guessing.',
].join(' ');

function reportPrompt(reportType: ReportType, filter: FilterParams, metricsJson: string): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  return [
    `Generate a ${reportType} QA Sprint Report for ${scope}.`,
    '',
    'Required report structure:',
    '1. Objective',
    '2. Validation Focus',
    '3. UAT Defect Verification Summary',
    '4. Test Execution Summary',
    '5. JIRA / Defect Validation',
    '6. Test Cycle Health',
    '7. Defects Still Open / Under Fix',
    '8. Overall Sprint Status',
    '9. Risks / Attention Required',
    '10. Upcoming Sprint Plan',
    '11. Final Summary',
    '',
    'Formatting requirements:',
    '- Use markdown tables for summary counts and status tables.',
    '- Use concise bullets for validation focus, risks, and upcoming plan.',
    '- Use a business tone suitable for senior management.',
    '- Do not include raw JSON.',
    '- Do not mention AI or model names.',
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
    prompt: reportPrompt(params.reportType, filter, JSON.stringify({ scope: filter, metrics }, null, 2)),
  });
  return {
    markdown: markdown || '# QA Sprint Report\n\nNo content generated.',
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
