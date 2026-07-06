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

const TEST_TIMEOUT_MS = 25_000;

function formatError(err: unknown, model: string, route: 'direct' | 'proxy'): string {
  const raw = describeFetchError(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (/timed out|timeout|aborted|abort/.test(lower)) {
    hint = ' — request timed out.';
  } else if (/self.signed|self-signed|unable to verify|cert|unauthorized certificate/.test(lower)) {
    hint = route === 'proxy'
      ? ' — office proxy TLS issue; keep integrationAllowSelfSignedCerts=true in config/runtime.json.'
      : ' — office network TLS issue; configure officeProxyUrl in config/runtime.json.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect/.test(lower)) {
    hint = route === 'proxy'
      ? ' — check officeProxyUrl in config/runtime.json.'
      : ' — Docker/office networks may block direct outbound HTTPS. Configure officeProxyUrl in config/runtime.json.';
  } else if (/401|authentication|invalid x-api-key|unauthorized/.test(lower)) {
    hint = ' — key is missing, invalid, or revoked.';
  } else if (/not_found_error|model|400|bad request/.test(lower)) {
    hint = ` — check the model name "${model}".`;
  }
  return `${raw.slice(0, 280)}${hint}`;
}

export async function testAnthropicConnection(apiKey: string, configDir: string): Promise<AnthropicTestResult> {
  const started = Date.now();
  const { log, lines } = createAnthropicLogger('anthropic');
  const route = anthropicRoute();

  log('connectivity test started', `configDir=${configDir}`);
  log('runtime', `node=${process.version} platform=${process.platform}`);
  log('route', route === 'proxy'
    ? `proxy via ${maskProxyUrl(getOptionalAnthropicProxyUrl()!)} (${anthropicProxySource()})`
    : 'direct — set officeProxyUrl in config/runtime.json for office networks');

  if (!apiKey) {
    log('API key check', 'missing — add the key in Settings or config/runtime.json');
    return { ok: false, route, elapsedMs: Date.now() - started, error: 'ANTHROPIC_API_KEY is not configured', logs: lines };
  }

  log('API key check', `present (${apiKey.slice(0, 8)}…, length=${apiKey.length})`);
  const reportCfg = loadReportConfig(configDir);
  const model = reportCfg.provider === 'anthropic' ? reportCfg.model : 'claude-haiku-4-5-20251001';
  log('report config loaded', `model=${model}`);

  try {
    await probeAnthropicReachability(log);
    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS, log);
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
  const userKey = provider === 'anthropic' ? selection.apiKey : selection.apiKey;
  const apiKey = resolveProviderApiKey(provider, userKey, process.env.ANTHROPIC_API_KEY);
  const baseUrl = selection.baseUrl || cfg.baseUrl;
  const providerLabel = LLM_PROVIDER_LABELS[provider];
  const logs = [`[llm] provider=${providerLabel}`, `[llm] model=${model}`];

  if (provider === 'anthropic') {
    const result = await testAnthropicConnection(apiKey, configDir);
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
    let hint = '';
    if (/401|authentication|unauthorized|api key/.test(lower)) hint = ` — check ${envKeyForProvider(provider)} or the key saved in Settings.`;
    if (/429|quota|rate limit|exceeded/.test(lower)) hint = ' — quota/rate limit reached; select another provider/model/key.';
    if (/model|not found|400|bad request/.test(lower)) hint = ` — check selected model "${model}".`;
    const error = `${raw.slice(0, 280)}${hint}`;
    logs.push(`[llm] connectivity test failed: ${error}`);
    return { ok: false, provider, providerLabel, model, route: 'direct', elapsedMs: Date.now() - started, error, logs };
  }
}
