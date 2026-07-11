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

function installFetchMock(calls: FetchCall[]): void {
  process.env.INTEGRATION_DEBUG = 'false';
  process.env.INTEGRATION_DEBUG_FILE = 'false';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request = { url, init: init || {} };
    calls.push(request);

    if (url.includes('/rest/api/2/user?key=JIRAUSER31341')) {
      return jsonResponse({ key: 'JIRAUSER31341', name: 's716363', displayName: 'Muhammad Annus', emailAddress: 'S497045@emirates.com' });
    }

    if (url.includes('/testcases/search')) {
      if ((init?.method || 'GET') === 'POST') return jsonResponse({ warningMessages: [], data: [], total: 0 });
      return jsonResponse({
        warningMessages: [],
        data: [
          { key: 'DLM-TC-1', executionResult: { name: 'Pass' }, updated: { updatedOn: '02/Jul/2026 10:00' }, executedBy: 'JIRAUSER31341' },
          { key: 'DLM-TC-2', executionResult: { name: 'Not Executed' }, executionAssignee: { displayName: 'Tester Two' }, updated: { updatedOn: '05/Jul/2026 09:00' } },
          { key: 'DLM-TC-3', executionResult: { name: 'Fail' }, executionAssignee: { userName: 'tester3', displayName: 'Tester Three' }, updated: { updatedOn: '06/Jul/2026 09:00' } },
          { key: 'DLM-TC-4', executionResult: { name: 'Not Applicable' }, updated: 1782950400 },
          { key: 'DLM-TC-5', executionResult: { name: 'Blocked' }, updated: 1783036800000 },
          { key: 'DLM-TC-6', executionResult: { name: 'Pass' }, updated: '04/Jul/2026 12:15' },
        ],
        total: 6,
      });
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({
        data: [{ id: 'eOwYfJOGUl', key: 'DLM-TR-59', summary: 'July execution cycle', updated: { updatedOn: '05/Jul/2026 14:18' }, plannedStartDate: '2026-07-01', plannedEndDate: '2026-07-07', testcaseExecutionProgress: [{ name: 'Not Executed', count: 1 }], projectId: 19703 }],
        total: 1,
      });
    }

    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
  }) as typeof fetch;
}

function installUndatedCycleFetchMock(calls: FetchCall[]): void {
  process.env.INTEGRATION_DEBUG = 'false';
  process.env.INTEGRATION_DEBUG_FILE = 'false';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init || {} });

    if (url.includes('/testcases/search')) {
      return jsonResponse({
        data: [
          { key: 'DLM-TC-10', executionResult: { name: 'Not Executed' }, executionAssignee: { displayName: 'Tester Two' } },
          { key: 'DLM-TC-11', executionResult: { name: 'Fail' }, executionAssignee: { displayName: 'Tester Three' } },
          { key: 'DLM-TC-12', executionResult: { name: 'Pass' }, updated: '04/Jul/2026 12:15' },
        ],
        total: 3,
      });
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({ data: [{ id: 'undated-cycle', key: 'DLM-TR-60', summary: 'Undated cycle' }], total: 1 });
    }

    return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
  }) as typeof fetch;
}

function installProgressFallbackFetchMock(calls: FetchCall[]): void {
  process.env.INTEGRATION_DEBUG = 'false';
  process.env.INTEGRATION_DEBUG_FILE = 'false';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init || {} });

    if (url.includes('/testcases/search')) return jsonResponse({ data: [], total: 0 });

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

function bodyJson(call: FetchCall): unknown {
  assert.equal(typeof call.init.body, 'string');
  return JSON.parse(call.init.body as string);
}

