import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicFetchOptions } from './proxy';
import { loadReportConfig } from '../config/loadReportConfig';

export interface AnthropicTestResult {
  ok: boolean;
  model?: string;
  proxyUsed: boolean;
  error?: string;
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
  const fetchOptions = getAnthropicFetchOptions();
  const proxyUsed = fetchOptions !== undefined;

  if (!apiKey) {
    return { ok: false, proxyUsed, error: 'ANTHROPIC_API_KEY is not set in .env' };
  }

  const model = loadReportConfig(configDir).model;

  try {
    const client = new Anthropic({ apiKey, ...(fetchOptions ? { fetchOptions } : {}) });
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, model, proxyUsed };
  } catch (err) {
    const raw = (err as Error).message || String(err);
    const lower = raw.toLowerCase();
    let hint = '';
    if (/connection error|fetch failed|econnrefused|etimedout|enotfound|eai_again|socket/.test(lower)) {
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
    return { ok: false, model, proxyUsed, error: `${raw.slice(0, 240)}${hint}` };
  }
}
