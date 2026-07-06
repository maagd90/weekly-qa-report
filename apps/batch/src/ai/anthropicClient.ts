import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLogFn } from './anthropicLog';
import { getOptionalAnthropicFetchOptions, getOptionalAnthropicProxyUrl } from './optionalProxy';

export function createAnthropicClient(
  apiKey: string,
  timeoutMs: number,
  log?: AnthropicLogFn,
): Anthropic {
  const fetchOptions = getOptionalAnthropicFetchOptions(log);
  const route = fetchOptions ? 'proxy' : 'direct';
  log?.(
    'creating Anthropic SDK client',
    `route=${route} timeout=${timeoutMs}ms baseURL=https://api.anthropic.com/v1/messages`,
  );
  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    ...(fetchOptions ? { fetchOptions } : {}),
  });
}

export function anthropicRoute(): 'direct' | 'proxy' {
  return getOptionalAnthropicProxyUrl() ? 'proxy' : 'direct';
}
