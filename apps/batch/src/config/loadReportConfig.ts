import fs from 'fs';
import path from 'path';

export interface AnthropicProxyConfig {
  enabled: boolean;
  url: string;
}

export interface ReportConfig {
  model: string;
  maxTokens: number;
  proxy: AnthropicProxyConfig;
}

const DEFAULTS: ReportConfig = {
  model: 'claude-sonnet-4-6',
  maxTokens: 768,
  proxy: { enabled: false, url: '' },
};

function parseProxy(raw: unknown): AnthropicProxyConfig {
  if (!raw || typeof raw !== 'object') return DEFAULTS.proxy;
  const p = raw as { enabled?: unknown; url?: unknown };
  return {
    enabled: p.enabled === true,
    url: typeof p.url === 'string' ? p.url.trim() : '',
  };
}

/** Precedence: ANTHROPIC_MODEL env > config/report.json > default. */
export function loadReportConfig(configDir: string): ReportConfig {
  const file = path.join(configDir, 'report.json');
  let fromFile: Partial<ReportConfig> & { proxy?: unknown } = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ReportConfig> & { proxy?: unknown };
    } catch {
      /* keep defaults on malformed JSON */
    }
  }
  return {
    model: (process.env.ANTHROPIC_MODEL || fromFile.model || DEFAULTS.model).trim(),
    maxTokens: typeof fromFile.maxTokens === 'number' && fromFile.maxTokens > 0
      ? fromFile.maxTokens
      : DEFAULTS.maxTokens,
    proxy: parseProxy(fromFile.proxy),
  };
}
