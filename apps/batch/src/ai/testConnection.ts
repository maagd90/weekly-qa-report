import { createAnthropicClient, anthropicRoute } from './anthropicClient';
import { createAnthropicLogger } from './anthropicLog';
import { describeFetchError, probeAnthropicReachability } from './networkProbe';
import { getOptionalAnthropicProxyUrl, maskProxyUrl, anthropicProxySource } from './optionalProxy';
import { loadReportConfig } from '../config/loadReportConfig';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  route: 'direct' | 'proxy';
  elapsedMs?: number;
  error?: string;
  logs?: string[];
}

const TEST_TIMEOUT_MS = 25_000;

function formatError(err: unknown, model: string, route: 'direct' | 'proxy'): string {
  const raw = describeFetchError(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (/timed out|timeout|aborted|abort/.test(lower)) {
    hint = ' — request timed out reaching api.anthropic.com.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect/.test(lower)) {
    hint = route === 'proxy'
      ? ' — check ANTHROPIC_PROXY_URL in .env (host/port/auth).'
      : ' — Docker/office networks often block direct outbound HTTPS. Try ./run.sh dev on the host, or set ANTHROPIC_PROXY_URL in .env and restart Docker.';
  } else if (/self.signed|unable to verify|cert|unauthorized certificate|self signed/.test(lower)) {
    hint = route === 'proxy'
      ? ' — Zscaler/TLS-inspecting proxy without CA: set ANTHROPIC_PROXY_INSECURE_TLS=1 in .env, restart Docker, retry. Better long-term: get corporate CA from IT → NODE_EXTRA_CA_CERTS.'
      : ' — TLS certificate issue; on Zscaler set HTTPS_PROXY and ANTHROPIC_PROXY_INSECURE_TLS=1.';
  } else if (/401|authentication|invalid x-api-key|unauthorized/.test(lower)) {
    hint = ' — the API key is missing, invalid, or revoked. Rotate it and update .env.';
  } else if (/not_found_error|model|400|bad request/.test(lower)) {
    hint = ` — check the model name "${model}" in config/report.json / ANTHROPIC_MODEL.`;
  }
  return `${raw.slice(0, 280)}${hint}`;
}

/**
 * Live connectivity check for the Anthropic API. Makes a minimal 1-token call
 * and returns a structured result with step-by-step logs.
 */
export async function testAnthropicConnection(
  apiKey: string,
  configDir: string,
): Promise<AnthropicTestResult> {
  const started = Date.now();
  const { log, lines } = createAnthropicLogger('anthropic');
  const route = anthropicRoute();

  log('connectivity test started', `configDir=${configDir}`);
  log('runtime', `node=${process.version} platform=${process.platform}`);
  log('route', route === 'proxy'
    ? `proxy via ${maskProxyUrl(getOptionalAnthropicProxyUrl()!)} (${anthropicProxySource()})`
    : 'direct — set ANTHROPIC_PROXY_URL or HTTPS_PROXY in .env for Zscaler/office networks');

  if (!apiKey) {
    log('API key check', 'missing — set ANTHROPIC_API_KEY in .env');
    return {
      ok: false,
      route,
      elapsedMs: Date.now() - started,
      error: 'ANTHROPIC_API_KEY is not set in .env',
      logs: lines,
    };
  }

  log('API key check', `present (${apiKey.slice(0, 12)}…, length=${apiKey.length})`);

  const reportCfg = loadReportConfig(configDir);
  const model = reportCfg.model;
  log('report config loaded', `model=${model} maxTokens=${reportCfg.maxTokens}`);

  try {
    await probeAnthropicReachability(log);

    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS, log);
    log('calling Anthropic API', `POST /v1/messages model=${model} max_tokens=1`);

    const response = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });

    log(
      'Anthropic API response received',
      `id=${response.id} type=${response.type} stop_reason=${response.stop_reason ?? 'n/a'} ` +
      `input_tokens=${response.usage?.input_tokens ?? '?'} output_tokens=${response.usage?.output_tokens ?? '?'}`,
    );

    const elapsedMs = Date.now() - started;
    log('connectivity test succeeded', `${elapsedMs}ms via ${route}`);

    return { ok: true, model, route, elapsedMs, logs: lines };
  } catch (err) {
    const error = formatError(err, model, route);
    log('Anthropic API error', describeFetchError(err));
    log('connectivity test failed', error);

    return {
      ok: false,
      model,
      route,
      elapsedMs: Date.now() - started,
      error,
      logs: lines,
    };
  }
}
