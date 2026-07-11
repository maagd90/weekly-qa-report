import assert from 'assert';
import { fetchQmetryExecutions } from '../qmetryClient';
import type { QmetryIntegrationConfig } from '../../config/loadIntegrations';

interface FetchCall { url: string; init: RequestInit }

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
    testCyclesSearchBody: { filter: { projectId: 19703, folderId: '96225' } },
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCasesSearchBody: null,
    usePostSearch: true,
    testCaseFields: 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,build,updated',
    cycleIds: [],
    pageSize: 50,
    maxPages: 5,
  };
}

function requestBody(call: FetchCall): Record<string, unknown> {
  assert.equal(typeof call.init.body, 'string');
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function installContractMock(calls: FetchCall[]): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init: init || {} };
    calls.push(call);

    if (url.includes('/rest/api/2/user?key=JIRAUSER31341')) {
      return jsonResponse({ key: 'JIRAUSER31341', name: 's716363', displayName: 'Muhammad Annus' });
    }
    if (url.includes('/rest/api/2/user?key=s728841')) {
      return jsonResponse({ key: 's728841', name: 's728841', displayName: 'Tester From Updated By' });
    }

    if (url.includes('/testcases/search')) {
      if ((init?.method || 'GET') !== 'POST') return jsonResponse({ errorMessage: 'Method not allowed' }, 405);
      const body = requestBody(call);
      assert.deepEqual(body, { filter: { projectId: 19703 } }, 'testcase search must include the required on-prem project filter');
      return jsonResponse({
        warningMessages: [],
        data: [
          { key: 'DLM-TC-1', executionResult: { name: 'Pass' }, executionAssignee: 'JIRAUSER31341', updated: { updatedOn: '02/Jul/2026 10:00' } },
          { key: 'DLM-TC-2', executionResult: { name: 'Fail' }, updated: { updatedOn: '03/Jul/2026 10:00', updatedBy: 's728841' } },
          { key: 'DLM-TC-3', executionResult: { name: 'Not Executed' }, updated: { updatedOn: '04/Jul/2026 10:00', updatedBy: 's728841' } },
          { key: 'DLM-TC-4', executionResult: { name: 'Blocked' }, execution: { executionAssignee: { displayName: 'Nested Tester' }, updated: { updatedOn: '05/Jul/2026 10:00' } } },
        ],
        total: 4,
      });
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({
        data: [{
          id: 'eOwYfJOGUl',
          key: 'DLM-TR-59',
          summary: 'July execution cycle',
          updated: { updatedOn: '05/Jul/2026 14:18' },
          plannedStartDate: '2026-07-01',
          plannedEndDate: '2026-07-07',
          testcaseExecutionProgress: [{ name: 'Not Executed', count: 1 }],
        }],
        total: 1,
      });
    }

    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
  }) as typeof fetch;
}

function installInvalidFieldsMock(calls: FetchCall[]): void {
  let testcaseAttempts = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init: init || {} };
    calls.push(call);

    if (url.includes('/testcases/search')) {
      testcaseAttempts++;
      assert.equal(init?.method, 'POST');
      assert.deepEqual(requestBody(call), { filter: { projectId: 19703 } });
      if (testcaseAttempts === 1) return jsonResponse({ errorMessage: 'Invalid fields parameter' }, 400);
      return jsonResponse({ data: [{ key: 'DLM-TC-10', executionResult: { name: 'Pass' }, executionAssignee: { displayName: 'Tester Ten' }, updated: '04/Jul/2026 12:15' }], total: 1 });
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({ data: [{ id: 'field-cycle', key: 'DLM-TR-60', summary: 'Field retry cycle', plannedStartDate: '2026-07-01', plannedEndDate: '2026-07-07' }], total: 1 });
    }

    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
  }) as typeof fetch;
}

function installProgressFallbackMock(calls: FetchCall[]): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init: init || {} };
    calls.push(call);

    if (url.includes('/testcases/search')) {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(requestBody(call), { filter: { projectId: 19703 } });
      return jsonResponse({ errorMessage: "Request validation Failed: 'filter' should not be null" }, 400);
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({
        data: [{
          id: 'progress-cycle',
          key: 'DLM-TR-61',
          summary: 'Cycle progress only',
          updated: { updatedOn: '05/Jul/2026 14:18' },
          testcaseExecutionProgress: [
            { name: 'Pass', count: 2 },
            { name: 'Fail', count: 1 },
            { name: 'Not Executed', count: 3 },
          ],
        }],
        total: 1,
      });
    }

    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
  }) as typeof fetch;
}

