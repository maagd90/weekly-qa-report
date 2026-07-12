import assert from 'assert';
import { fetchQmetryExecutions } from '../src/integrations/qmetryClient';
import type { QmetryIntegrationConfig } from '../src/config/loadIntegrations';

function required(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numericOrString(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

async function main(): Promise<void> {
  const baseUrl = required('QMETRY_BASE_URL').replace(/\/+$/, '');
  const projectId = required('QMETRY_PROJECT_ID');
  const projectKey = (process.env.QMETRY_PROJECT_KEY || 'DLM').trim();
  const email = (process.env.QMETRY_EMAIL || '').trim();
  const token = (process.env.QMETRY_API_TOKEN || '').trim();
  const folderId = (process.env.QMETRY_FOLDER_ID || '').trim();
  const startDate = (process.env.QMETRY_START_DATE || '2026-01-01').trim();
  const endDate = (process.env.QMETRY_END_DATE || new Date().toISOString().slice(0, 10)).trim();
  const requireTesters = boolEnv('QMETRY_REQUIRE_TESTERS', true);

  if (!process.env.QMETRY_BASIC_AUTH?.trim() && (!email || !token)) {
    throw new Error('Set QMETRY_BASIC_AUTH or both QMETRY_EMAIL and QMETRY_API_TOKEN');
  }

  const cycleFilter: Record<string, unknown> = { projectId: numericOrString(projectId) };
  if (folderId) cycleFilter.folderId = folderId;

  const cfg = {
    enabled: true,
    baseUrl,
    apiPrefix: (process.env.QMETRY_API_PREFIX || '/rest/qtm4j/ui/latest').trim(),
    auth: { type: 'basic' as const, email, token },
    authEncodedEnv: 'QMETRY_BASIC_AUTH',
    projectKey,
    projectId,
    testCyclesSearchPath: '/testcycles/search',
    testCyclesSearchBody: { filter: cycleFilter },
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCasesSearchBody: null,
    usePostSearch: true,
    testCaseFields: 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,build,updated',
    cycleIds: [],
    pageSize: Number(process.env.QMETRY_PAGE_SIZE || 50),
    maxPages: Number(process.env.QMETRY_MAX_PAGES || 200),
    sessionHeader: (process.env.QMETRY_SESSION_HEADER || '').trim() || undefined,
    sessionId: (process.env.QMETRY_SESSION_ID || '').trim() || undefined,
    xsrfToken: (process.env.QMETRY_XSRF_TOKEN || '').trim() || undefined,
  } as QmetryIntegrationConfig & { sessionHeader?: string; sessionId?: string; xsrfToken?: string };

  console.log('[qmetry-live-smoke] starting', { baseUrl, projectKey, projectId, folderId: folderId || 'all', startDate, endDate, requireTesters });
  const result = await fetchQmetryExecutions(cfg, { project: projectKey, startDate, endDate });

  const error = result.error || '';
  assert.doesNotMatch(error, /filter.*should not be null/i, 'QMetry testcase POST body is missing filter.projectId');
  assert.doesNotMatch(error, /method specified.*not allowed/i, 'QMetry testcase endpoint was called with an unsupported HTTP method');
  assert.ok(result.executions.length > 0, `No QMetry execution rows returned. ${error}`);

  const aggregateRows = result.executions.filter((row) => row.caseKey.includes('-PROGRESS-'));
  const detailedRows = result.executions.filter((row) => !row.caseKey.includes('-PROGRESS-'));
  const attributedRows = detailedRows.filter((row) => Boolean(row.tester));
  const testers = [...new Set(attributedRows.map((row) => row.tester).filter(Boolean))];
  const cycles = new Set(result.executions.map((row) => row.cycleKey));

  assert.ok(detailedRows.length > 0, `Only aggregate cycle progress was returned; detailed testcase rows are unavailable. ${error}`);
  if (requireTesters) assert.ok(attributedRows.length > 0, `Detailed rows were returned but none contain tester attribution. ${error}`);

  console.log('[qmetry-live-smoke] passed', {
    executions: result.executions.length,
    detailedRows: detailedRows.length,
    aggregateRows: aggregateRows.length,
    attributedRows: attributedRows.length,
    namedTesters: testers.length,
    cycles: cycles.size,
    sampleTesters: testers.slice(0, 10),
    warning: error || undefined,
  });
}

main().catch((error) => {
  console.error('[qmetry-live-smoke] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