async function main(): Promise<void> {
  const calls: FetchCall[] = [];
  installFetchMock(calls);

  const cfg = qmetryConfig() as QmetryIntegrationConfig & { sessionHeader?: string };
  cfg.sessionHeader = 'Cookie: JSESSIONID=abc; atlassian.xsrf.token=def';
  const result = await fetchQmetryExecutions(cfg, { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  assert.equal(result.error, undefined);

  const postTestCaseCall = calls.find((call) => call.url.includes('/testcases/search') && call.init.method === 'POST');
  const getTestCaseCall = calls.find((call) => call.url.includes('/testcases/search') && call.init.method === 'GET');
  assert.ok(postTestCaseCall, 'expected initial POST testcase request');
  assert.ok(getTestCaseCall, 'expected GET fallback when on-prem QMetry POST returns an empty page');
  assert.equal((postTestCaseCall.init.headers as Record<string, string>).Cookie, 'JSESSIONID=abc; atlassian.xsrf.token=def');
  assert.deepEqual(bodyJson(postTestCaseCall), {}, 'cycle-specific testcase search should not add an unrelated project filter');
  assert.match(getTestCaseCall.url, /fields=/, 'GET fallback should retain the requested fields');
  const decodedFieldsUrl = decodeURIComponent(getTestCaseCall.url);
  assert.match(decodedFieldsUrl, /executionAssignee/, 'testcase request must ask for tester attribution');
  assert.match(decodedFieldsUrl, /updated/, 'testcase request must include QMetry-supported updated field');
  assert.doesNotMatch(decodedFieldsUrl, /executedOn|lastModified/, 'known-invalid QMetry UI fields must not be requested');

  const cycleSearchCall = calls.find((call) => call.url.includes('/testcycles/search') && !call.url.includes('/testcases/search'));
  assert.ok(cycleSearchCall, 'expected testcycle search request');
  assert.equal(cycleSearchCall.init.method, 'POST');
  assert.deepEqual(bodyJson(cycleSearchCall), { filter: { projectId: 19703, folderId: '96225' } });

  const byKey = new Map(result.executions.map((row) => [row.caseKey, row]));
  assert.equal(byKey.size, 6, 'all rows from a date-scoped cycle should survive with row or cycle updated dates');
  assert.equal(byKey.get('DLM-TC-1')?.result, 'PASS');
  assert.equal(byKey.get('DLM-TC-1')?.tester, 'Muhammad Annus', 'raw JIRAUSER ids should resolve through the on-prem JIRA user endpoint');
  assert.equal(byKey.get('DLM-TC-1')?.updatedAt, '2026-07-02');

  const notExecuted = byKey.get('DLM-TC-2');
  assert.ok(notExecuted);
  assert.equal(notExecuted.executedAt, null);
  assert.equal(notExecuted.updatedAt, '2026-07-05');
  assert.equal(notExecuted.result, 'NE');

  const failedWithoutDate = byKey.get('DLM-TC-3');
  assert.ok(failedWithoutDate);
  assert.equal(failedWithoutDate.updatedAt, '2026-07-06');
  assert.equal(failedWithoutDate.result, 'FAIL');
  assert.equal(failedWithoutDate.tester, 'Tester Three');

  assert.equal(byKey.get('DLM-TC-4')?.updatedAt, '2026-07-02');
  assert.equal(byKey.get('DLM-TC-5')?.updatedAt, '2026-07-03');
  assert.equal(byKey.get('DLM-TC-6')?.updatedAt, '2026-07-04');

  const undatedCalls: FetchCall[] = [];
  installUndatedCycleFetchMock(undatedCalls);
  const undated = await fetchQmetryExecutions(qmetryConfig(), { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  const undatedKeys = new Set(undated.executions.map((row) => row.caseKey));
  assert.deepEqual([...undatedKeys].sort(), ['DLM-TC-12'], 'undated rows should not survive period filters unless the row or parent cycle has an in-scope date');

  const fallbackCalls: FetchCall[] = [];
  installProgressFallbackFetchMock(fallbackCalls);
  const fallback = await fetchQmetryExecutions(qmetryConfig(), { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  assert.match(fallback.error || '', /excluded from tester rankings/, 'progress fallback warning should explain missing tester attribution');
  assert.equal(fallback.executions.length, 6);
  assert.equal(fallback.executions.filter((row) => row.result === 'PASS').length, 2);
  assert.equal(fallback.executions.filter((row) => row.result === 'FAIL').length, 1);
  assert.equal(fallback.executions.filter((row) => row.result === 'NE').length, 3);
  assert.equal(fallback.executions.filter((row) => row.tester).length, 0, 'cycle progress cannot invent tester names');

  console.log('qmetryClient tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
