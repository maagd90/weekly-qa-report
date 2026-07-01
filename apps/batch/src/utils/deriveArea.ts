import { sanitizeText } from './excel';

const RULES: { pattern: RegExp; area: string }[] = [
  { pattern: /global dmc/i, area: 'Global DMC' },
  { pattern: /incident management/i, area: 'Incident Management' },
  { pattern: /reactive maintenance/i, area: 'Reactive Maintenance' },
  { pattern: /travel box release|tbx/i, area: 'Travel Box Release' },
  { pattern: /adhoc/i, area: 'Adhoc Tasks' },
  { pattern: /\bsit\b/i, area: 'SIT' },
  { pattern: /\buat\b/i, area: 'UAT Sign-off' },
];

export function deriveArea(summary: string): string {
  const text = sanitizeText(summary);
  for (const { pattern, area } of RULES) {
    if (pattern.test(text)) return area;
  }
  return 'Other / Misc';
}
