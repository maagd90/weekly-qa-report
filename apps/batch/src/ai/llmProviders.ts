import { fetchWithTimeout, safeApiError } from '../utils/fetchWithTimeout';
import { createAnthropicClient } from './anthropicClient';

export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';

export interface LlmModelOption {
  provider: LlmProvider;
  model: string;
  label: string;
  description: string;
}

export interface LlmSelectionInput {
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface LlmResolvedConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens: number;
}

export interface LlmTextRequest extends LlmResolvedConfig {
  system: string;
  prompt: string;
  timeoutMs?: number;
}

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  'openai-compatible': 'Other OpenAI-compatible',
};

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'anthropic';
export const DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001';

export const LLM_MODEL_OPTIONS: LlmModelOption[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fast/low-cost report narrative' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Higher quality Claude narrative' },
  { provider: 'openai', model: 'gpt-5.2', label: 'GPT-5.2', description: 'OpenAI general report model' },
  { provider: 'openai', model: 'gpt-5.2-mini', label: 'GPT-5.2 mini', description: 'OpenAI faster/lower-cost option' },
  { provider: 'gemini', model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Google Gemini fast report model' },
  { provider: 'gemini', model: 'gemini-3.5-pro', label: 'Gemini 3.5 Pro', description: 'Google Gemini higher-quality option' },
  { provider: 'openai-compatible', model: 'custom-model', label: 'Custom OpenAI-compatible', description: 'Groq/OpenRouter/local gateway/etc.' },
];

export function normalizeLlmProvider(value?: string): LlmProvider {
  if (value === 'openai' || value === 'gemini' || value === 'openai-compatible' || value === 'anthropic') return value;
  return DEFAULT_LLM_PROVIDER;
}

export function defaultModelForProvider(provider: LlmProvider): string {
  return LLM_MODEL_OPTIONS.find((m) => m.provider === provider)?.model || DEFAULT_LLM_MODEL;
}

export function envKeyForProvider(provider: LlmProvider): string {
  switch (provider) {
    case 'openai': return 'OPENAI_API_KEY';
    case 'gemini': return 'GEMINI_API_KEY';
    case 'openai-compatible': return 'CUSTOM_LLM_API_KEY';
    case 'anthropic':
    default:
      return 'ANTHROPIC_API_KEY';
  }
}

export function resolveProviderApiKey(provider: LlmProvider, userKey?: string, legacyAnthropicKey?: string): string {
  const direct = userKey?.trim();
  if (direct) return direct;
  if (provider === 'anthropic' && legacyAnthropicKey?.trim()) return legacyAnthropicKey.trim();
  return (process.env[envKeyForProvider(provider)] || '').trim();
}

function requireKey(config: LlmResolvedConfig): void {
  if (!config.apiKey) throw new Error(`${envKeyForProvider(config.provider)} is not configured for ${LLM_PROVIDER_LABELS[config.provider]}`);
}

function extractAnthropicText(payload: any): string {
  const parts = Array.isArray(payload?.content) ? payload.content : [];
  return parts.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n').trim();
}

function extractOpenAiText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const text: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
      if (part?.type === 'text' && typeof part.text === 'string') text.push(part.text);
    }
  }
  return text.join('\n').trim();
}

function extractChatCompletionText(payload: any): string {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return (choice?.message?.content || choice?.text || '').toString().trim();
}

function extractGeminiText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const stepText: string[] = [];
  for (const step of steps) {
    const content = Array.isArray(step?.content) ? step.content : [];
    for (const part of content) if (typeof part?.text === 'string') stepText.push(part.text);
  }
  if (stepText.length) return stepText.join('\n').trim();
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = candidates[0]?.content?.parts || [];
  return parts.map((p: any) => p?.text || '').join('\n').trim();
}

async function parseJsonResponse(res: Response, prefix: string): Promise<any> {
  const body = await res.text();
  if (!res.ok) throw new Error(safeApiError(prefix, res.status, body));
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error(`${prefix} returned non-JSON response`);
  }
}

export async function generateLlmText(request: LlmTextRequest): Promise<string> {
  requireKey(request);
  const timeoutMs = request.timeoutMs ?? 120_000;

  if (request.provider === 'anthropic') {
    const client = createAnthropicClient(request.apiKey, timeoutMs);
    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    const text = extractAnthropicText(response);
    if (!text) throw new Error('Anthropic API returned no text');
    return text;
  }

  if (request.provider === 'openai') {
    const url = `${request.baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com/v1'}/responses`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        instructions: request.system,
        input: request.prompt,
        max_output_tokens: request.maxTokens,
        store: false,
      }),
    }, timeoutMs);
    const payload = await parseJsonResponse(res, 'OpenAI API');
    const text = extractOpenAiText(payload);
    if (!text) throw new Error('OpenAI API returned no text');
    return text;
  }

  if (request.provider === 'gemini') {
    const base = request.baseUrl?.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
    const res = await fetchWithTimeout(`${base}/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': request.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        system_instruction: request.system,
        input: request.prompt,
        store: false,
        generation_config: { max_output_tokens: request.maxTokens },
      }),
    }, timeoutMs);
    const payload = await parseJsonResponse(res, 'Gemini API');
    const text = extractGeminiText(payload);
    if (!text) throw new Error('Gemini API returned no text');
    return text;
  }

  const baseUrl = request.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Custom OpenAI-compatible provider requires baseUrl, e.g. https://api.example.com/v1');
  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      max_tokens: request.maxTokens,
      temperature: 0.2,
    }),
  }, timeoutMs);
  const payload = await parseJsonResponse(res, 'OpenAI-compatible API');
  const text = extractChatCompletionText(payload);
  if (!text) throw new Error('OpenAI-compatible API returned no text');
  return text;
}
