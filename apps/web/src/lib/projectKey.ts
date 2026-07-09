export function canonicalProjectKey(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'all') return 'all';
  return raw;
}

export function canonicalProjectOrAll(value?: string | null): string {
  return canonicalProjectKey(value) || 'all';
}

export function canonicalProjectOrUndefined(value?: string | null): string | undefined {
  const key = canonicalProjectKey(value);
  return key && key !== 'all' ? key : undefined;
}

export function uniqueCanonicalProjects(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(canonicalProjectKey).filter((p) => p && p !== 'all'))].sort();
}
