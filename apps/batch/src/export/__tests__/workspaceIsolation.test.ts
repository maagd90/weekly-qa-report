import assert from 'assert';
import path from 'path';
import { parseAllFiles } from '../../parse/dispatcher';
import { mergeDatasets } from '../../merge/mergeDataset';
import { buildDashboardPayload } from '../buildDashboardPayload';
import { listWorkspaces, stampDatasetWorkspace, workspaceIdFromName } from '../../projects/workspace';
import type { UserConnections } from '../../types/connections';

const FIXTURES = path.resolve(__dirname, '../../../../../fixtures/synthetic');
const DLM_WORKSPACE_NAME = 'DN4_FT - Supply & DMC';
const DLM_WORKSPACE_ID = workspaceIdFromName(DLM_WORKSPACE_NAME);
const WM_WORKSPACE_NAME = 'WonderMiles';
const WM_WORKSPACE_ID = workspaceIdFromName(WM_WORKSPACE_NAME);

const connections: UserConnections = {
  jira: [{
    id: 'dlm-jira',
    name: 'DLM JIRA',
    workspaceName: DLM_WORKSPACE_NAME,
    baseUrl: 'http://jira.invalid',
    email: 'qa',
    projectKeys: ['DLM'],
  }],
  qmetry: [
    {
      id: 'dlm-qmetry',
      name: 'DLM QMetry',
      workspaceName: DLM_WORKSPACE_NAME,
      baseUrl: 'http://qmetry.invalid',
      email: 'qa',
      projectKey: 'DLM',
      projectId: '1001',
    },
    {
      id: 'wm-qmetry',
      name: 'WonderMiles QMetry',
      workspaceName: WM_WORKSPACE_NAME,
      baseUrl: 'http://qmetry.invalid',
      email: 'qa',
      projectKey: 'DTTRV',
      projectId: '19703',
    },
  ],
};

assert.ok(DLM_WORKSPACE_ID, 'DLM workspace id should be created');
assert.strictEqual(WM_WORKSPACE_ID, 'wondermiles');

const workspaces = listWorkspaces(connections);
const dlmWorkspace = workspaces.find((workspace) => workspace.id === DLM_WORKSPACE_ID);
const wmWorkspace = workspaces.find((workspace) => workspace.id === WM_WORKSPACE_ID);
assert.ok(dlmWorkspace, 'DLM workspace should exist');
assert.ok(wmWorkspace, 'WonderMiles workspace should exist');
assert.strictEqual(dlmWorkspace!.jiraConnectionIds.length, 1);
assert.strictEqual(dlmWorkspace!.qmetryConnectionIds.length, 1);
assert.strictEqual(wmWorkspace!.jiraConnectionIds.length, 0, 'WonderMiles must not require JIRA credentials');
assert.strictEqual(wmWorkspace!.qmetryConnectionIds.length, 1, 'WonderMiles uses QMetry only');
assert.deepStrictEqual(wmWorkspace!.qmetryProjectKeys, ['DTTRV']);
console.log('✓ connection names create DLM and QMetry-only WonderMiles workspaces');

const dlmRaw = parseAllFiles([
  path.join(FIXTURES, 'zephyr-regression.xlsx'),
  path.join(FIXTURES, 'jira-regression.xlsx'),
  path.join(FIXTURES, 'odl-regression.xlsx'),
]);
const wmRaw = parseAllFiles([path.join(FIXTURES, 'wondermiles-qmetry-regression.xlsx')]);

const dlmDataset = stampDatasetWorkspace(dlmRaw, DLM_WORKSPACE_ID);
const wmDataset = stampDatasetWorkspace(wmRaw, WM_WORKSPACE_ID);
const merged = mergeDatasets([dlmDataset, wmDataset]);

// Real API storage loads one dataset per workspace. Assert each isolated dataset directly,
// then separately assert the explicit All projects merge.
const dlm = buildDashboardPayload(dlmDataset, { project: DLM_WORKSPACE_ID });
const wm = buildDashboardPayload(wmDataset, { project: WM_WORKSPACE_ID });
const all = buildDashboardPayload(merged, {});

assert.strictEqual(dlm.overview.totalCases, 2210);
assert.strictEqual(dlm.storyBug.story, 582);
assert.strictEqual(dlm.storyBug.bug, 197);
assert.strictEqual(dlm.uat?.total, 74);
assert.deepStrictEqual(dlm.scope.projects, [DLM_WORKSPACE_ID]);

assert.strictEqual(wm.overview.totalCases, 12);
assert.strictEqual(wm.storyBug.story, 0, 'WonderMiles has no JIRA connection/fixture');
assert.strictEqual(wm.storyBug.bug, 0, 'WonderMiles has no JIRA connection/fixture');
assert.strictEqual(wm.uat, null);
assert.strictEqual(wm.testers.length, 2);
assert.ok(wm.cycles.every((cycle) => cycle.key.startsWith('DTTRV-')));
assert.deepStrictEqual(wm.scope.projects, [WM_WORKSPACE_ID]);

assert.strictEqual(all.overview.totalCases, 2222);
assert.strictEqual(all.storyBug.story, 582);
assert.strictEqual(all.storyBug.bug, 197);
console.log('✓ imported datasets remain isolated by workspace');

const wmFail = buildDashboardPayload(wmDataset, { project: WM_WORKSPACE_ID, result: 'FAIL' });
assert.strictEqual(wmFail.overview.failed, 2);
assert.strictEqual(wmFail.overview.executed, 2);
assert.strictEqual(wmFail.storyBug.story, 0);
assert.strictEqual(wmFail.storyBug.bug, 0);
console.log('✓ WonderMiles result filtering remains QMetry-only');

const wmJune = buildDashboardPayload(wmDataset, { project: WM_WORKSPACE_ID, startDate: '2026-06-01', endDate: '2026-06-30' });
const wmJuly = buildDashboardPayload(wmDataset, { project: WM_WORKSPACE_ID, startDate: '2026-07-01', endDate: '2026-07-31' });
assert.strictEqual(wmJune.overview.totalCases, 6);
assert.strictEqual(wmJuly.overview.totalCases, 6);
assert.ok(wmJune.cycles.every((cycle) => cycle.key === 'DTTRV-TR-1'));
assert.ok(wmJuly.cycles.every((cycle) => cycle.key === 'DTTRV-TR-2'));
console.log('✓ WonderMiles date regeneration windows are deterministic');

console.log('All workspace isolation tests passed');
