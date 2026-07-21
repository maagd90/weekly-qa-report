import assert from 'node:assert/strict';
import type { JiraConnectionInput, QmetryConnectionInput, UserConnections } from 'qa-dashboard-batch';
import type { ProjectRecord } from '../projectImports';
import { validateProjectConnections } from '../projectConnections';

const projects: ProjectRecord[] = [
  { id: 'project-a', key: 'AAA', name: 'Project A', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
  { id: 'project-b', key: 'BBB', name: 'Project B', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
];

function jira(id: string, workspaceProjectId: string, projectKey: string): JiraConnectionInput {
  return { id, workspaceProjectId, name: `JIRA ${projectKey}`, baseUrl: 'https://jira.example.test', email: 'qa', projectKeys: [projectKey] };
}

function qmetry(id: string, workspaceProjectId: string, projectKey: string): QmetryConnectionInput {
  return { id, workspaceProjectId, name: `QMetry ${projectKey}`, baseUrl: 'https://qmetry.example.test', email: 'qa', projectKey, projectId: '19703' };
}

function expectValidationError(connections: UserConnections, expected: RegExp): void {
  assert.throws(() => validateProjectConnections(connections, projects), expected);
}

const valid = validateProjectConnections({
  jira: [jira('jira-a', 'project-a', 'aaa'), jira('jira-b', 'project-b', 'BBB')],
  qmetry: [qmetry('qmetry-a', 'project-a', 'aaa'), qmetry('qmetry-b', 'project-b', 'BBB')],
}, projects);
assert.deepEqual(valid.jira.map((connection) => connection.projectKeys), [['AAA'], ['BBB']]);
assert.equal(valid.jira[0].jql, 'project = AAA AND issuetype in (Story, Bug) ORDER BY updated DESC');
assert.deepEqual(valid.qmetry.map((connection) => connection.projectKey), ['AAA', 'BBB']);

expectValidationError(
  { jira: [jira('jira-a', 'project-a', 'AAA'), jira('jira-a-2', 'project-a', 'AAA')], qmetry: [] },
  /Project AAA already has a JIRA connection/,
);
expectValidationError(
  { jira: [], qmetry: [qmetry('qmetry-a', 'project-a', 'AAA'), qmetry('qmetry-a-2', 'project-a', 'AAA')] },
  /Project AAA already has a QMetry connection/,
);
const migrated = validateProjectConnections(
  { jira: [jira('jira-legacy', '', 'AAA')], qmetry: [qmetry('qmetry-legacy', '', 'BBB')] },
  projects,
);
assert.equal(migrated.jira[0].workspaceProjectId, 'project-a');
assert.equal(migrated.qmetry[0].workspaceProjectId, 'project-b');
expectValidationError(
  { jira: [jira('jira-a', '', 'UNKNOWN')], qmetry: [] },
  /must be assigned to an existing dashboard project/,
);
expectValidationError(
  { jira: [jira('jira-a', 'missing-project', 'AAA')], qmetry: [] },
  /project that no longer exists/,
);
expectValidationError(
  { jira: [jira('jira-a', 'project-a', 'BBB')], qmetry: [] },
  /must use the owning project key AAA/,
);
expectValidationError(
  { jira: [], qmetry: [qmetry('qmetry-a', 'project-a', 'BBB')] },
  /must use the owning project key AAA/,
);

console.log('Project connection ownership tests passed');
