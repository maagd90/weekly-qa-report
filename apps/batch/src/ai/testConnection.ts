import { createAnthropicClient } from './anthropicClient';
import { createAnthropicLogger } from './anthropicLog';
import { resolveAnthropicProxy } from './proxy';
import { loadReportConfig } from '../config/loadReportConfig';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  proxyUsed: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string;
  route?: 'direct' | 'proxy';
  elapsedMs?: number;
  error?: string;
  logs?: string[];
}

const TEST_TIMEOUT_MS = 25_000;

function formatError(err: unknown, proxyUsed: boolean, model: string): string {
  const raw = (err as Error).message || String(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (/timed out|timeout|aborted|abort/.test(lower)) {
    hint = proxyUsed
      ? ' — request timed out via proxy; verify proxy.url / HTTPS_PROXY and that the proxy allows api.anthropic.com.'
      : ' — request timed out; check network access to api.anthropic.com.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect/.test(lower)) {
    hint = proxyUsed
      ? ' — proxy is enabled but the connection failed; check proxy.url or HTTPS_PROXY in .env.'
      : ' — could not reach api.anthropic.com. On an office network set proxy.enabled=true in config/report.json.';
  } else if (/self.signed|unable to verify|cert/.test(lower)) {
    hint = ' — TLS-inspecting proxy; set NODE_EXTRA_CA_CERTS to your corporate CA .pem.';
  } else if (/401|authentication|invalid x-api-key|unauthorized/.test(lower)) {
    hint = ' — the API key is missing, invalid, or revoked. Rotate it and update .env.';
  } else if (/not_found_error|model|400|bad request/.test(lower)) {
    hint = ` — check the model name "${model}" in config/report.json / ANTHROPIC_MODEL.`;
  }
  return `${raw.slice(0, 240)}${hint}`;
}

/**
 * Live connectivity check for the Anthropic API. Makes a minimal 1-token call
 * through the configured proxy (only when proxy.enabled in config/report.json),
 * which validates key + proxy + model + TLS. Returns a structured result with logs.
 */
export async function testAnthropicConnection(
  apiKey: string,
  configDir: string,
): Promise<AnthropicTestResult> {
  const started = Date.now();
  const { log, lines } = createAnthropicLogger('anthropic');

  log('connectivity test started', `configDir=${configDir}`);

  const proxyResolution = resolveAnthropicProxy(configDir, log);
  const proxyUsed = proxyResolution.active;
  const route: 'direct' | 'proxy' = proxyUsed ? 'proxy' : 'direct';

  log('API key check', apiKey ? `present (${apiKey.slice(0, 12)}…)` : 'missing');

  if (!apiKey) {
    const result: AnthropicTestResult = {
      ok: false,
      proxyUsed: false,
      proxyEnabled: proxyResolution.configEnabled,
      route: 'direct',
      elapsedMs: Date.now() - started,
      error: 'ANTHROPIC_API_KEY is not set in .env',
      logs: lines,
    };
    log('connectivity test failed', result.error);
    return result;
  }

  const model = loadReportConfig(configDir).model;
  log('report config loaded', `model=${model} maxTokens=${loadReportConfig(configDir).maxTokens}`);

  try {
    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS, configDir, log, proxyResolution);
    log(
      'calling Anthropic API',
      `POST /v1/messages model=${model} max_tokens=1 route=${route}`,
    );

    const response = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });

    log(
      'Anthropic API response',
      `id=${response.id} stop_reason=${response.stop_reason ?? 'n/a'} usage=${JSON.stringify(response.usage)}`,
    );

    const result: AnthropicTestResult = {
      ok: true,
      model,
      proxyUsed,
      proxyEnabled: proxyResolution.configEnabled,
      proxyUrl: proxyResolution.maskedUrl,
      route,
      elapsedMs: Date.now() - started,
      logs: lines,
    };
    log('connectivity test succeeded', `${result.elapsedMs}ms via ${route}`);
    return result;
  } catch (err) {
    const error = formatError(err, proxyUsed, model);
    log('Anthropic API error', (err as Error).message || String(err));
    const result: AnthropicTestResult = {
      ok: false,
      model,
      proxyUsed,
      proxyEnabled: proxyResolution.configEnabled,
      proxyUrl: proxyResolution.maskedUrl,
      route,
      elapsedMs: Date.now() - started,
      error,
      logs: lines,
    };
    log('connectivity test failed', error);
    return result;
  }
}
