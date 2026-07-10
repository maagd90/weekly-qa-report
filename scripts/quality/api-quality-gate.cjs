const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureSyntheticFixtures,
  createSandbox,
  startApi,
  stopProcess,
  jsonFetch,
  uploadFile,
  fixturePath,
  copyFixture,
  connectionHeader,
  startMockQmetryServer,
  writeResult,
} = require('./qualityHarness.cjs');

const DLM_NAME = 'DN4_FT - Supply & DMC';
const DLM_ID = 'dn4-ft-supply-and-dmc';
const WM_NAME = 'WonderMiles';
const WM_ID = 'wondermiles';

function connections(qmetryBaseUrl = 'http://127.0.0.1:9') {
  return {
    jira: [{
      id: 'dlm-jira',
      name: 'DLM JIRA',
      workspaceName: DLM_NAME,
      baseUrl: 'http://127.0.0.1:9',
      enabled: false,
      syncIssues: false,
      deploymentType: 'on-prem',
      authType: 'basic',
      email: 'qa-user',
      apiToken: 'test-only',
      projectKeys: ['DLM'],
    }],
    qmetry: [{
      id: 'wm-qmetry',
      name: 'WonderMiles QMetry',
      workspaceName: WM_NAME,
      baseUrl: qmetryBaseUrl,
      enabled: true,
      syncExecutions: true,
      email: 'qa-user',
      apiToken: 'test-only',
      projectKey: 'DTTRV',
      projectId: '19703',
      folderId: 'wm-folder-1',
    }],
  };
}

async function syncImported(apiBaseUrl, project) {
  return jsonFetch(`${apiBaseUrl}/api/input/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
}

async function seedWorkspaceFiles(apiBaseUrl) {
  for (const name of ['zephyr-regression.xlsx', 'jira-regression.xlsx', 'odl-regression.xlsx']) {
    await uploadFile(apiBaseUrl, DLM_ID, fixturePath(name));
  }
  const dlmSync = await syncImported(apiBaseUrl, DLM_ID);
  assert.equal(dlmSync.ok, true);
  assert.equal(dlmSync.rowCounts.executions, 2210);
  assert.equal(dlmSync.rowCounts.issues, 779);
  assert.equal(dlmSync.rowCounts.uat, 74);

  await uploadFile(apiBaseUrl, WM_ID, fixturePath('wondermiles-qmetry-regression.xlsx'));
  const wmSync = await syncImported(apiBaseUrl, WM_ID);
  assert.equal(wmSync.ok, true);
  assert.equal(wmSync.rowCounts.executions, 12);
  assert.equal(wmSync.rowCounts.issues, 0);
  assert.equal(wmSync.rowCounts.uat, 0);
}

async function verifyImportedIsolation(apiBaseUrl) {
  const dlmFiles = await jsonFetch(`${apiBaseUrl}/api/input/files?project=${encodeURIComponent(DLM_ID)}`);
  const wmFiles = await jsonFetch(`${apiBaseUrl}/api/input/files?project=${encodeURIComponent(WM_ID)}`);
  assert.equal(dlmFiles.length, 3);
  assert.equal(wmFiles.length, 1);
  assert.ok(dlmFiles.every((file) => !file.name.includes('wondermiles')));
  assert.ok(wmFiles.every((file) => file.name.includes('wondermiles')));

  const dlm = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(DLM_ID)}`);
  const wm = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(WM_ID)}`);
  const all = await jsonFetch(`${apiBaseUrl}/api/dashboard`);

  assert.equal(dlm.overview.totalCases, 2210);
  assert.equal(dlm.storyBug.story, 582);
  assert.equal(dlm.storyBug.bug, 197);
  assert.equal(dlm.uat.total, 74);
  assert.deepEqual(dlm.scope.projects, [DLM_ID]);

  assert.equal(wm.overview.totalCases, 12);
  assert.equal(wm.storyBug.story, 0, 'WonderMiles must work without JIRA');
  assert.equal(wm.storyBug.bug, 0, 'WonderMiles must work without JIRA');
  assert.equal(wm.testers.length, 2);
  assert.ok(wm.cycles.every((cycle) => cycle.key.startsWith('DTTRV-')));
  assert.deepEqual(wm.scope.projects, [WM_ID]);

  assert.equal(all.overview.totalCases, 2222);
  assert.equal(all.storyBug.story, 582);
  assert.equal(all.storyBug.bug, 197);

  const wmFail = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(WM_ID)}&result=FAIL`);
  assert.equal(wmFail.overview.failed, 2);
  assert.equal(wmFail.overview.executed, 2);
  assert.equal(wmFail.storyBug.story, 0);
  assert.equal(wmFail.storyBug.bug, 0);

  const noMatch = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(WM_ID)}&search=zzz_no_match_xyz`);
  assert.equal(noMatch.overview.totalCases, 0);
  assert.equal(noMatch.testers.length, 0);
  assert.equal(noMatch.cycles.length, 0);

  const june = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(WM_ID)}&startDate=2026-06-01&endDate=2026-06-30`);
  const july = await jsonFetch(`${apiBaseUrl}/api/dashboard?project=${encodeURIComponent(WM_ID)}&startDate=2026-07-01&endDate=2026-07-31`);
  assert.equal(june.overview.totalCases, 6);
  assert.equal(july.overview.totalCases, 6);
  assert.ok(june.cycles.every((cycle) => cycle.key === 'DTTRV-TR-1'));
  assert.ok(july.cycles.every((cycle) => cycle.key === 'DTTRV-TR-2'));
}

