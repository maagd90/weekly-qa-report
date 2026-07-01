import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicFetchOptions, type AnthropicProxyResolution } from './proxy';
import type { AnthropicLogFn } from './anthropicLog';

export function createAnthropicClient(
  apiKey: string,
  timeoutMs: number,
  configDir: string,
  log?: AnthropicLogFn,
  proxyResolution?: AnthropicProxyResolution,
): Anthropic {
  const fetchOptions = getAnthropicFetchOptions(
    configDir,
    {
      connectTimeoutMs: Math.min(15_000, timeoutMs),
      bodyTimeoutMs: timeoutMs,
    },
    log,
    proxyResolution,
  );

  const route = fetchOptions ? 'proxy' : 'direct';
  log?.(
    'creating Anthropic SDK client',
    `route=${route} timeout=${timeoutMs}ms baseURL=https://api.anthropic.com`,
  );

  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    ...(fetchOptions ? { fetchOptions } : {}),
  });
}
