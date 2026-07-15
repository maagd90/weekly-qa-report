import assert from 'assert';
import { fetchQmetryExecutionSummaryByAssignee, fetchQmetryExecutions } from '../qmetryClient';
import { parseQmetryExecutionSummary } from '../qmetryExecutionSummary';
import type { QmetryIntegrationConfig } from '../../config/loadIntegrations';
import { emptyDataset } from '../../types/dataset';
import { buildDashboardPayload } from '../../export/buildDashboardPayload';

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
    executionSummaryEnabled: false,
    executionSummaryPath: '/gadgets/TESTCASE_EXECUTION_SUMMARY_BY_ASSIGNEE',
  };
}

async function testExecutionSummaryUsesActualExecutionDateQql(): Promise<void> {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init: init || {} };
    calls.push(call);
    if (!url.includes('/gadgets/TESTCASE_EXECUTION_SUMMARY_BY_ASSIGNEE')) return jsonResponse({ errorMessage: `Unexpected URL ${url}` }, 404);
    return jsonResponse({
      data: {
        column: ['Assignee', 'Testcase/Teststep Execution Result', 'Execution Result Color', 'Count'],
        rows: [
          ['Muhammad Annus', 'BLOCKED', '#CCC', '106'],
          ['Muhammad Annus', 'FAIL', '#D04437', '2'],
          ['Muhammad Annus', 'PASS', '#14892C', '69'],
          ['Unassigned', 'FAIL', '#D04437', '3'],
          ['Unassigned', 'NOT APPLICABLE', '#f5a623', '5'],
          ['Unassigned', 'PASS', '#14892C', '17'],
        ],
        userAccountIdDisplayNames: {
          JIRAUSER31341: 'Muhammad Annus',
          Unassigned: 'Unassigned',
        },
        executionResults: ['BLOCKED', 'FAIL', 'WORK IN PROGRESS', 'NOT EXECUTED', 'PASS', 'NOT APPLICABLE'],
      },
    });
  }) as typeof fetch;

  const cfg = qmetryConfig() as QmetryIntegrationConfig & { sessionHeader?: string; xsrfToken?: string };
  cfg.executionSummaryEnabled = true;
  cfg.sessionHeader = 'JSESSIONID=abc; atlassian.xsrf.token=cookie-token';
  cfg.xsrfToken = 'header-token';
  const result = await fetchQmetryExecutionSummaryByAssignee(cfg, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14' });

  assert.equal(result.error, undefined);
  assert.equal(result.total, 202);
  assert.equal(result.executions.length, 202);
  assert.equal(result.executions.filter((row) => row.result === 'PASS').length, 86);
  assert.equal(result.executions.filter((row) => row.result === 'FAIL').length, 5);
  assert.equal(result.executions.filter((row) => row.result === 'BLOCKED').length, 106);
  assert.equal(result.executions.filter((row) => row.result === 'NA').length, 5);
  assert.equal(result.executions.filter((row) => row.tester === 'Muhammad Annus').length, 177);
  assert.equal(result.executions.filter((row) => row.tester === null).length, 25, 'Unassigned executions stay in overall metrics but not tester rankings');
  assert.ok(result.executions.every((row) => row.summaryOnly));
  assert.ok(result.executions.every((row) => row.executedAt === null && row.updatedAt === null), 'summary rows must not invent an execution date');

  const dataset = emptyDataset();
  dataset.executions = result.executions;
  dataset.projects = ['DLM'];
  const dashboard = buildDashboardPayload(dataset, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14' });
  assert.deepEqual(
    { ...dashboard.overview, resultMix: undefined, byMonth: undefined, chartSeries: undefined },
    { totalCases: 202, executed: 202, passRate: 43, failed: 5, blocked: 106, resultMix: undefined, byMonth: undefined, chartSeries: undefined },
    'overall KPIs must include Unassigned rows and use PASS / all executed statuses for pass rate',
  );
  assert.equal(dashboard.testers.length, 1, 'Unassigned must be excluded only from tester ranking');
  assert.deepEqual(dashboard.testers[0], { name: 'Muhammad Annus', executed: 177, pass: 69, fail: 2, blocked: 106, na: 0, passPct: 39 });

  const call = calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal((call.init.headers as Record<string, string>)['X-XSRF-TOKEN'], 'header-token');
  const body = requestBody(call) as { projectIds: number[]; qql: string; customFieldQQL: unknown[]; defectJql: null; requirementJql: null };
  assert.deepEqual(body.projectIds, [19703]);
  assert.match(body.qql, /execution\.executedon >= '01\/Jul\/2026'/);
  assert.match(body.qql, /execution\.executedon <= '14\/Jul\/2026'/);
  assert.match(body.qql, /execution\.onlylatestexecutions = true/);
  assert.match(body.qql, /testcase\.includearchive = false/);
  assert.match(body.qql, /testcycle\.includearchive = false/);

  const named = parseQmetryExecutionSummary({
    data: [{ assignee: { displayName: 'Named Tester' }, passedCount: 7, failedCount: 1, notExecuted: 2 }],
  });
  assert.equal(named?.total, 10, 'camel-case named counts should be recognized');

  const nested = parseQmetryExecutionSummary({
    data: [{ assigneeName: 'Nested Tester', results: [{ name: 'Pass', count: 4 }, { name: 'Blocked', count: 1 }] }],
  });
  assert.equal(nested?.total, 5, 'nested result rows should inherit their parent assignee');
  assert.ok(nested?.counts.every((row) => row.assignee === 'Nested Tester'));

  const points = parseQmetryExecutionSummary({
    series: [{ name: 'Pass', data: [{ name: 'Point Tester', y: 6 }] }],
  });
  assert.equal(points?.total, 6, 'Highcharts-style named points should be recognized');

  const chart = parseQmetryExecutionSummary({
    categories: ['Pass', 'Fail', 'Blocked', 'Not Executed'],
    series: [
      { name: 'Muhammad Annus', data: [100, 2, 3, 0] },
      { name: 'Second Tester', data: [8, 1, 0, 0] },
    ],
  });
  assert.equal(chart?.total, 114, 'chart-oriented gadget responses should remain supported');

  const empty = parseQmetryExecutionSummary({ categories: ['Pass', 'Fail'], series: [{ name: 'Nobody', data: [0, 0] }] });
  assert.equal(empty?.total, 0, 'a recognized zero-result response must remain authoritative');

  const workInProgress = parseQmetryExecutionSummary({
    data: {
      column: ['Assignee', 'Testcase/Teststep Execution Result', 'Execution Result Color', 'Count'],
      rows: [['Muhammad Annus', 'WORK IN PROGRESS', '#123456', '4']],
      userAccountIdDisplayNames: { JIRAUSER31341: 'Muhammad Annus' },
      executionResults: ['WORK IN PROGRESS'],
    },
  });
  assert.equal(workInProgress?.total, 4);
  assert.equal(workInProgress?.counts[0]?.result, 'NE', 'work in progress is pending, not executed');

  const emiratesRows = parseQmetryExecutionSummary({
    data: {
      column: [
        { field: 'userAccountId', label: 'Assignee' },
        { id: 176, label: 'Pass' },
        { id: 173, label: 'Fail' },
        { id: 172, label: 'Blocked' },
        { id: 175, label: 'Not Executed' },
      ],
      rows: [
        ['JIRAUSER31341', 100, 2, 3, 0],
        ['JIRAUSER31789', 8, 1, 0, 0],
      ],
      userAccountIdDisplayNames: {
        JIRAUSER31341: 'Muhammad Annus',
        JIRAUSER31789: 'Second Tester',
      },
      executionResults: [
        { id: 172, name: 'Blocked' },
        { id: 173, name: 'Fail' },
        { id: 175, name: 'Not Executed' },
        { id: 176, name: 'Pass' },
      ],
    },
  });
  assert.equal(emiratesRows?.total, 114, 'Emirates tabular response with assignees as rows should be recognized');
  assert.equal(emiratesRows?.counts.find((row) => row.assignee === 'Muhammad Annus' && row.result === 'PASS')?.count, 100);

  const emiratesColumns = parseQmetryExecutionSummary({
    data: {
      column: ['JIRAUSER31341', 'JIRAUSER31789'],
      rows: [
        [100, 8],
        [2, 1],
        [3, 0],
        [0, 0],
      ],
      userAccountIdDisplayNames: {
        JIRAUSER31341: 'Muhammad Annus',
        JIRAUSER31789: 'Second Tester',
      },
      executionResults: [
        { id: 176, name: 'Pass' },
        { id: 173, name: 'Fail' },
        { id: 172, name: 'Blocked' },
        { id: 175, name: 'Not Executed' },
      ],
    },
  });
  assert.equal(emiratesColumns?.total, 114, 'Emirates tabular response with assignees as columns should be recognized');
  assert.equal(emiratesColumns?.counts.find((row) => row.assignee === 'Second Tester' && row.result === 'PASS')?.count, 8);

  const emiratesObjectRows = parseQmetryExecutionSummary({
    data: {
      column: [{ field: 'userAccountId' }, { field: '176' }, { field: '173' }],
      rows: [{ userAccountId: 'JIRAUSER31341', 176: 100, 173: 2 }],
      userAccountIdDisplayNames: { JIRAUSER31341: 'Muhammad Annus' },
      executionResults: [{ id: 176, name: 'Pass' }, { id: 173, name: 'Fail' }],
    },
  });
  assert.equal(emiratesObjectRows?.total, 102, 'Emirates object rows keyed by execution-result ID should be recognized');
  assert.ok(emiratesObjectRows?.counts.every((row) => row.assignee === 'Muhammad Annus'));

  const emiratesNestedRows = parseQmetryExecutionSummary({
    data: {
      column: ['JIRAUSER31341'],
      rows: [{
        column: 'JIRAUSER31341',
        rows: [
          { executionResultId: 176, count: 100 },
          { executionResultId: 173, count: 2 },
        ],
      }],
      userAccountIdDisplayNames: { JIRAUSER31341: 'Muhammad Annus' },
      executionResults: [{ id: 176, name: 'Pass' }, { id: 173, name: 'Fail' }],
    },
  });
  assert.equal(emiratesNestedRows?.total, 102, 'nested tabular cells should resolve result IDs without double counting');

  const emiratesColumnSeries = parseQmetryExecutionSummary({
    data: {
      column: [
        { executionResultId: 176, data: [100, 8] },
        { executionResultId: 173, data: [2, 1] },
      ],
      rows: ['JIRAUSER31341', 'JIRAUSER31789'],
      userAccountIdDisplayNames: {
        JIRAUSER31341: 'Muhammad Annus',
        JIRAUSER31789: 'Second Tester',
      },
      executionResults: [{ id: 176, name: 'Pass' }, { id: 173, name: 'Fail' }],
    },
  });
  assert.equal(emiratesColumnSeries?.total, 111, 'result columns containing per-assignee series should be recognized');
  assert.equal(emiratesColumnSeries?.counts.find((row) => row.assignee === 'Second Tester' && row.result === 'PASS')?.count, 8);
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
  assert.match(fallback.error || '', /Quality Assurance attribution may be incomplete/i);
  assert.ok((fallback.error || '').length < 500, 'stakeholder warning must remain concise');
  assert.equal(calls.some((call) => call.url.includes('/testcases/search') && call.init.method === 'GET'), false);
}

async function main(): Promise<void> {
  await testExecutionSummaryUsesActualExecutionDateQql();
  await testOnPremContractAndTesterResolution();
  await testFieldRetryKeepsPostContract();
  await testAggregateFallbackIsExplicitAndConcise();
  console.log('qmetryClient tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
