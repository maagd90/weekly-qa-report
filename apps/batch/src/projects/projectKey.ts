const SOURCE_PROJECT_ALIASES: Record<string, string> = {
  DLM: 'DLM',
  DN4_FT: 'DLM',
  'DN4 FT': 'DLM',
  'DN4_FT - SUPPLY & DMC': 'DLM',
  'DN4_FT- SUPPLY & DMC': 'DLM',
  'DN4 FT - SUPPLY & DMC': 'DLM',
  'SUPPLY & DMC': 'DLM',
};

export function canonicalProjectKey(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'all') return 'all';

  const normalizedSourceKey = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const aliasedSourceKey = SOURCE_PROJECT_ALIASES[normalizedSourceKey];
  if (aliasedSourceKey) return aliasedSourceKey;

  // Workspace identities are generated as lowercase slugs from connection names.
  // Preserve them so UI values, folders, filters and report scope use one stable id.
  if (raw === raw.toLowerCase() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return raw;

  // Technical JIRA/QMetry keys remain case-insensitive and canonical uppercase.
  return normalizedSourceKey;
}

export function canonicalProjectOrUndefined(value?: string | null): string | undefined {
  const key = canonicalProjectKey(value);
  return key && key !== 'all' ? key : undefined;
}

export function sameProjectKey(left?: string | null, right?: string | null): boolean {
  const a = canonicalProjectKey(left);
  const b = canonicalProjectKey(right);
  if (!a || a === 'all' || !b || b === 'all') return true;
  return a === b;
}

export function uniqueCanonicalProjects(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(canonicalProjectKey).filter((p) => p && p !== 'all'))].sort();
}
