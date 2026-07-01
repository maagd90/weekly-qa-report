import { createAnthropicClient } from './anthropicClient';
import { getAnthropicProxyInfo } from './proxy';
import { loadReportConfig } from '../config/loadReportConfig';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  proxyUsed: boolean;
  proxyUrl?: string;
  elapsedMs?: number;
  error?: string;
}

const TEST_TIMEOUT_MS = 25_000;

function formatError(err: unknown, proxyUsed: boolean, model: string): string {
  const raw = (err as Error).message || String(err);
  const lower = raw.toLowerCase();
  let hint = '';
  if (/timed out|timeout|aborted|abort/.test(lower)) {
    hint = proxyUsed
      ? ' — request timed out via proxy; verify HTTPS_PROXY host/port and that the proxy allows api.anthropic.com.'
      : ' — request timed out; check network access to api.anthropic.com or set HTTPS_PROXY in .env.';
  } else if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket|connect/.test(lower)) {
    hint = proxyUsed
      ? ' — proxy is set but the connection failed; check the HTTPS_PROXY host/port.'
      : ' — could not reach api.anthropic.com; on an office network set HTTPS_PROXY in .env.';
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
 * through the configured proxy (if any), which validates key + proxy + model +
 * TLS all at once. Returns a structured result rather than throwing.
 */
export async function testAnthropicConnection(
  apiKey: string,
  configDir: string,
): Promise<AnthropicTestResult> {
  const started = Date.now();
  const proxyInfo = getAnthropicProxyInfo();
  const proxyUsed = proxyInfo.configured;

  console.log(
    `[anthropic] connectivity test starting — proxy: ${proxyUsed ? proxyInfo.masked : 'none (direct)'}`,
  );

  if (!apiKey) {
    const result: AnthropicTestResult = {
      ok: false,
      proxyUsed,
      proxyUrl: proxyInfo.masked,
      elapsedMs: Date.now() - started,
      error: 'ANTHROPIC_API_KEY is not set in .env',
    };
    console.log('[anthropic] connectivity test failed:', result.error);
    return result;
  }

  const model = loadReportConfig(configDir).model;

  try {
    const client = createAnthropicClient(apiKey, TEST_TIMEOUT_MS);
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    const result: AnthropicTestResult = {
      ok: true,
      model,
      proxyUsed,
      proxyUrl: proxyInfo.masked,
      elapsedMs: Date.now() - started,
    };
    console.log(
      `[anthropic] connectivity test ok — model ${model}, ${result.elapsedMs}ms${proxyUsed ? ', via proxy' : ', direct'}`,
    );
    return result;
  } catch (err) {
    const error = formatError(err, proxyUsed, model);
    const result: AnthropicTestResult = {
      ok: false,
      model,
      proxyUsed,
      proxyUrl: proxyInfo.masked,
      elapsedMs: Date.now() - started,
      error,
    };
    console.warn('[anthropic] connectivity test failed:', error);
    return result;
  }
}
