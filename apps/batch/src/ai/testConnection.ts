import { createAnthropicClient, anthropicRoute } from './anthropicClient';
import { createAnthropicLogger } from './anthropicLog';
import { probeAnthropicReachability } from './networkProbe';
import { describeFetchError } from '../utils/fetchWithTimeout';
import { getOptionalAnthropicProxyUrl, maskProxyUrl, anthropicProxySource } from './optionalProxy';
import { loadReportConfig } from '../config/loadReportConfig';
import {
  generateLlmText,
  resolveProviderApiKey,
  LLM_PROVIDER_LABELS,
  envKeyForProvider,
  type LlmSelectionInput,
  type LlmProvider,
} from './llmProviders';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  route: 'direct' | 'proxy';
  elapsedMs?: number;
  error?: string;
  logs?: string[];
}

export interface LlmTestResult extends AnthropicTestResult {
  provider?: LlmProvider;
  providerLabel?: string;
}

interface AnthropicTestOptions {
  baseUrl?: string;
  model?: string;
}

const TEST_TIMEOUT_MS = 25_000;

function networkHint(raw: string, route: 'direct' | 'proxy'): string {
  const lower = raw.toLowerCase();
  if (/enotfound|dns/.test(lower)) return ' — DNS lookup failed. Check internet connectivity, DNS settings, VPN, or whether the provider domain is blocked.';
  if (/eai_again/.test(lower)) return ' — temporary DNS lookup failure. Retry, then check DNS/VPN/proxy settings if it continues.';
  if (/econnrefused/.test(lower)) return ' — connection was actively refused. Check local firewall, VPN client, antivirus HTTPS inspection, or a blocked provider endpoint.';
  if (/etimedout|timed out|timeout|aborted|abort/.test(lower)) {
    return route === 'proxy'
      ? ' — request timed out through the configured proxy. Check officeProxyUrl in config/runtime.json or proxy availability.'
      : ' — request timed out. A corporate network, VPN, firewall, or Docker/office network may be silently blocking outbound HTTPS; configure officeProxyUrl only if your network requires it.';
  }
  if (/fetch failed|connection error|socket|connect/.test(lower)) {
    return route === 'proxy'
      ? ' — network connection failed through the configured proxy. Check officeProxyUrl in config/runtime.json.'
      : ' — network connection failed. Check internet access, VPN/firewall/antivirus HTTPS inspection, or configure a proxy only if your network requires one.';
  }
  return '';
}

function isHtmlSecurityBlock(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('<!doctype html') || lower.includes('<html') || lower.includes('zscaler');
}

function formatError(err: unknown, model: string, route: 'direct' | 'proxy'): string {
  const raw = describeFetchError(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (isHtmlSecurityBlock(raw)) {
    hint = ' — the request returned an HTML security/proxy page instead of an LLM API response. Check the selected endpoint URL, VPN/Zscaler policy, proxy configuration, and gateway allowlisting.';
  } else if (/self.signed|self-signed|unable to verify|cert|unauthorized certificate/.test(lower)) {
    hint = route === 'proxy'
      ? ' — office proxy TLS issue; keep integrationAllowSelfSignedCerts=true in config/runtime.json.'
      : ' — TLS certificate validation failed. If your network uses HTTPS inspection, configure officeProxyUrl or NODE_EXTRA_CA_CERTS in config/runtime.json.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect|timed out|timeout|aborted|abort|dns/.test(lower)) {
    hint = networkHint(raw, route);
  } else if (/401|authentication|invalid x-api-key|unauthorized/.test(lower)) {
    hint = ' — key is missing, invalid, or revoked.';
  } else if (/not_found_error|model|400|bad request/.test(lower)) {
    hint = ` — check the model name "${model}".`;
  }
  return `${raw.slice(0, 280)}${hint}`;
}

export async function testAnthropicConnection(apiKey: string, configDir: string, options: AnthropicTestOptions = {}): Promise<AnthropicTestResult> {
  const started = Date.now();
  const { log, lines } = createAnthropicLogger('anthropic');
  const route = anthropicRoute();
  const reportCfg = loadReportConfig(configDir);
  const model = (options.model || (reportCfg.provider === 'anthropic' ? reportCfg.model : 'claude-haiku-4-5-20251001')).trim();
  const baseUrl = (options.baseUrl || (reportCfg.provider === 'anthropic' ? reportCfg.baseUrl : undefined))?.trim();

  log('connectivity test started', `configDir=${configDir}`);
  log('runtime', `node=${process.version} platform=${process.platform}`);
  log('endpoint', baseUrl ? `custom ${baseUrl}` : 'official https://api.anthropic.com');
  log('route', route === 'proxy'
    ? `proxy via ${maskProxyUrl(getOptionalAnthropicProxyUrl()!)} (${anthropicProxySource()})`
    : 'direct — no proxy configured');

  if (!apiKey) {
    log('API key check', 'missing — add the key in Settings or config/runtime.json');
    return { ok: false, route, elapsedMs: Date.now() - started, error: 'ANTHROPIC_API_KEY is not configured', logs: lines };
  }

  log('API key check', `present (${apiKey.slice(0, 8)}…, length=${apiKey.length})`);
  log('report config loaded', `model=${model}`);

  try {
    if (!baseUrl) await probeAnthropicReachability(log);
    else log('reachability probe', 'skipped public Anthropic probe because a custom endpoint is selected');
    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS, log, baseUrl);
    log('calling Anthropic API', `model=${model} max_tokens=1`);
    const response = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    log('Anthropic API response received', `id=${response.id} stop_reason=${response.stop_reason ?? 'n/a'}`);
    const elapsedMs = Date.now() - started;
    log('connectivity test succeeded', `${elapsedMs}ms via ${route}`);
    return { ok: true, model, route, elapsedMs, logs: lines };
  } catch (err) {
    const error = formatError(err, model, route);
    log('Anthropic API error', describeFetchError(err));
    log('connectivity test failed', error);
    return { ok: false, model, route, elapsedMs: Date.now() - started, error, logs: lines };
  }
}

