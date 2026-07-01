import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLogFn } from './anthropicLog';

export function createAnthropicClient(
  apiKey: string,
  timeoutMs: number,
  log?: AnthropicLogFn,
): Anthropic {
  log?.(
    'creating Anthropic SDK client',
    `route=direct timeout=${timeoutMs}ms baseURL=https://api.anthropic.com/v1/messages`,
  );
  return new Anthropic({ apiKey, timeout: timeoutMs });
}
