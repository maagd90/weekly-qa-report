import fs from 'fs';
import path from 'path';

export interface ReportConfig {
  model: string;
  maxTokens: number;
}

const DEFAULTS: ReportConfig = { model: 'claude-sonnet-4-6', maxTokens: 768 };

/** Precedence: ANTHROPIC_MODEL env > config/report.json > default. */
export function loadReportConfig(configDir: string): ReportConfig {
  const file = path.join(configDir, 'report.json');
  let fromFile: Partial<ReportConfig> = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ReportConfig>;
    } catch {
      /* keep defaults on malformed JSON */
    }
  }
  return {
    model: (process.env.ANTHROPIC_MODEL || fromFile.model || DEFAULTS.model).trim(),
    maxTokens: typeof fromFile.maxTokens === 'number' && fromFile.maxTokens > 0
      ? fromFile.maxTokens
      : DEFAULTS.maxTokens,
  };
}
