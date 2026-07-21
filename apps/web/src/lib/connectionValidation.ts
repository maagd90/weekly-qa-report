import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';

export function hasJiraAuthMaterial(connection: JiraConnectionInput): boolean {
  return Boolean((connection.apiToken || connection.credential || connection.cookie || connection.jiraSessionId || connection.jiraXsrfToken || '').trim());
}

export function hasQmetryAuthMaterial(connection: QmetryConnectionInput): boolean {
  return Boolean((connection.apiToken || connection.credential || connection.sessionHeader || connection.sessionId || connection.xsrfToken || '').trim());
}

export function isBlankJiraConnection(connection: JiraConnectionInput): boolean {
  return !connection.baseUrl.trim() && !hasJiraAuthMaterial(connection);
}

export function isBlankQmetryConnection(connection: QmetryConnectionInput): boolean {
  return !connection.baseUrl.trim() && !hasQmetryAuthMaterial(connection);
}

export function isUsableJiraConnection(connection: JiraConnectionInput): boolean {
  return connection.enabled !== false && connection.syncIssues !== false && Boolean(connection.baseUrl.trim()) && hasJiraAuthMaterial(connection);
}

export function isUsableQmetryConnection(connection: QmetryConnectionInput): boolean {
  return connection.enabled !== false && connection.syncExecutions !== false && Boolean(connection.baseUrl.trim()) && hasQmetryAuthMaterial(connection);
}
