import {
  canonicalProjectKey,
  hasJiraAuthMaterial,
  hasQmetryAuthMaterial,
  isBlankJiraConnection,
  isBlankQmetryConnection,
  jiraProjectJql,
  jqlProjectKeys,
  normalizeSourceProjectKey,
  projectSourceKeys,
} from 'qa-dashboard-batch';
import type {
  Dataset,
  JiraConnectionInput,
  QmetryConnectionInput,
  UserConnections,
} from 'qa-dashboard-batch';
import type { ProjectRecord } from './projectImports';

type ConnectionKind = 'JIRA' | 'QMetry';
type ProjectConnection = JiraConnectionInput | QmetryConnectionInput;

export interface ConnectionMigrationProject {
  key: string;
  sourceKeys: string[];
  name: string;
  jiraConnectionId?: string;
  qmetryConnectionId?: string;
}

export class ProjectConnectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConnectionValidationError';
  }
}

function connectionLabel(connection: ProjectConnection, kind: ConnectionKind): string {
  return (connection.name || '').trim() || `${kind} connection`;
}

export function planConnectionProjectMigration(connections: UserConnections): ConnectionMigrationProject[] {
  validateConnectionIds(connections.jira, 'JIRA');
  validateConnectionIds(connections.qmetry, 'QMetry');
  const groups = new Map<string, ConnectionMigrationProject>();

  const addConnection = (
    connection: ProjectConnection,
    kind: ConnectionKind,
    rawSourceKeys: string[],
  ): void => {
    const explicitWorkspaceKey = canonicalProjectKey(connection.workspaceProjectKey);
    const sourceKeys = [...new Set(rawSourceKeys.map(normalizeSourceProjectKey).filter(Boolean))];
    const inferredKeys = [...new Set(sourceKeys.map(canonicalProjectKey).filter(Boolean))];
    if (!explicitWorkspaceKey && inferredKeys.length !== 1) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, kind)} has ambiguous ownership keys (${sourceKeys.join(', ') || 'none'}). Set one workspaceProjectKey in the saved connection or create the dashboard project manually with these source keys.`,
      );
    }
    const key = explicitWorkspaceKey || inferredKeys[0];
    if (!key || key === 'all') {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, kind)} has no explicit project ownership key. Add a workspace/source key to the saved connection or create the dashboard project manually before configuring it.`,
      );
    }
    const group = groups.get(key) || { key, sourceKeys: [key], name: key };
    group.sourceKeys = [...new Set([key, ...group.sourceKeys, ...sourceKeys])];
    const assignmentField = kind === 'JIRA' ? 'jiraConnectionId' : 'qmetryConnectionId';
    if (group[assignmentField] && group[assignmentField] !== connection.id) {
      throw new ProjectConnectionValidationError(
        `Multiple ${kind} connections claim project ${key}. Assign unique workspaceProjectKey values before migrating.`,
      );
    }
    group[assignmentField] = connection.id;
    groups.set(key, group);
  };

  for (const connection of connections.jira) addConnection(connection, 'JIRA', connection.projectKeys || []);
  for (const connection of connections.qmetry) addConnection(connection, 'QMetry', [connection.projectKey]);

  const sourceOwners = new Map<string, string>();
  for (const group of groups.values()) {
    for (const sourceKey of group.sourceKeys) {
      const owner = sourceOwners.get(sourceKey);
      if (owner && owner !== group.key) {
        throw new ProjectConnectionValidationError(
          `Source key ${sourceKey} is claimed by both ${owner} and ${group.key}. Set explicit, non-overlapping ownership keys before migrating.`,
        );
      }
      sourceOwners.set(sourceKey, group.key);
    }
  }
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
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
  const jiraConnections = connections.jira.filter((connection) => !isBlankJiraConnection(connection));
  const qmetryConnections = connections.qmetry.filter((connection) => !isBlankQmetryConnection(connection));
  const jira = validateOnePerProject(jiraConnections, 'JIRA', projectsById, projectsByKey, (connection, project) => {
    if (connection.enabled !== false && connection.syncIssues !== false) {
      if (!connection.baseUrl.trim()) throw new ProjectConnectionValidationError(`${connectionLabel(connection, 'JIRA')} requires a base URL while sync is enabled.`);
      if (!hasJiraAuthMaterial(connection)) throw new ProjectConnectionValidationError(`${connectionLabel(connection, 'JIRA')} requires authentication or session material while sync is enabled.`);
    }
    const keys = [...new Set((connection.projectKeys || []).map(normalizeSourceProjectKey).filter(Boolean))];
    const allowed = projectSourceKeys(project);
    const allowedSet = new Set(allowed);
    if (keys.length !== allowed.length || keys.some((key) => !allowedSet.has(key))) {
      throw new ProjectConnectionValidationError(
        `${connectionLabel(connection, 'JIRA')} must use the owning project's configured source keys: ${allowed.join(', ')}.`,
      );
    }
    return { ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKeys: allowed, jql: scopedJiraJql(connection.jql, project) };
  });
  const qmetry = validateOnePerProject(qmetryConnections, 'QMetry', projectsById, projectsByKey, (connection, project) => {
    if (connection.enabled !== false && connection.syncExecutions !== false) {
      if (!connection.baseUrl.trim()) throw new ProjectConnectionValidationError(`${connectionLabel(connection, 'QMetry')} requires a base URL while sync is enabled.`);
      if (!hasQmetryAuthMaterial(connection)) throw new ProjectConnectionValidationError(`${connectionLabel(connection, 'QMetry')} requires authentication or session material while sync is enabled.`);
    }
    const projectKey = normalizeSourceProjectKey(connection.projectKey);
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

/**
 * Limits a validated browser connection collection to one logical dashboard
 * project. All Projects intentionally retains the complete collection.
 *
 * Connection ownership is matched through workspaceProjectKey because Jira and
 * QMetry source keys may differ from the logical dashboard key (for example,
 * DTTRV can own DP). validateProjectConnections always normalizes this field.
 */
export function scopeProjectConnections(
  connections: UserConnections,
  project?: string,
): UserConnections {
  const selected = canonicalProjectKey(project);
  if (!selected || selected === 'all') return connections;
  const ownsSelectedProject = (connection: ProjectConnection): boolean => (
    canonicalProjectKey(connection.workspaceProjectKey) === selected
  );
  return {
    jira: connections.jira.filter(ownsSelectedProject),
    qmetry: connections.qmetry.filter(ownsSelectedProject),
  };
}

/** Consolidates external source keys into the owning dashboard project's primary key. */
export function normalizeDatasetProjectOwnership(dataset: Dataset, projects: ProjectRecord[]): Dataset {
  const owners = new Map(projects.flatMap((project) => projectSourceKeys(project).map((key) => [key, project.key] as const)));
  const ownerKey = (value?: string) => owners.get(normalizeSourceProjectKey(value)) || canonicalProjectKey(value);
  const executions = dataset.executions.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const issues = dataset.issues.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const uat = dataset.uat.map((row) => ({ ...row, project: ownerKey(row.project) }));
  const files = dataset.files.map((file) => ({ ...file, project: ownerKey(file.project) }));
  const sourceProjects = [...executions.map((row) => row.project), ...issues.map((row) => row.project), ...uat.map((row) => row.project), ...files.map((file) => file.project)];
  return { ...dataset, executions, issues, uat, files, projects: [...new Set(sourceProjects.filter(Boolean))].sort() };
}
