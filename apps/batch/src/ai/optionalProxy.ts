import { ProxyAgent } from 'undici';

/** Only when ANTHROPIC_PROXY_URL is explicitly set (opt-in for Docker / office VPN). */
export function getOptionalAnthropicProxyUrl(): string | undefined {
  const url = (process.env.ANTHROPIC_PROXY_URL || '').trim();
  return url || undefined;
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

  log?.('proxy opt-in', `ANTHROPIC_PROXY_URL=${maskProxyUrl(proxyUrl)}`);
  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      connectTimeout: 15_000,
      bodyTimeout: 120_000,
    }),
  };
}
