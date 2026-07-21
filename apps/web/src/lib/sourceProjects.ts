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
