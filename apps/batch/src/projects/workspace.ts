import type { Dataset } from '../types/dataset';
import type { JiraConnectionInput, QmetryConnectionInput, UserConnections } from '../types/connections';
import { canonicalProjectKey } from './projectKey';

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

export function workspaceDisplayName(workspaceId?: string | null, connections?: UserConnections): string {
  if (!workspaceId || workspaceId === 'all') return 'All projects';
  const fromConn = listWorkspaces(connections).find((w) => w.id === workspaceId)?.name;
  return fromConn || workspaceId;
}

function addUnique(target: string[], value?: string | null): void {
  const clean = (value || '').trim();
  if (clean && !target.includes(clean)) target.push(clean);
}

function workspaceForConnection(conn: JiraConnectionInput | QmetryConnectionInput): { id: string; name: string } | null {
  const name = workspaceNameFromConnection(conn);
  const id = workspaceIdFromName(name);
  return id ? { id, name } : null;
}

export function listWorkspaces(connections?: UserConnections): ProjectWorkspace[] {
  const map = new Map<string, ProjectWorkspace>();
  const ensure = (id: string, name: string) => {
    if (!map.has(id)) map.set(id, { id, name, jiraConnectionIds: [], qmetryConnectionIds: [], jiraProjectKeys: [], qmetryProjectKeys: [] });
    return map.get(id)!;
  };
  for (const conn of connections?.jira || []) {
    const ws = workspaceForConnection(conn);
    if (!ws) continue;
    const item = ensure(ws.id, ws.name);
    addUnique(item.jiraConnectionIds, conn.id);
    for (const key of conn.projectKeys || []) addUnique(item.jiraProjectKeys, canonicalProjectKey(key));
  }
  for (const conn of connections?.qmetry || []) {
    const ws = workspaceForConnection(conn);
    if (!ws) continue;
    const item = ensure(ws.id, ws.name);
    addUnique(item.qmetryConnectionIds, conn.id);
    addUnique(item.qmetryProjectKeys, canonicalProjectKey(conn.projectKey));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterConnectionsForWorkspace(connections: UserConnections, workspaceId?: string | null): UserConnections {
  const id = workspaceIdFromName(workspaceId) || workspaceId || '';
  if (!id || id === 'all') return connections;
  return {
    jira: connections.jira.filter((conn) => workspaceIdFromName(workspaceNameFromConnection(conn)) === id),
    qmetry: connections.qmetry.filter((conn) => workspaceIdFromName(workspaceNameFromConnection(conn)) === id),
  };
}

export function stampDatasetWorkspace(dataset: Dataset, workspaceId?: string | null): Dataset {
  const id = workspaceIdFromName(workspaceId) || workspaceId || '';
  if (!id || id === 'all') return dataset;
  return {
    ...dataset,
    executions: dataset.executions.map((row) => ({ ...row, project: id })),
    issues: dataset.issues.map((row) => ({ ...row, project: id })),
    uat: dataset.uat.map((row) => ({ ...row, project: id })),
    files: dataset.files.map((row) => ({ ...row, project: id })),
    projects: [id],
  };
}
