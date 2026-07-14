import assert from 'assert';
import type { QmetryIntegrationConfig } from '../../config/loadIntegrations';
import { fetchFolderCycleHealth } from '../qmetryCycleHealth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function qmetryConfig(): QmetryIntegrationConfig {
  return {
    enabled: true,
    baseUrl: 'https://qmetry.example.test',
    apiPrefix: '/rest/qtm4j/ui/latest',
    auth: { type: 'basic', email: 'tester@example.test', token: 'token' },
    authEncodedEnv: '',
    projectKey: 'DLM',
    projectId: '19703',
    testCyclesSearchPath: '/testcycles/search',
    testCyclesSearchBody: { filter: { projectId: 19703 } },
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCasesSearchBody: null,
    usePostSearch: true,
    testCaseFields: '',
    cycleIds: [],
    pageSize: 50,
    maxPages: 5,
    executionSummaryEnabled: true,
    executionSummaryPath: '/gadgets/TESTCASE_EXECUTION_SUMMARY_BY_ASSIGNEE',
  };
}

async function main(): Promise<void> {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    assert.ok(url.includes('/testcycles/search'), `cycle health must only call cycle search, received ${url}`);
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { filter: { projectId: 19703, folderId: '96225' } });
    return jsonResponse({
      total: 7,
      data: [
        {
          id: 'old-cycle', key: 'DLM-TR-57', summary: 'Older June cycle',
          updated: { updatedOn: '25/Jun/2026 14:18' },
          testcaseExecutionProgress: [{ name: 'Not Executed', count: 48 }],
        },
        {
          id: 'PnE8tvXPil', key: 'DLM-TR-56', summary: 'AA-397 CPG -Partial payment flow',
          updated: { updatedOn: '07/Jul/2026 16:47' },
          testcaseExecutionProgress: [{ name: 'Pass', count: 15 }],
        },
        {
          id: 'Qr0MHaDZtj', key: 'DLM-TR-55', summary: 'AA-6 Manual Flight entry flows for transfer',
          updated: { updatedOn: '14/Jul/2026 08:57' },
          testcaseExecutionProgress: [
            { name: 'Pass', count: 96 },
            { name: 'Fail', count: 4 },
            { name: 'Blocked', count: 106 },
            { name: 'Not Applicable', count: 5 },
            { name: 'Not Executed', count: 21 },
          ],
        },
        {
          id: 'JLdxFDoXsy', key: 'DLM-TR-54', summary: 'AA-407 Credit note document',
          updated: { updatedOn: '11/Jul/2026 12:58' },
          testcaseExecutionProgress: [
            { name: 'Pass', count: 2 },
            { name: 'Fail', count: 1 },
            { name: 'Not Executed', count: 41 },
          ],
        },
      ],
    });
  }) as typeof fetch;

  const result = await fetchFolderCycleHealth(qmetryConfig(), '96225', {
    project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14',
  });

  assert.equal(result.error, undefined);
  assert.equal(calls.length, 1, 'project summary and testcase detail endpoints must not run per cycle');
  assert.equal(result.cycles.length, 3, 'the period filters cycle selection but not each cycle current progress split');

  const cpg = result.cycles.find((cycle) => cycle.key === 'DLM-TR-56');
  assert.deepEqual(cpg, {
    key: 'DLM-TR-56', name: 'AA-397 CPG -Partial payment flow',
    total: 15, pass: 15, fail: 0, blocked: 0, ne: 0, na: 0,
    passPct: 100, coverage: 100, status: 'Healthy',
  });

  const manualFlight = result.cycles.find((cycle) => cycle.key === 'DLM-TR-55');
  assert.deepEqual(manualFlight, {
    key: 'DLM-TR-55', name: 'AA-6 Manual Flight entry flows for transfer',
    total: 232, pass: 96, fail: 4, blocked: 106, ne: 21, na: 5,
    passPct: 45, coverage: 91, status: 'At Risk',
  });

  const creditNote = result.cycles.find((cycle) => cycle.key === 'DLM-TR-54');
  assert.deepEqual(creditNote, {
    key: 'DLM-TR-54', name: 'AA-407 Credit note document',
    total: 44, pass: 2, fail: 1, blocked: 0, ne: 41, na: 0,
    passPct: 67, coverage: 7, status: 'At Risk',
  });

  console.log('QMetry cycle-health regression test passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
