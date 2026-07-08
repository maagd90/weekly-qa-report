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
    testCaseFields: 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedOn,executedBy,lastModified,build',
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
    calls.push({ url, init: init || {} });

    if (url.includes('/testcases/search')) {
      return jsonResponse({
        data: [
          { key: 'DLM-TC-1', executionResult: { name: 'Pass' }, executedOn: '02/Jul/2026 10:00', lastModified: '03/Jul/2026 11:30', executedBy: { displayName: 'Tester One' } },
          { key: 'DLM-TC-2', executionResult: { name: 'Not Executed' }, executedOn: null, lastModified: '10/Jan/2026 09:00', executionAssignee: { displayName: 'Tester Two' } },
          { key: 'DLM-TC-3', executionResult: { name: 'Fail' }, executionAssignee: { displayName: 'Tester Three' } },
          { key: 'DLM-TC-4', executionResult: { name: 'Not Applicable' }, executedOn: 1782950400, lastModified: '05/Jul/2026 08:00' },
          { key: 'DLM-TC-5', executionResult: { name: 'Blocked' }, executedOn: 1783036800000, lastModified: '05/Jul/2026 08:00' },
          { key: 'DLM-TC-6', executionResult: { name: 'Pass' }, executedOn: '04/Jul/2026 12:15', lastModified: '05/Jul/2026 08:00' },
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
          { key: 'DLM-TC-12', executionResult: { name: 'Pass' }, executedOn: '04/Jul/2026 12:15' },
        ],
        total: 3,
      });
    }

    if (url.includes('/testcycles/search')) {
      return jsonResponse({
        data: [{ id: 'undated-cycle', key: 'DLM-TR-60', summary: 'Undated cycle' }],
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

  const testCaseCall = calls.find((call) => call.url.includes('/testcases/search'));
  assert.ok(testCaseCall, 'expected per-cycle testcase request');
  assert.equal(testCaseCall.init.method, 'POST');
  assert.equal((testCaseCall.init.headers as Record<string, string>).Cookie, 'JSESSIONID=abc; atlassian.xsrf.token=def', 'session header should be sent as Cookie without the Cookie: prefix');
  assert.deepEqual(bodyJson(testCaseCall), { filter: { projectId: 19703 } });
  assert.match(testCaseCall.url, /fields=/, 'testcase request should include fields parameter');
  const decodedFieldsUrl = decodeURIComponent(testCaseCall.url);
  assert.match(decodedFieldsUrl, /executedOn/, 'testcase request must include executedOn because date filtering depends on executedAt');
  assert.match(decodedFieldsUrl, /lastModified/, 'testcase request must include lastModified for updatedAt metadata');

  const cycleSearchCall = calls.find((call) => call.url.includes('/testcycles/search') && !call.url.includes('/testcases/search'));
  assert.ok(cycleSearchCall, 'expected testcycle search request');
  assert.equal(cycleSearchCall.init.method, 'POST');
  assert.deepEqual(bodyJson(cycleSearchCall), { filter: { projectId: 19703, folderId: '96225' } });

  const byKey = new Map(result.executions.map((row) => [row.caseKey, row]));
  assert.equal(byKey.size, 6, 'all rows from a date-scoped cycle should survive even if QMetry omits executedOn');
  assert.equal(byKey.get('DLM-TC-1')?.result, 'PASS', 'executionResult object should unwrap to PASS');
  assert.equal(byKey.get('DLM-TC-1')?.executedAt, '2026-07-02');

  const notExecuted = byKey.get('DLM-TC-2');
  assert.ok(notExecuted, 'NE row should survive a period filter even without executedOn');
  assert.equal(notExecuted.executedAt, null, 'executedAt must not fall back to lastModified');
  assert.equal(notExecuted.updatedAt, '2026-01-10');
  assert.equal(notExecuted.result, 'NE');

  const failedWithoutDate = byKey.get('DLM-TC-3');
  assert.ok(failedWithoutDate, 'non-NE rows should survive when their parent cycle is date-scoped');
  assert.equal(failedWithoutDate.executedAt, null, 'executedAt must remain null when QMetry omits executedOn');
  assert.equal(failedWithoutDate.result, 'FAIL');

  assert.equal(byKey.get('DLM-TC-4')?.executedAt, '2026-07-02', 'epoch seconds should parse');
  assert.equal(byKey.get('DLM-TC-5')?.executedAt, '2026-07-03', 'epoch milliseconds should parse');
  assert.equal(byKey.get('DLM-TC-6')?.executedAt, '2026-07-04', 'dd-MMM date should parse');

  const undatedCalls: FetchCall[] = [];
  installUndatedCycleFetchMock(undatedCalls);
  const undated = await fetchQmetryExecutions(qmetryConfig(), { startDate: '2026-07-01', endDate: '2026-07-07', project: 'DLM' });
  const undatedKeys = new Set(undated.executions.map((row) => row.caseKey));
  assert.deepEqual([...undatedKeys].sort(), ['DLM-TC-12'], 'undated rows should not survive period filters unless the parent cycle has an in-scope date');

  console.log('qmetryClient tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
