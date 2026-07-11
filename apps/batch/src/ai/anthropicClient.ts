import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLogFn } from './anthropicLog';
import { getOptionalAnthropicFetchOptions, getOptionalAnthropicProxyUrl } from './optionalProxy';

function normalizeAnthropicBaseUrl(value?: string): string | undefined {
  const clean = (value || '').trim().replace(/\/+$/, '');
  if (!clean) return undefined;
  return clean.replace(/\/v1\/messages$/i, '');
}

export function createAnthropicClient(
  apiKey: string,
  timeoutMs: number,
  log?: AnthropicLogFn,
  baseUrl?: string,
): Anthropic {
  const fetchOptions = getOptionalAnthropicFetchOptions(log);
  const route = fetchOptions ? 'proxy' : 'direct';
  const customBaseUrl = normalizeAnthropicBaseUrl(baseUrl);
  const effectiveBaseUrl = customBaseUrl || 'https://api.anthropic.com';
  log?.(
    'creating Anthropic SDK client',
    `route=${route} timeout=${timeoutMs}ms baseURL=${effectiveBaseUrl}/v1/messages`,
  );
  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    ...(customBaseUrl ? { baseURL: customBaseUrl } : {}),
    ...(fetchOptions ? { fetchOptions } : {}),
  });
}

export function anthropicRoute(): 'direct' | 'proxy' {
  return getOptionalAnthropicProxyUrl() ? 'proxy' : 'direct';
}
