import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonFile } from 'qa-dashboard-batch';
import type { Dataset, RuntimePaths } from 'qa-dashboard-batch';
import { ProjectImportStore } from '../projectImports';
import { canUseDashboardPayloadFallback } from '../dashboardFallback';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-project-imports-'));
const paths: RuntimePaths = {
  rootDir: root,
  inputDir: path.join(root, 'input'),
  outputDir: path.join(root, 'output'),
  configDir: path.join(root, 'config'),
};
Object.values(paths).forEach((directory) => fs.mkdirSync(directory, { recursive: true }));

async function run(): Promise<void> {
try {
  const store = new ProjectImportStore(paths);
  const projectA = store.createProject({ key: 'PROJA', sourceKeys: ['PROJA', 'PROJAUX'], name: 'Project A' });
  const projectB = store.createProject({ key: 'PROJB', name: 'Project B' });
  const dlmProject = store.createProject({ key: 'DLM', sourceKeys: ['DLM', 'DN4_FT'], name: 'DLM Workspace' });
  assert.deepStrictEqual(projectA.sourceKeys, ['PROJA', 'PROJAUX']);
  assert.deepStrictEqual(dlmProject.sourceKeys, ['DLM', 'DN4_FT'], 'raw source aliases must not collapse to the dashboard key');
  assert.deepStrictEqual(dlmProject.capabilities, { vendorPortal: true, wonderMilesExport: false });
  const independentProject = store.createProject({ key: 'WONDERMILES', name: 'Independent Wonder Miles workspace' });
  assert.equal(independentProject.key, 'WONDERMILES', 'a project must be able to adopt any key as its own independent primary key, not be forced through the legacy dashboard alias table');
  assert.deepStrictEqual(independentProject.sourceKeys, ['WONDERMILES']);
  const wonderMilesProject = store.createProject({ key: 'TRAVEL', sourceKeys: ['TRAVEL', 'DP', 'DTTRV'], name: 'Travel' });
  assert.deepStrictEqual(wonderMilesProject.capabilities, { vendorPortal: false, wonderMilesExport: true });
  const registryPath = path.join(paths.configDir, 'projects.json');
  const legacyRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as { projects: Array<{ id: string; capabilities?: unknown }> };
  delete legacyRegistry.projects.find((project) => project.id === dlmProject.id)!.capabilities;
  fs.writeFileSync(registryPath, JSON.stringify(legacyRegistry));
  assert.deepStrictEqual(store.getProject(dlmProject.id).capabilities, { vendorPortal: true, wonderMilesExport: false });
  const migratedRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as { projects: Array<{ id: string; capabilities?: unknown }> };
  assert.deepStrictEqual(migratedRegistry.projects.find((project) => project.id === dlmProject.id)?.capabilities, { vendorPortal: true, wonderMilesExport: false });
  const capabilityOverride = store.updateProject(dlmProject.id, { capabilities: { vendorPortal: false, wonderMilesExport: true } });
  assert.deepStrictEqual(capabilityOverride.capabilities, { vendorPortal: false, wonderMilesExport: true });
  assert.deepStrictEqual(store.getProject(dlmProject.id).capabilities, { vendorPortal: false, wonderMilesExport: true }, 'explicit capability overrides must persist');
  assert.equal(canUseDashboardPayloadFallback({}), true);
  assert.equal(canUseDashboardPayloadFallback({ result: 'all' }), true);
  assert.equal(canUseDashboardPayloadFallback({ project: 'PROJA' }), false);
  assert.equal(canUseDashboardPayloadFallback({ startDate: '2026-07-01' }), false);
  assert.equal(canUseDashboardPayloadFallback({ search: 'bug' }), false);
  assert.throws(() => store.createProject({ key: 'PROJC', sourceKeys: ['PROJC', 'PROJAUX'], name: 'Duplicate alias' }), /Source key PROJAUX is already assigned/i);
  const fixtures = path.resolve(__dirname, '../../../../../fixtures/synthetic');
  const executionFile = fs.readFileSync(path.join(fixtures, 'zephyr-regression.xlsx'));
  const jiraFile = fs.readFileSync(path.join(fixtures, 'jira-regression.xlsx'));

  const fileA = store.stageFile(projectA.id, 'project-a-executions.xlsx', executionFile);
  const fileB = store.stageFile(projectB.id, 'project-b-jira.xlsx', jiraFile);
  assert.deepStrictEqual(store.listFiles(projectA.id).map((file) => file.id), [fileA.id]);
  assert.deepStrictEqual(store.listFiles(projectB.id).map((file) => file.id), [fileB.id]);
  assert.throws(() => store.deleteFile(projectA.id, fileB.id), /selected project/i, 'cross-project deletion must be rejected');

  const syncA = store.syncProject(projectA.id, 'QA tester');
  assert.equal(syncA.project.id, projectA.id);
  assert.equal(syncA.filesProcessed, 1);
  assert.equal(syncA.files[0].filename, 'project-a-executions.xlsx');
  assert.equal(syncA.newTotals.executions, 2210);
  assert.equal(syncA.newTotals.stories, 0);
  assert.ok(syncA.files[0].totalRowsFound >= syncA.files[0].successfullyImportedRows);
  assert.deepStrictEqual(syncA.files[0].rejections, []);
  assert.equal(store.listFiles(projectB.id)[0].status, 'staged', 'syncing Project A must not process Project B files');
  const retryA = store.syncProject(projectA.id, 'QA tester');
  assert.equal(retryA.newTotals.executions, 2210, 'retry must not duplicate imported executions');
  assert.equal(retryA.files[0].createdRecords, 0);
  assert.equal(retryA.files[0].updatedRecords, 0);
  assert.equal(retryA.files[0].unchangedRecords, 2210);
  assert.equal(retryA.files[0].duplicateOrSkippedRows, 0);
  assert.equal(retryA.files[0].successfullyImportedRows, 2210);

  const [concurrentA, syncB] = await Promise.all([
    store.syncProjectSerialized(projectA.id, 'Concurrent QA tester'),
    store.syncProjectSerialized(projectB.id, 'QA tester'),
  ]);
  assert.equal(concurrentA.project.key, 'PROJA');
  assert.equal(concurrentA.rowCounts.executions, 2210);
  assert.equal(concurrentA.rowCounts.issues, 0);
  assert.equal(syncB.project.key, 'PROJB');
  assert.equal(syncB.rowCounts.executions, 0);
  assert.equal(syncB.rowCounts.issues, 779);
  assert.equal(syncB.newTotals.stories, 582);
  assert.equal(syncB.newTotals.bugs, 197);
  assert.equal(syncB.files[0].filename, 'project-b-jira.xlsx');
  const uploadedIssuesB = store.uploadedIssueDataset(projectB.id);
  assert.equal(uploadedIssuesB.executions.length, 0, 'uploaded issue view must exclude execution files');
  assert.equal(uploadedIssuesB.issues.length, 779);
  assert.ok(uploadedIssuesB.issues.every((row) => row.source === 'jira-file'));
  assert.ok(uploadedIssuesB.issues.every((row) => row.sourceFile === 'project-b-jira.xlsx'));
  assert.deepStrictEqual(uploadedIssuesB.files.map((file) => file.name), ['project-b-jira.xlsx']);

  const aggregate = readJsonFile<Dataset>(path.join(paths.outputDir, 'raw-dataset.imported.json'));
  assert.ok(aggregate);
  assert.deepStrictEqual(aggregate!.projects, ['PROJA', 'PROJB']);
  assert.equal(aggregate!.executions.length, 2210);
  assert.equal(aggregate!.issues.length, 779);
  assert.deepStrictEqual([...new Set(aggregate!.executions.map((row) => row.project))], ['PROJA']);
  assert.deepStrictEqual([...new Set(aggregate!.issues.map((row) => row.project))], ['PROJB']);
  assert.equal(store.getSyncReport(projectA.id, syncA.id).id, syncA.id);
  assert.throws(() => store.getSyncReport(projectB.id, syncA.id), /selected project/i, 'cross-project report access must be rejected');
  const csv = store.reconciliationCsv(projectA.id, syncA.id);
  assert.match(csv, /project-a-executions\.xlsx/);
  assert.match(csv, /Rejected Row/);

  const liveCache = path.join(paths.outputDir, 'raw-dataset.live.json');
  fs.writeFileSync(liveCache, JSON.stringify(aggregate));
  const updatedProjectA = store.updateProject(projectA.id, { key: 'PROJX', name: 'Project A Updated' });
  assert.equal(updatedProjectA.name, 'Project A Updated');
  assert.equal(updatedProjectA.key, 'PROJX');
  assert.deepStrictEqual(updatedProjectA.sourceKeys, ['PROJX', 'PROJAUX']);
  const aggregateAfterProjectUpdate = readJsonFile<Dataset>(path.join(paths.outputDir, 'raw-dataset.imported.json'));
  assert.deepStrictEqual(aggregateAfterProjectUpdate?.projects, ['PROJB', 'PROJX']);
  assert.ok(aggregateAfterProjectUpdate?.executions.every((row) => row.project === 'PROJX'));
  const liveAfterProjectUpdate = readJsonFile<Dataset>(liveCache);
  assert.deepStrictEqual(liveAfterProjectUpdate?.projects, ['PROJB', 'PROJX']);
  assert.equal(store.getSyncReport(projectA.id, syncA.id).project.key, 'PROJX');
  assert.throws(() => store.updateProject(projectA.id, { key: 'PROJB', name: 'Duplicate key' }), /Source key PROJB is already assigned/i);
  assert.throws(() => store.deleteProject(projectB.id, 'WRONG'), /confirmation must match project key PROJB/i);

  const projectBDirectory = path.join(paths.inputDir, 'projects', projectB.id);
  const projectBCache = path.join(paths.outputDir, 'import-projects', `${projectB.id}.json`);
  const projectBReport = path.join(paths.outputDir, 'import-sync', `${syncB.id}.json`);
  assert.equal(fs.existsSync(projectBDirectory), true);
  assert.equal(fs.existsSync(projectBCache), true);
  assert.equal(fs.existsSync(projectBReport), true);
  const deletion = store.deleteProject(projectB.id, projectB.key);
  assert.equal(deletion.filesDeleted, 1);
  assert.ok(deletion.syncReportsDeleted >= 1);
  assert.equal(fs.existsSync(projectBDirectory), false, 'project input folder must be deleted');
  assert.equal(fs.existsSync(projectBCache), false, 'project import cache must be deleted');
  assert.equal(fs.existsSync(projectBReport), false, 'project reconciliation reports must be deleted');
  assert.throws(() => store.getProject(projectB.id), /not found/i);
  const aggregateAfterProjectDelete = readJsonFile<Dataset>(path.join(paths.outputDir, 'raw-dataset.imported.json'));
  assert.ok(aggregateAfterProjectDelete);
  assert.deepStrictEqual(aggregateAfterProjectDelete!.projects, ['PROJX']);
  const liveAfterProjectDelete = readJsonFile<Dataset>(liveCache);
  assert.ok(liveAfterProjectDelete);
  assert.deepStrictEqual(liveAfterProjectDelete!.projects, ['PROJX']);
  assert.equal(liveAfterProjectDelete!.issues.length, 0, 'deleted project live rows must be removed');

  store.deleteFile(projectA.id, fileA.id);
  const afterDelete = store.syncProject(projectA.id, 'QA tester');
  assert.equal(afterDelete.newTotals.executions, 0);
  console.log('✓ Project-scoped import isolation, reconciliation, update, and deletion');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
