import type { AnthropicLogFn } from './anthropicLog';
import { describeFetchError, fetchWithTimeout } from '../utils/fetchWithTimeout';

/** Quick HTTPS reachability check before the Anthropic SDK call. */
export async function probeAnthropicReachability(log: AnthropicLogFn): Promise<void> {
  const url = 'https://api.anthropic.com/v1/messages';
  log('network probe', `GET ${url} (connectivity check)`);
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, 12_000);
    log(
      'network probe result',
      `status=${res.status} ${res.statusText} elapsed=${Date.now() - started}ms ` +
      '(any HTTP response means the host is reachable)',
    );
  } catch (err) {
    log('network probe failed', describeFetchError(err));
    throw err;
  }
}
