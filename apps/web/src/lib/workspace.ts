import type { JiraConnectionInput, QmetryConnectionInput, UserConnections } from 'qa-dashboard-batch';

export interface ProjectWorkspace {
  id: string;
  name: string;
  jiraConnectionIds: string[];
  qmetryConnectionIds: string[];
  jiraProjectKeys: string[];
  qmetryProjectKeys: string[];
}

export function workspaceNameFromConnection(conn: { workspaceName?: string; name?: string }): string {
  return (conn.workspaceName || conn.name || '').trim();
}

export function workspaceIdFromName(name?: string | null): string {
  const raw = (name || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return '';
  return raw.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '';
}

function addUnique(target: string[], value?: string | null): void {
  const clean = (value || '').trim();
  if (clean && !target.includes(clean)) target.push(clean);
}

function ensure(map: Map<string, ProjectWorkspace>, id: string, name: string): ProjectWorkspace {
  if (!map.has(id)) map.set(id, { id, name, jiraConnectionIds: [], qmetryConnectionIds: [], jiraProjectKeys: [], qmetryProjectKeys: [] });
  return map.get(id)!;
}

export function listWorkspaces(connections: Partial<UserConnections> = {}): ProjectWorkspace[] {
  const map = new Map<string, ProjectWorkspace>();
  for (const conn of connections.jira || []) {
    const name = workspaceNameFromConnection(conn);
    const id = workspaceIdFromName(name);
    if (!id) continue;
    const ws = ensure(map, id, name);
    addUnique(ws.jiraConnectionIds, conn.id);
    for (const key of conn.projectKeys || []) addUnique(ws.jiraProjectKeys, key.toUpperCase());
  }
  for (const conn of connections.qmetry || []) {
    const name = workspaceNameFromConnection(conn);
    const id = workspaceIdFromName(name);
    if (!id) continue;
    const ws = ensure(map, id, name);
    addUnique(ws.qmetryConnectionIds, conn.id);
    addUnique(ws.qmetryProjectKeys, conn.projectKey?.toUpperCase());
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function workspaceDisplayName(workspaceId?: string | null, workspaces: ProjectWorkspace[] = []): string {
  if (!workspaceId || workspaceId === 'all') return 'All projects';
  return workspaces.find((w) => w.id === workspaceId)?.name || workspaceId;
}

export function workspaceMatchesConnection(workspaceId: string | undefined, conn: JiraConnectionInput | QmetryConnectionInput): boolean {
  if (!workspaceId || workspaceId === 'all') return true;
  return workspaceIdFromName(workspaceNameFromConnection(conn)) === workspaceId;
}
