/**
 * Branded string types so a raw, unvalidated `string` can never silently
 * flow into a slot that expects an already-normalized project key. Values
 * of these types can only be produced by the normalize functions below (or
 * by an explicit, deliberate cast at a trusted boundary such as deserializing
 * previously-normalized data from disk).
 */
export type CanonicalProjectKey = string & { readonly __brand: 'CanonicalProjectKey' };
export type SourceProjectKey = string & { readonly __brand: 'SourceProjectKey' };

const PROJECT_ALIASES: Record<string, string> = {
  DLM: 'DLM',
  DN4_FT: 'DLM',
  'DN4 FT': 'DLM',
  'DN4_FT - SUPPLY & DMC': 'DLM',
  'DN4_FT- SUPPLY & DMC': 'DLM',
  'DN4 FT - SUPPLY & DMC': 'DLM',
  'SUPPLY & DMC': 'DLM',
  DP: 'DP',
  WONDERMILES: 'DP',
};

export function canonicalProjectKey(value?: string | null): CanonicalProjectKey {
  const raw = (value || '').trim();
  if (!raw) return '' as CanonicalProjectKey;
  if (raw.toLowerCase() === 'all') return 'all' as CanonicalProjectKey;
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  return (PROJECT_ALIASES[normalized] || normalized) as CanonicalProjectKey;
}

export function canonicalProjectOrUndefined(value?: string | null): CanonicalProjectKey | undefined {
  const key = canonicalProjectKey(value);
  return key && key !== 'all' ? key : undefined;
}

export function sameProjectKey(left?: string | null, right?: string | null): boolean {
  const a = canonicalProjectKey(left);
  const b = canonicalProjectKey(right);
  if (!a || a === 'all' || !b || b === 'all') return true;
  return a === b;
}

export function uniqueCanonicalProjects(values: Array<string | null | undefined>): CanonicalProjectKey[] {
  return [...new Set(values.map(canonicalProjectKey).filter((p) => p && p !== 'all'))].sort();
}

/** Normalize an external Jira/QMetry key without applying dashboard aliases. */
export function normalizeSourceProjectKey(value?: string | null): SourceProjectKey {
  return (value || '').trim().toUpperCase() as SourceProjectKey;
}

/**
 * Normalizes a dashboard project's own primary registry key without collapsing
 * it through the legacy PROJECT_ALIASES table. Use this (not canonicalProjectKey)
 * when creating or updating a project record, so a project can adopt any source
 * key as its own independent primary key instead of always merging into the
 * legacy alias target (e.g. DN4_FT no longer has to become DLM). canonicalProjectKey
 * remains the right choice for matching free-text project values found in already
 * imported/legacy datasets that predate the project registry.
 */
export function normalizeProjectPrimaryKey(value?: string | null): CanonicalProjectKey {
  const raw = (value || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return '' as CanonicalProjectKey;
  return raw.toUpperCase().replace(/\s+/g, ' ').trim() as CanonicalProjectKey;
}

export function uniqueSourceProjectKeys(values: Array<string | null | undefined>): SourceProjectKey[] {
  return [...new Set(values.map(normalizeSourceProjectKey).filter((key) => key && key !== 'ALL'))];
}

export function projectSourceKeys(project: { key: string; sourceKeys?: string[] }): SourceProjectKey[] {
  return uniqueSourceProjectKeys([project.key, ...(project.sourceKeys || [])]);
}

export function jiraProjectJql(projectKeys: string[]): string {
  const keys = uniqueSourceProjectKeys(projectKeys);
  const scope = keys.length === 1 ? `project = ${keys[0]}` : `project in (${keys.join(', ')})`;
  return `${scope} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
}

export function jqlProjectKeys(jql: string): SourceProjectKey[] {
  const equals = jql.match(/\bproject\s*=\s*(?:["']([^"']+)["']|([A-Z0-9_-]+))/i);
  if (equals) return uniqueSourceProjectKeys([equals[1] || equals[2]]);
  const inside = jql.match(/\bproject\s+in\s*\(([^)]+)\)/i)?.[1];
  if (!inside) return [];
  return uniqueSourceProjectKeys(inside.split(',').map((key) => key.replace(/^[\s"']+|[\s"']+$/g, '')));
}