export async function testLlmConnection(selection: LlmSelectionInput, configDir: string): Promise<LlmTestResult> {
  const started = Date.now();
  const cfg = loadReportConfig(configDir);
  const provider = selection.provider || cfg.provider;
  const model = (selection.model || cfg.model).trim();
  const apiKey = resolveProviderApiKey(provider, selection.apiKey, process.env.ANTHROPIC_API_KEY);
  const baseUrl = selection.baseUrl || cfg.baseUrl;
  const providerLabel = LLM_PROVIDER_LABELS[provider];
  const logs = [`[llm] provider=${providerLabel}`, `[llm] model=${model}`, `[llm] endpoint=${baseUrl || 'official'}`];

  if (provider === 'anthropic') {
    const result = await testAnthropicConnection(apiKey, configDir, { baseUrl, model });
    return { ...result, provider, providerLabel };
  }

  if (!apiKey) {
    return {
      ok: false,
      provider,
      providerLabel,
      model,
      route: 'direct',
      elapsedMs: Date.now() - started,
      error: `${envKeyForProvider(provider)} is not configured for ${providerLabel}`,
      logs,
    };
  }

  try {
    logs.push('[llm] calling provider health prompt');
    await generateLlmText({
      provider,
      model,
      apiKey,
      baseUrl,
      maxTokens: 8,
      system: 'Reply with OK only.',
      prompt: 'ping',
      timeoutMs: TEST_TIMEOUT_MS,
    });
    logs.push('[llm] connectivity test succeeded');
    return { ok: true, provider, providerLabel, model, route: 'direct', elapsedMs: Date.now() - started, logs };
  } catch (err) {
    const raw = describeFetchError(err);
    const lower = raw.toLowerCase();
    let hint = networkHint(raw, 'direct');
    if (isHtmlSecurityBlock(raw)) hint = ' — the request returned an HTML security/proxy page instead of an LLM API response. Check the endpoint URL, VPN/Zscaler policy, proxy configuration, and gateway allowlisting.';
    else if (/401|authentication|unauthorized|api key/.test(lower)) hint = ` — check ${envKeyForProvider(provider)} or the key saved in Settings.`;
    else if (/429|quota|rate limit|exceeded/.test(lower)) hint = ' — quota/rate limit reached; select another provider/model/key.';
    else if (/model|not found|400|bad request/.test(lower)) hint = ` — check selected model "${model}".`;
    const error = `${raw.slice(0, 280)}${hint}`;
    logs.push(`[llm] connectivity test failed: ${error}`);
    return { ok: false, provider, providerLabel, model, route: 'direct', elapsedMs: Date.now() - started, error, logs };
  }
}
