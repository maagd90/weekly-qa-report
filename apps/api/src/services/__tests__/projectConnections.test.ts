import assert from 'node:assert/strict';
import type { JiraConnectionInput, QmetryConnectionInput, UserConnections } from 'qa-dashboard-batch';
import { emptyDataset } from 'qa-dashboard-batch';
import type { ProjectRecord } from '../projectImports';
import { normalizeDatasetProjectOwnership, planConnectionProjectMigration, scopeProjectConnections, validateProjectConnections } from '../projectConnections';

const projects: ProjectRecord[] = [
  { id: 'project-a', key: 'AAA', sourceKeys: ['AAA'], name: 'Project A', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
  { id: 'project-b', key: 'BBB', sourceKeys: ['BBB', 'BBC'], name: 'Project B', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
];

function jira(id: string, workspaceProjectId: string, projectKey: string): JiraConnectionInput {
  return { id, workspaceProjectId, name: `JIRA ${projectKey}`, baseUrl: 'https://jira.example.test', email: 'qa', apiToken: 'secret', projectKeys: [projectKey] };
}

function qmetry(id: string, workspaceProjectId: string, projectKey: string): QmetryConnectionInput {
  return { id, workspaceProjectId, name: `QMetry ${projectKey}`, baseUrl: 'https://qmetry.example.test', email: 'qa', apiToken: 'secret', projectKey, projectId: '19703' };
}

function expectValidationError(connections: UserConnections, expected: RegExp): void {
  assert.throws(() => validateProjectConnections(connections, projects), expected);
}

const valid = validateProjectConnections({
  jira: [{ ...jira('jira-a', 'project-a', 'aaa'), jql: 'project = AAA AND status != Closed ORDER BY updated DESC' }, { ...jira('jira-b', 'project-b', 'BBB'), projectKeys: ['BBB', 'BBC'], jql: 'project in (BBB, BBC) AND issuetype in (Story, Bug)' }],
  qmetry: [qmetry('qmetry-a', 'project-a', 'aaa'), qmetry('qmetry-b', 'project-b', 'BBC')],
}, projects);
assert.deepEqual(valid.jira.map((connection) => connection.projectKeys), [['AAA'], ['BBB', 'BBC']]);
assert.equal(valid.jira[0].jql, 'project = AAA AND status != Closed ORDER BY updated DESC');
assert.equal(valid.jira[1].jql, 'project in (BBB, BBC) AND issuetype in (Story, Bug)');
assert.deepEqual(valid.qmetry.map((connection) => connection.projectKey), ['AAA', 'BBC']);
assert.deepEqual(valid.qmetry.map((connection) => connection.workspaceProjectKey), ['AAA', 'BBB']);

const scopedToB = scopeProjectConnections(valid, 'BBB');
assert.deepEqual(scopedToB.jira.map((connection) => connection.id), ['jira-b']);
assert.deepEqual(scopedToB.qmetry.map((connection) => connection.id), ['qmetry-b']);
assert.equal(scopedToB.jira[0].workspaceProjectKey, 'BBB');
assert.deepEqual(scopeProjectConnections(valid, 'all'), valid);
assert.deepEqual(scopeProjectConnections(valid), valid);

expectValidationError(
  { jira: [jira('jira-a', 'project-a', 'AAA'), jira('jira-a-2', 'project-a', 'AAA')], qmetry: [] },
  /Project AAA already has a JIRA connection/,
);

const dlmProject: ProjectRecord = {
  id: 'project-dlm',
  key: 'DLM',
  sourceKeys: ['DLM', 'DN4_FT'],
  name: 'DLM',
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
};
const rawKeyConnections = validateProjectConnections({
  jira: [{ ...jira('jira-dlm', dlmProject.id, 'DLM'), projectKeys: ['DLM', 'dn4_ft'], jql: 'project in (DLM, DN4_FT) AND issuetype in (Story, Bug)' }],
  qmetry: [qmetry('qmetry-dlm', dlmProject.id, 'DN4_FT')],
}, [...projects, dlmProject]);
assert.deepEqual(rawKeyConnections.jira[0].projectKeys, ['DLM', 'DN4_FT']);
assert.match(rawKeyConnections.jira[0].jql || '', /DN4_FT/);
assert.equal(rawKeyConnections.qmetry[0].projectKey, 'DN4_FT');

const migrationPlan = planConnectionProjectMigration({
  jira: [{ ...jira('legacy-jira-dlm', '', 'DLM'), projectKeys: ['DLM', 'DN4_FT'] }],
  qmetry: [qmetry('legacy-qmetry-dlm', '', 'DN4_FT')],
});
assert.deepEqual(migrationPlan, [{
  key: 'DLM',
  sourceKeys: ['DLM', 'DN4_FT'],
  name: 'DLM',
  jiraConnectionId: 'legacy-jira-dlm',
  qmetryConnectionId: 'legacy-qmetry-dlm',
}]);
const explicitMigrationPlan = planConnectionProjectMigration({
  jira: [{ ...jira('legacy-jira-travel', '', 'DP'), workspaceProjectKey: 'TRAVEL', projectKeys: ['DP', 'DTTRV'] }],
  qmetry: [{ ...qmetry('legacy-qmetry-travel', '', 'DTTRV'), workspaceProjectKey: 'TRAVEL' }],
});
assert.deepEqual(explicitMigrationPlan[0].sourceKeys, ['TRAVEL', 'DP', 'DTTRV']);
assert.throws(
  () => planConnectionProjectMigration({ jira: [{ ...jira('ambiguous-jira', '', 'DP'), projectKeys: ['DP', 'DTTRV'] }], qmetry: [] }),
  /ambiguous ownership keys.*DP, DTTRV/i,
);
assert.throws(
  () => planConnectionProjectMigration({ jira: [jira('duplicate-jira-1', '', 'DLM'), jira('duplicate-jira-2', '', 'DN4_FT')], qmetry: [] }),
  /Multiple JIRA connections claim project DLM/i,
);

const omittedBlanks = validateProjectConnections({
  jira: [{ ...jira('blank-jira', 'project-a', 'AAA'), baseUrl: '', apiToken: '' }],
  qmetry: [{ ...qmetry('blank-qmetry', 'project-a', 'AAA'), baseUrl: '', apiToken: '' }],
}, projects);
assert.deepEqual(omittedBlanks, { jira: [], qmetry: [] });
expectValidationError(
  { jira: [{ ...jira('incomplete-jira', 'project-a', 'AAA'), apiToken: '' }], qmetry: [] },
  /authentication or session material/,
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
  /configured source keys: AAA/,
);
expectValidationError(
  { jira: [{ ...jira('jira-a', 'project-a', 'AAA'), jql: 'project = BBB AND status = Open' }], qmetry: [] },
  /JIRA JQL for project AAA must be scoped/,
);
expectValidationError(
  { jira: [], qmetry: [qmetry('qmetry-a', 'project-a', 'BBB')] },
  /configured source keys: AAA/,
);

expectValidationError(
  { jira: [{ ...jira('jira-b', 'project-b', 'BBB'), projectKeys: ['BBB'], jql: 'project = BBB' }], qmetry: [] },
  /configured source keys: BBB, BBC/,
);

const multiKeyDataset = emptyDataset();
multiKeyDataset.issues = [
  { project: 'BBB', key: 'BBB-1', area: 'A', issueType: 'Story', status: 'open', priority: 'High', assignee: 'QA', createdAt: '2026-07-01', resolvedAt: null, updatedAt: '2026-07-01', source: 'jira-api' },
  { project: 'BBC', key: 'BBC-1', area: 'B', issueType: 'Bug', status: 'open', priority: 'High', assignee: 'QA', createdAt: '2026-07-01', resolvedAt: null, updatedAt: '2026-07-01', source: 'jira-api' },
];
multiKeyDataset.projects = ['BBB', 'BBC'];
const consolidated = normalizeDatasetProjectOwnership(multiKeyDataset, projects);
assert.deepEqual(consolidated.projects, ['BBB']);
assert.ok(consolidated.issues.every((issue) => issue.project === 'BBB'));

console.log('Project connection ownership tests passed');
