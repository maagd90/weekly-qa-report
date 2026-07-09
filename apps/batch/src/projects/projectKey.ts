export function canonicalProjectKey(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'all') return 'all';
  return raw.toUpperCase().replace(/\s+/g, ' ').trim();
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