async function verifyReportTypesAndRegeneration(apiBaseUrl) {
  for (const reportType of ['full', 'executive', 'defects', 'cycles']) {
    const generated = await jsonFetch(`${apiBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: WM_ID,
        reportType,
        startDate: '2026-06-01',
        endDate: '2026-07-31',
      }),
    });
    assert.equal(generated.ok, true, `${reportType} generation should succeed without a real LLM key`);
    assert.equal(generated.payload.overview.totalCases, 12);
    assert.equal(generated.payload.storyBug.story, 0);
    assert.equal(generated.payload.storyBug.bug, 0);
  }

  const wide = await jsonFetch(`${apiBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: WM_ID, reportType: 'executive', startDate: '2026-06-01', endDate: '2026-07-31' }),
  });
  const julyOnly = await jsonFetch(`${apiBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: WM_ID, reportType: 'executive', startDate: '2026-07-01', endDate: '2026-07-31' }),
  });
  assert.equal(wide.payload.overview.totalCases, 12);
  assert.equal(julyOnly.payload.overview.totalCases, 6, 'regeneration must not return stale wide-range data');
}

async function verifyMixedLegacyMigrationIsBlocked(apiBaseUrl, sandbox) {
  copyFixture('zephyr-regression.xlsx', sandbox.inputDir);
  copyFixture('wondermiles-qmetry-regression.xlsx', sandbox.inputDir);
  const header = connectionHeader(connections());
  let conflict;
  try {
    await jsonFetch(`${apiBaseUrl}/api/input/migrate-legacy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...header },
      body: JSON.stringify({ project: DLM_ID }),
    });
  } catch (error) {
    conflict = error;
  }
  assert.ok(conflict, 'mixed-project migration must be rejected');
  assert.equal(conflict.status, 409);
  assert.ok(Array.isArray(conflict.body.conflicts));
  assert.ok(conflict.body.conflicts.some((item) => item.projects.includes('DTTRV')));
  assert.ok(fs.existsSync(path.join(sandbox.inputDir, 'zephyr-regression.xlsx')), 'DLM legacy file must remain after rejection');
  assert.ok(fs.existsSync(path.join(sandbox.inputDir, 'wondermiles-qmetry-regression.xlsx')), 'WonderMiles legacy file must remain after rejection');
}

