import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicFetchOptions } from './proxy';

export function createAnthropicClient(apiKey: string, timeoutMs: number): Anthropic {
  const fetchOptions = getAnthropicFetchOptions({
    connectTimeoutMs: Math.min(15_000, timeoutMs),
    bodyTimeoutMs: timeoutMs,
  });
  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    ...(fetchOptions ? { fetchOptions } : {}),
  });
}
