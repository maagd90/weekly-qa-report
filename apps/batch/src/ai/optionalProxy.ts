import { ProxyAgent } from 'undici';

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const trimmed = (v || '').trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Corporate proxy for Anthropic only (JIRA/QMetry stay direct).
 * Precedence: ANTHROPIC_PROXY_URL → HTTPS_PROXY → HTTP_PROXY (skip empty strings).
 */
export function getOptionalAnthropicProxyUrl(): string | undefined {
  return firstNonEmpty(
    process.env.ANTHROPIC_PROXY_URL,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  );
}

export function anthropicProxySource(): string {
  if ((process.env.ANTHROPIC_PROXY_URL || '').trim()) return 'ANTHROPIC_PROXY_URL';
  if ((process.env.HTTPS_PROXY || '').trim()) return 'HTTPS_PROXY';
  if ((process.env.https_proxy || '').trim()) return 'https_proxy';
  if ((process.env.HTTP_PROXY || '').trim()) return 'HTTP_PROXY';
  if ((process.env.http_proxy || '').trim()) return 'http_proxy';
  return 'none';
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(invalid URL)';
  }
}

export function getOptionalAnthropicFetchOptions(
  log?: (step: string, detail?: string) => void,
): { dispatcher: ProxyAgent } | undefined {
  const proxyUrl = getOptionalAnthropicProxyUrl();
  if (!proxyUrl) return undefined;

  const source = anthropicProxySource();
  log?.('proxy active', `${source}=${maskProxyUrl(proxyUrl)}`);
  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      connectTimeout: 15_000,
      bodyTimeout: 120_000,
    }),
  };
}
