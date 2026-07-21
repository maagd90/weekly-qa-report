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

export function canonicalProjectKey(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'all') return 'all';
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  return PROJECT_ALIASES[normalized] || normalized;
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

/** Normalize an external Jira/QMetry key without applying dashboard aliases. */
export function normalizeSourceProjectKey(value?: string | null): string {
  return (value || '').trim().toUpperCase();
}

export function uniqueSourceProjectKeys(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(normalizeSourceProjectKey).filter((key) => key && key !== 'ALL'))];
}

export function projectSourceKeys(project: { key: string; sourceKeys?: string[] }): string[] {
  return uniqueSourceProjectKeys([project.key, ...(project.sourceKeys || [])]);
}

export function jiraProjectJql(projectKeys: string[]): string {
  const keys = uniqueSourceProjectKeys(projectKeys);
  const scope = keys.length === 1 ? `project = ${keys[0]}` : `project in (${keys.join(', ')})`;
  return `${scope} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
}

export function jqlProjectKeys(jql: string): string[] {
  const equals = jql.match(/\bproject\s*=\s*(?:["']([^"']+)["']|([A-Z0-9_-]+))/i);
  if (equals) return uniqueSourceProjectKeys([equals[1] || equals[2]]);
  const inside = jql.match(/\bproject\s+in\s*\(([^)]+)\)/i)?.[1];
  if (!inside) return [];
  return uniqueSourceProjectKeys(inside.split(',').map((key) => key.replace(/^[\s"']+|[\s"']+$/g, '')));
}
