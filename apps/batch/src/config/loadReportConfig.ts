import fs from 'fs';
import path from 'path';
import {
  DEFAULT_LLM_PROVIDER,
  defaultModelForProvider,
  normalizeLlmProvider,
  type LlmProvider,
} from '../ai/llmProviders';

export interface ReportConfig {
  provider: LlmProvider;
  model: string;
  maxTokens: number;
  baseUrl?: string;
  proxy?: {
    enabled?: boolean;
    url?: string;
  };
}

const DEFAULTS: ReportConfig = {
  provider: DEFAULT_LLM_PROVIDER,
  model: defaultModelForProvider(DEFAULT_LLM_PROVIDER),
  maxTokens: 768,
};

function providerModelEnv(provider: LlmProvider): string | undefined {
  switch (provider) {
    case 'openai': return process.env.OPENAI_MODEL;
    case 'gemini': return process.env.GEMINI_MODEL;
    case 'openai-compatible': return process.env.CUSTOM_LLM_MODEL;
    case 'anthropic':
    default:
      return process.env.ANTHROPIC_MODEL;
  }
}

/** Precedence: env vars > config/report.json > provider defaults. */
export function loadReportConfig(configDir: string): ReportConfig {
  const file = path.join(configDir, 'report.json');
  let fromFile: Partial<ReportConfig> = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ReportConfig>;
    } catch {
      /* keep defaults on malformed JSON */
    }
  }

  const provider = normalizeLlmProvider(process.env.LLM_PROVIDER || fromFile.provider || DEFAULTS.provider);
  const model = (
    process.env.LLM_MODEL ||
    providerModelEnv(provider) ||
    fromFile.model ||
    defaultModelForProvider(provider)
  ).trim();
  const baseUrl = (
    process.env.LLM_BASE_URL ||
    (provider === 'openai-compatible' ? process.env.CUSTOM_LLM_BASE_URL : undefined) ||
    fromFile.baseUrl ||
    undefined
  )?.trim();

  return {
    provider,
    model,
    maxTokens: typeof fromFile.maxTokens === 'number' && fromFile.maxTokens > 0 ? fromFile.maxTokens : DEFAULTS.maxTokens,
    ...(baseUrl ? { baseUrl } : {}),
    ...(fromFile.proxy ? { proxy: fromFile.proxy } : {}),
  };
}