async function testOnPremContractAndTesterResolution(): Promise<void> {
  const calls: FetchCall[] = [];
  installContractMock(calls);
  const cfg = qmetryConfig() as QmetryIntegrationConfig & { sessionHeader?: string };
  cfg.sessionHeader = 'Cookie: JSESSIONID=abc; atlassian.xsrf.token=def';

  const result = await fetchQmetryExecutions(cfg, { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  assert.equal(result.error, undefined);

  const testcaseCalls = calls.filter((call) => call.url.includes('/testcases/search'));
  assert.equal(testcaseCalls.length, 1, 'successful on-prem POST must not trigger a GET fallback');
  assert.equal(testcaseCalls[0].init.method, 'POST');
  assert.equal((testcaseCalls[0].init.headers as Record<string, string>).Cookie, 'JSESSIONID=abc; atlassian.xsrf.token=def');
  assert.deepEqual(requestBody(testcaseCalls[0]), { filter: { projectId: 19703 } });
  assert.match(decodeURIComponent(testcaseCalls[0].url), /executionAssignee/);
  assert.match(decodeURIComponent(testcaseCalls[0].url), /updated/);
  assert.doesNotMatch(decodeURIComponent(testcaseCalls[0].url), /executedOn|lastModified/);
  assert.equal(testcaseCalls.some((call) => call.init.method === 'GET'), false, 'GET is not allowed for this on-prem endpoint');

  const cycleSearchCall = calls.find((call) => call.url.includes('/testcycles/search') && !call.url.includes('/testcases/search'));
  assert.ok(cycleSearchCall);
  assert.deepEqual(requestBody(cycleSearchCall), { filter: { projectId: 19703, folderId: '96225' } });

  const byKey = new Map(result.executions.map((row) => [row.caseKey, row]));
  assert.equal(byKey.size, 4);
  assert.equal(byKey.get('DLM-TC-1')?.tester, 'Muhammad Annus');
  assert.equal(byKey.get('DLM-TC-2')?.tester, 'Tester From Updated By', 'updated.updatedBy should attribute an executed row when executionAssignee is absent');
  assert.equal(byKey.get('DLM-TC-3')?.tester, null, 'Not Executed rows must not be attributed from updatedBy');
  assert.equal(byKey.get('DLM-TC-4')?.tester, 'Nested Tester');
}

async function testFieldRetryKeepsPostContract(): Promise<void> {
  const calls: FetchCall[] = [];
  installInvalidFieldsMock(calls);
  const result = await fetchQmetryExecutions(qmetryConfig(), { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  assert.equal(result.error, undefined);
  assert.equal(result.executions.length, 1);

  const testcaseCalls = calls.filter((call) => call.url.includes('/testcases/search'));
  assert.equal(testcaseCalls.length, 2, 'invalid fields should retry once without fields');
  assert.ok(testcaseCalls.every((call) => call.init.method === 'POST'), 'field retry must preserve POST');
  assert.match(testcaseCalls[0].url, /fields=/);
  assert.doesNotMatch(testcaseCalls[1].url, /fields=/);
  assert.ok(testcaseCalls.every((call) => JSON.stringify(requestBody(call)) === JSON.stringify({ filter: { projectId: 19703 } })));
}

async function testAggregateFallbackIsExplicitAndConcise(): Promise<void> {
  const calls: FetchCall[] = [];
  installProgressFallbackMock(calls);
  const fallback = await fetchQmetryExecutions(qmetryConfig(), { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });

  assert.equal(fallback.executions.length, 6);
  assert.equal(fallback.executions.filter((row) => row.result === 'PASS').length, 2);
  assert.equal(fallback.executions.filter((row) => row.result === 'FAIL').length, 1);
  assert.equal(fallback.executions.filter((row) => row.result === 'NE').length, 3);
  assert.equal(fallback.executions.filter((row) => row.tester).length, 0, 'aggregate progress cannot invent tester names');
  assert.match(fallback.error || '', /detail retrieval failed for 1 cycle/i);
  assert.match(fallback.error || '', /tester attribution may be incomplete/i);
  assert.ok((fallback.error || '').length < 500, 'stakeholder warning must remain concise');
  assert.equal(calls.some((call) => call.url.includes('/testcases/search') && call.init.method === 'GET'), false);
}

async function main(): Promise<void> {
  await testOnPremContractAndTesterResolution();
  await testFieldRetryKeepsPostContract();
  await testAggregateFallbackIsExplicitAndConcise();
  console.log('qmetryClient tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
