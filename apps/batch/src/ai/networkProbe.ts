import type { AnthropicLogFn } from './anthropicLog';

function describeFetchError(err: unknown): string {
  const e = err as Error & { cause?: unknown; code?: string; errno?: number };
  const parts = [e.message || String(err)];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno != null) parts.push(`errno=${e.errno}`);
  if (e.cause) {
    const c = e.cause as Error & { code?: string };
    parts.push(`cause=${c.message || String(e.cause)}${c.code ? ` (${c.code})` : ''}`);
  }
  return parts.join(' · ');
}

/** Quick HTTPS reachability check before the Anthropic SDK call. */
export async function probeAnthropicReachability(log: AnthropicLogFn): Promise<void> {
  const url = 'https://api.anthropic.com/v1/messages';
  log('network probe', `GET ${url} (connectivity check)`);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
    });
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

export { describeFetchError };
