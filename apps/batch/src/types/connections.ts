export type JiraDeploymentType = 'cloud' | 'on-prem';
export type JiraAuthType = 'basic' | 'bearer';

export interface JiraConnectionInput {
  id: string;
  /** Internal QA Dashboard project that owns this connection. */
  workspaceProjectId?: string;
  /** Canonical dashboard key used to scope this connection after source-key consolidation. */
  workspaceProjectKey?: string;
  name: string;
  baseUrl: string;
  enabled?: boolean;
  syncIssues?: boolean;
  deploymentType?: JiraDeploymentType;
  authType?: JiraAuthType;
  email: string;
  username?: string;
  apiToken?: string;
  credential?: string;
  cookie?: string;
  jiraSessionId?: string;
  jiraXsrfToken?: string;
  searchPath?: string;
  projectKeys: string[];
  jql?: string;
  applicationCiFieldId?: string;
}

export interface QmetryConnectionInput {
  id: string;
  /** Internal QA Dashboard project that owns this connection. */
  workspaceProjectId?: string;
  /** Canonical dashboard key used to scope this connection after source-key consolidation. */
  workspaceProjectKey?: string;
  name: string;
  baseUrl: string;
  enabled?: boolean;
  syncExecutions?: boolean;
  email: string;
  apiToken?: string;
  credential?: string;
  sessionHeader?: string;
  sessionId?: string;
  xsrfToken?: string;
  projectKey: string;
  projectId?: string;
  cycleIds?: string[];
  folderId?: string;
}

export interface UserConnections {
  jira: JiraConnectionInput[];
  qmetry: QmetryConnectionInput[];
}

export function emptyConnections(): UserConnections {
  return { jira: [], qmetry: [] };
}

export function hasJiraAuthMaterial(connection: JiraConnectionInput): boolean {
  return Boolean(
    (connection.apiToken || connection.credential || connection.cookie || connection.jiraSessionId || connection.jiraXsrfToken || '').trim(),
  );
}

export function hasQmetryAuthMaterial(connection: QmetryConnectionInput): boolean {
  return Boolean(
    (connection.apiToken || connection.credential || connection.sessionHeader || connection.sessionId || connection.xsrfToken || '').trim(),
  );
}

export function isBlankJiraConnection(connection: JiraConnectionInput): boolean {
  return !(connection.baseUrl || '').trim() && !hasJiraAuthMaterial(connection);
}

export function isBlankQmetryConnection(connection: QmetryConnectionInput): boolean {
  return !(connection.baseUrl || '').trim() && !hasQmetryAuthMaterial(connection);
}

export function isUsableJiraConnection(connection: JiraConnectionInput): boolean {
  return connection.enabled !== false
    && connection.syncIssues !== false
    && Boolean(connection.baseUrl.trim())
    && hasJiraAuthMaterial(connection);
}

export function isUsableQmetryConnection(connection: QmetryConnectionInput): boolean {
  return connection.enabled !== false
    && connection.syncExecutions !== false
    && Boolean(connection.baseUrl.trim())
    && hasQmetryAuthMaterial(connection);
}
