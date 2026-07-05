import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';
import { loadReportConfig } from '../config/loadReportConfig';
import { generateLlmText, resolveProviderApiKey, type LlmResolvedConfig } from './llmProviders';

const SYSTEM = 'Write a concise markdown QA report from the provided verified JSON metrics. Use only the supplied metrics.';

function reportPrompt(reportType: ReportType, filter: FilterParams, metricsJson: string): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  return `Generate a ${reportType} QA report for ${scope}. Verified metrics JSON:\n${metricsJson}`;
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
    markdown: markdown || '# Report\n\nNo content generated.',
    toolCalls,
    llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, maxTokens: llm.maxTokens },
  };
}
