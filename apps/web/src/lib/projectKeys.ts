/**
 * Browser-side project key helpers. Kept separate from `qa-dashboard-batch`
 * because that package's runtime module graph pulls in Node-only integrations
 * (fs, axios clients, etc.) that are unsafe to bundle for the browser; only
 * `import type` usages of that package are safe here. This file intentionally
 * mirrors the pure string logic in apps/batch/src/projects/projectKey.ts —
 * keep both in sync when the alias table or key-normalization rules change.
 */

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
