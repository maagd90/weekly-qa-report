import { ProxyAgent } from 'undici';

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_BODY_TIMEOUT_MS = 120_000;

/**
 * Corporate networks require outbound HTTPS to go through an HTTP(S) proxy.
 * Node's global fetch (used by the Anthropic SDK) does not read proxy env vars,
 * so a direct call to api.anthropic.com fails with "Connection error".
 *
 * Returns fetchOptions carrying an undici ProxyAgent dispatcher, or undefined
 * when no proxy is set (direct connection). Apply ONLY to the Anthropic client
 * so internal JIRA/QMetry calls stay direct.
 *
 * Env (first non-empty wins): ANTHROPIC_PROXY_URL, HTTPS_PROXY, HTTP_PROXY.
 * Set ANTHROPIC_PROXY_DISABLE=1 to force a direct connection even if HTTPS_PROXY is set.
 * Proxy auth: embed in URL -> http://user:pass@proxy.corp:8080
 */
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

function normalizeProxyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function isPlaceholderProxy(url: string): boolean {
  return /proxy\.corp\.example|your-proxy|REPLACE_WITH/i.test(url);
}

/** Resolved proxy URL for Anthropic, or undefined for direct connection. */
export function getAnthropicProxyUrl(): string | undefined {
  if (/^(1|true|yes)$/i.test((process.env.ANTHROPIC_PROXY_DISABLE || '').trim())) {
    return undefined;
  }

  const raw = (
    process.env.ANTHROPIC_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  ).trim();

  if (!raw) return undefined;

  const normalized = normalizeProxyUrl(raw);
  if (isPlaceholderProxy(normalized)) {
    console.warn('[anthropic] Ignoring placeholder proxy URL in .env');
    return undefined;
  }

  try {
    // eslint-disable-next-line no-new
    new URL(normalized);
    return normalized;
  } catch {
    console.warn('[anthropic] Ignoring invalid proxy URL:', maskProxyUrl(normalized));
    return undefined;
  }
}

export function getAnthropicProxyInfo(): { configured: boolean; masked?: string } {
  const url = getAnthropicProxyUrl();
  return url ? { configured: true, masked: maskProxyUrl(url) } : { configured: false };
}

export function getAnthropicFetchOptions(opts?: {
  connectTimeoutMs?: number;
  bodyTimeoutMs?: number;
}): { dispatcher: ProxyAgent } | undefined {
  const proxyUrl = getAnthropicProxyUrl();
  if (!proxyUrl) return undefined;

  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      connectTimeout: opts?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      bodyTimeout: opts?.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS,
    }),
  };
}
