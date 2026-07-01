import { ProxyAgent } from 'undici';

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
 * Proxy auth: embed in URL -> http://user:pass@proxy.corp:8080
 */
export function getAnthropicFetchOptions(): { dispatcher: ProxyAgent } | undefined {
  const proxyUrl = (
    process.env.ANTHROPIC_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  ).trim();
  if (!proxyUrl) return undefined;
  return { dispatcher: new ProxyAgent(proxyUrl) };
}
