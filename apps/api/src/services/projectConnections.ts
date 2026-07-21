import { canonicalProjectKey } from 'qa-dashboard-batch';
import type {
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

function jiraProjectJql(projectKey: string): string {
  return `project = ${projectKey} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
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
  const projectsByKey = new Map(projects.map((project) => [project.key, project]));
  const jira = validateOnePerProject(connections.jira, 'JIRA', projectsById, projectsByKey, (connection, project) => {
    const keys = [...new Set((connection.projectKeys || []).map(canonicalProjectKey).filter(Boolean))];
    if (keys.length !== 1 || keys[0] !== project.key) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, 'JIRA')} must use the owning project key ${project.key}.`,
      );
    }
    return { ...connection, workspaceProjectId: project.id, projectKeys: [project.key], jql: jiraProjectJql(project.key) };
  });
  const qmetry = validateOnePerProject(connections.qmetry, 'QMetry', projectsById, projectsByKey, (connection, project) => {
    if (canonicalProjectKey(connection.projectKey) !== project.key) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, 'QMetry')} must use the owning project key ${project.key}.`,
      );
    }
    return { ...connection, workspaceProjectId: project.id, projectKey: project.key };
  });
  return { jira, qmetry };
}