async function verifyQmetryOnlyLivePath() {
  const mock = await startMockQmetryServer();
  const sandbox = createSandbox('api-qmetry-live');
  const api = await startApi(sandbox);
  try {
    const userConnections = connections(mock.baseUrl);
    const headers = { 'content-type': 'application/json', ...connectionHeader(userConnections) };

    const testConnection = await jsonFetch(`${api.baseUrl}/api/integrations/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'qmetry', connection: userConnections.qmetry[0] }),
    });
    assert.equal(testConnection.ok, true);
    assert.equal(testConnection.count, 1);

    const folders = await jsonFetch(`${api.baseUrl}/api/cycles/folders?project=${WM_ID}&connectionId=wm-qmetry`, { headers });
    assert.equal(folders.source, 'qmetry-live');
    assert.equal(folders.connectionId, 'wm-qmetry');
    assert.ok(folders.folders.some((folder) => folder.id === 'wm-folder-1'));
    assert.ok(folders.cycles.some((cycle) => cycle.id === 'wm-cycle-1'));

    // Regression for the previous HTTP 431 failure: a realistic multi-connection/session
    // header larger than Node's old default must still reach the API route.
    const oversizedConnections = { ...userConnections, padding: 'x'.repeat(20_000) };
    const oversizedFolders = await jsonFetch(`${api.baseUrl}/api/cycles/folders?project=${WM_ID}&connectionId=wm-qmetry`, {
      headers: { 'x-user-connections': JSON.stringify(oversizedConnections) },
    });
    assert.equal(oversizedFolders.source, 'qmetry-live');

    const cycles = await jsonFetch(`${api.baseUrl}/api/cycles/by-folder?project=${WM_ID}&connectionId=wm-qmetry&folderId=wm-folder-1&startDate=2026-07-01&endDate=2026-07-31`, { headers });
    assert.equal(cycles.source, 'qmetry-live');
    assert.equal(cycles.cycles.length, 1);
    assert.equal(cycles.cycles[0].key, 'DTTRV-TR-1');
    assert.equal(cycles.cycles[0].total, 4);

    const live = await jsonFetch(`${api.baseUrl}/api/dashboard/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: WM_ID, startDate: '2026-07-01', endDate: '2026-07-31' }),
    });
    assert.equal(live.ok, true);
    assert.equal(live.dashboard.overview.totalCases, 4);
    assert.equal(live.dashboard.storyBug.story, 0);
    assert.equal(live.dashboard.storyBug.bug, 0);
    assert.deepEqual(live.dashboard.scope.projects, [WM_ID]);
    assert.ok(mock.requests.every((request) => String(request.authorization || '').startsWith('Basic ')));
  } finally {
    await stopProcess(api.child);
    api.closeLog();
    await mock.close();
    fs.rmSync(sandbox.root, { recursive: true, force: true });
  }
}

async function main() {
  ensureSyntheticFixtures();
  const sandbox = createSandbox('api-isolation');
  const api = await startApi(sandbox);
  const checks = [];
  try {
    await seedWorkspaceFiles(api.baseUrl);
    checks.push('project-specific upload and sync');
    await verifyImportedIsolation(api.baseUrl);
    checks.push('dashboard/search/result/date isolation');
    await verifyReportTypesAndRegeneration(api.baseUrl);
    checks.push('all report types and regeneration');
    await verifyMixedLegacyMigrationIsBlocked(api.baseUrl, sandbox);
    checks.push('mixed-project legacy migration rejection');
    await verifyQmetryOnlyLivePath();
    checks.push('WonderMiles QMetry-only live integration and large headers');
    const resultPath = writeResult('api-quality-gate', { ok: true, checks });
    console.log(`API quality gate passed (${checks.length} groups). Result: ${resultPath}`);
  } catch (error) {
    const resultPath = writeResult('api-quality-gate', { ok: false, checks, error: error.stack || error.message });
    console.error(`API quality gate failed. Result: ${resultPath}`);
    throw error;
  } finally {
    await stopProcess(api.child);
    api.closeLog();
    fs.rmSync(sandbox.root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
