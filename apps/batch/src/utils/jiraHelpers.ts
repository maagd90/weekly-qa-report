import { sanitizeText } from './excel';

export function mapIssueType(raw: unknown): 'Story' | 'Bug' | null {
  const name = typeof raw === 'object' && raw !== null && 'name' in raw
    ? (raw as { name?: unknown }).name
    : raw;
  const t = sanitizeText(name);
  if (t === 'Story') return 'Story';
  if (t === 'Bug') return 'Bug';
  return null;
}

/** ISO date from JIRA API string — never defaults to epoch */
export function isoDateFromApi(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw);
  return s.length >= 10 ? s.slice(0, 10) : null;
}
