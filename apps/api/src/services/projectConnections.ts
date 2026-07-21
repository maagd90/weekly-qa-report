import { canonicalProjectKey } from 'qa-dashboard-batch';
import type {
  Dataset,
  JiraConnectionInput,
  QmetryConnectionInput,
  UserConnections,
} from 'qa-dashboard-batch';
import type { ProjectRecord } from './projectImports';

type ConnectionKind = 'JIRA' | 'QMetry';
type ProjectConnection = JiraConnectionInput | QmetryConnectionInput;

export class ProjectConnectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConnectionValidationError';
  }
}

function connectionLabel(connection: ProjectConnection, kind: ConnectionKind): string {
  return (connection.name || '').trim() || `${kind} connection`;
}

function jiraProjectJql(projectKeys: string[]): string {
  const scope = projectKeys.length === 1 ? `project = ${projectKeys[0]}` : `project in (${projectKeys.join(', ')})`;
  return `${scope} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
}

function projectSourceKeys(project: ProjectRecord): string[] {
  return [...new Set([project.key, ...(project.sourceKeys || [])].map(canonicalProjectKey).filter(Boolean))];
}

function jqlProjectKeys(jql: string): string[] {
  const equals = jql.match(/\bproject\s*=\s*(?:["']([^"']+)["']|([A-Z0-9_-]+))/i);
  if (equals) return [canonicalProjectKey(equals[1] || equals[2])].filter(Boolean);
  const inside = jql.match(/\bproject\s+in\s*\(([^)]+)\)/i)?.[1];
  if (!inside) return [];
  return [...new Set(inside.split(',').map((key) => canonicalProjectKey(key.replace(/^[\s"']+|[\s"']+$/g, ''))).filter(Boolean))];
}

function scopedJiraJql(jql: string | undefined, project: ProjectRecord): string {
  const allowed = projectSourceKeys(project);
  const normalized = (jql || '').trim() || jiraProjectJql(allowed);
  const configured = jqlProjectKeys(normalized);
  const allowedSet = new Set(allowed);
  if (configured.length !== allowed.length || configured.some((key) => !allowedSet.has(key))) {
    throw new ProjectConnectionValidationError(
      `JIRA JQL for project ${project.key} must be scoped to configured source keys: ${allowed.join(', ')}.`,
    );
  }
  return normalized;
}

function owningProject(
  connection: ProjectConnection,
  kind: ConnectionKind,
  projectsById: Map<string, ProjectRecord>,
  projectsByKey: Map<string, ProjectRecord>,
): ProjectRecord {
  const workspaceProjectId = (connection.workspaceProjectId || '').trim();
  if (!workspaceProjectId) {
    const legacyKey = kind === 'JIRA'
      ? canonicalProjectKey((connection as JiraConnectionInput).projectKeys?.[0])
      : canonicalProjectKey((connection as QmetryConnectionInput).projectKey);
    const migratedProject = legacyKey ? projectsByKey.get(legacyKey) : undefined;
    if (migratedProject) return migratedProject;
    throw new ProjectConnectionValidationError(
      `${connectionLabel(connection, kind)} must be assigned to an existing dashboard project. Create or select the project first.`,
    );
  }
  const project = projectsById.get(workspaceProjectId);
  if (!project) {
    throw new ProjectConnectionValidationError(
      `${connectionLabel(connection, kind)} references a dashboard project that no longer exists. Select an existing project.`,
    );
  }
  return project;
}

function validateConnectionIds(connections: ProjectConnection[], kind: ConnectionKind): void {
  const seen = new Set<string>();
  for (const connection of connections) {
    const id = (connection.id || '').trim();
    if (!id) throw new ProjectConnectionValidationError(`${kind} connection ID is required.`);
    if (seen.has(id)) throw new ProjectConnectionValidationError(`Duplicate ${kind} connection ID ${id} is not allowed.`);
    seen.add(id);
  }
}

function validateOnePerProject<T extends ProjectConnection>(
  connections: T[],
  kind: ConnectionKind,
  projectsById: Map<string, ProjectRecord>,
  projectsByKey: Map<string, ProjectRecord>,
  normalize: (connection: T, project: ProjectRecord) => T,
): T[] {
  validateConnectionIds(connections, kind);
  const assignedProjects = new Set<string>();
  return connections.map((connection) => {
    const project = owningProject(connection, kind, projectsById, projectsByKey);
    if (assignedProjects.has(project.id)) {
      throw new ProjectConnectionValidationError(
        `Project ${project.key} already has a ${kind} connection. Only one ${kind} connection is allowed per project.`,
      );
    }
    assignedProjects.add(project.id);
    return normalize(connection, project);
  });
}

/**
 * Enforces the dashboard ownership boundary for browser-supplied live connections.
 * Every connection belongs to one existing project, and every project can own at
 * most one connection of each type.
 */
export function validateProjectConnections(
  connections: UserConnections,
  projects: ProjectRecord[],
): UserConnections {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectsByKey = new Map(projects.flatMap((project) => projectSourceKeys(project).map((key) => [key, project] as const)));
  const jira = validateOnePerProject(connections.jira, 'JIRA', projectsById, projectsByKey, (connection, project) => {
    const keys = [...new Set((connection.projectKeys || []).map(canonicalProjectKey).filter(Boolean))];
    const allowed = projectSourceKeys(project);
    const allowedSet = new Set(allowed);
    if (keys.length !== allowed.length || keys.some((key) => !allowedSet.has(key))) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, 'JIRA')} must use the owning project's configured source keys: ${allowed.join(', ')}.`,
      );
    }
    return { ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKeys: allowed, jql: scopedJiraJql(connection.jql, project) };
  });
  const qmetry = validateOnePerProject(connections.qmetry, 'QMetry', projectsById, projectsByKey, (connection, project) => {
    const projectKey = canonicalProjectKey(connection.projectKey);
    const allowed = projectSourceKeys(project);
    if (!allowed.includes(projectKey)) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, 'QMetry')} must use one of the owning project's configured source keys: ${allowed.join(', ')}.`,
      );
    }
    return { ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKey };
  });
  return { jira, qmetry };
}

/** Consolidates external source keys into the owning dashboard project's primary key. */
export function normalizeDatasetProjectOwnership(dataset: Dataset, projects: ProjectRecord[]): Dataset {
  const owners = new Map(projects.flatMap((project) => projectSourceKeys(project).map((key) => [key, project.key] as const)));
  const ownerKey = (value?: string) => owners.get(canonicalProjectKey(value)) || canonicalProjectKey(value);
  const executions = dataset.executions.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const issues = dataset.issues.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const uat = dataset.uat.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const files = dataset.files.map((file) => ({ ...file, project: ownerKey(file.project) }));
  const sourceProjects = [...executions.map((row) => row.project), ...issues.map((row) => row.project), ...uat.map((row) => row.project), ...files.map((file) => file.project)];
  return { ...dataset, executions, issues, uat, files, projects: [...new Set(sourceProjects.filter(Boolean))].sort() };
}
