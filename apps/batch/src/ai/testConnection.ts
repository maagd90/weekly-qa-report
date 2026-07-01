import { createAnthropicClient } from './anthropicClient';
import { createAnthropicLogger } from './anthropicLog';
import { loadReportConfig } from '../config/loadReportConfig';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  route: 'direct';
  elapsedMs?: number;
  error?: string;
  logs?: string[];
}

const TEST_TIMEOUT_MS = 25_000;

function formatError(err: unknown, model: string): string {
  const raw = (err as Error).message || String(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (/timed out|timeout|aborted|abort/.test(lower)) {
    hint = ' — request timed out; check network access to api.anthropic.com.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect/.test(lower)) {
    hint = ' — could not reach api.anthropic.com; verify internet access and firewall rules.';
  } else if (/self.signed|unable to verify|cert/.test(lower)) {
    hint = ' — TLS certificate verification failed.';
  } else if (/401|authentication|invalid x-api-key|unauthorized/.test(lower)) {
    hint = ' — the API key is missing, invalid, or revoked. Rotate it and update .env.';
  } else if (/not_found_error|model|400|bad request/.test(lower)) {
    hint = ` — check the model name "${model}" in config/report.json / ANTHROPIC_MODEL.`;
  }
  return `${raw.slice(0, 240)}${hint}`;
}

/**
 * Live connectivity check for the Anthropic API. Makes a minimal 1-token direct
 * call to api.anthropic.com and returns a structured result with step-by-step logs.
 */
export async function testAnthropicConnection(
  apiKey: string,
  configDir: string,
): Promise<AnthropicTestResult> {
  const started = Date.now();
  const { log, lines } = createAnthropicLogger('anthropic');

  log('connectivity test started', `configDir=${configDir}`);
  log('route', 'direct (no proxy)');

  if (!apiKey) {
    log('API key check', 'missing — set ANTHROPIC_API_KEY in .env');
    return {
      ok: false,
      route: 'direct',
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
    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS, log);
    log(
      'calling Anthropic API',
      `POST /v1/messages model=${model} max_tokens=1`,
    );

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
    log('connectivity test succeeded', `${elapsedMs}ms direct`);

    return {
      ok: true,
      model,
      route: 'direct',
      elapsedMs,
      logs: lines,
    };
  } catch (err) {
    const error = formatError(err, model);
    log('Anthropic API error', (err as Error).message || String(err));
    log('connectivity test failed', error);

    return {
      ok: false,
      model,
      route: 'direct',
      elapsedMs: Date.now() - started,
      error,
      logs: lines,
    };
  }
}
