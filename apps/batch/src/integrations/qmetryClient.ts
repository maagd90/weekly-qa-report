import type { ApiFetchScope, ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig, QmetryIntegrationConfig } from '../config/loadIntegrations';
import { getBasicAuth, getEncodedAuth } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError, describeFetchError } from '../utils/fetchWithTimeout';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';
import {
  describeQmetryExecutionSummaryShape,
  executionRowsFromSummary,
  executionSummaryQql,
  parseQmetryExecutionSummary,
} from './qmetryExecutionSummary';

export interface QmetryCycleProgressEntry { name: string; count: number }
export interface QmetryCycleSummary { id: string; key?: string; name: string; status?: string; folderId?: string; updated?: string; plannedStartDate?: string; plannedEndDate?: string; progress?: QmetryCycleProgressEntry[] }
export interface QmetryFolderSummary { id: string; name: string; parentId?: string; path?: string }
export interface QmetryCycleHealthSummary { key: string; name: string; total: number; pass: number; fail: number; blocked: number; ne: number; na: number; passPct: number; coverage: number; status: string }
export interface QmetryCycleSearchResult { cycles: QmetryCycleSummary[]; total: number; error?: string }
export interface QmetryFolderSearchResult { folders: QmetryFolderSummary[]; total: number; error?: string }
export interface QmetryExecutionSummaryFetchResult { executions: ExecutionRow[]; total: number; error?: string }

type QmetrySessionConfig = QmetryIntegrationConfig & { sessionHeader?: string; sessionId?: string; xsrfToken?: string };

const TEST_CYCLE_FIELDS = 'key,summary,priority,status,assignee,reporter,testcaseExecutionProgress,plannedStartDate,plannedEndDate,updated,automationRule';
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const testerNameCache = new Map<string, string>();

function authHeader(cfg: QmetryIntegrationConfig): string | null {
  const encoded = getEncodedAuth(cfg.authEncodedEnv);
  if (encoded) return encoded.startsWith('Basic ') ? encoded : `Basic ${encoded}`;
  const basic = getBasicAuth(cfg.auth);
  return basic ? `Basic ${basic}` : null;
}

function cleanSessionHeader(value: string): string { return value.replace(/^Cookie:\s*/i, '').trim(); }

function nonJsonAuthError(text: string): string | null {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (/<html/i.test(compact) && /BIG-IP logout page|apm\.css|logout|login|Sign In|SSO/i.test(compact)) {
    return 'QMetry returned an HTML login/logout page instead of JSON. The browser session cookie is expired or not valid for API requests. Paste a fresh JSESSIONID / MRHSession / atlassian.xsrf.token cookie from an active JIRA tab and retry.';
  }
  if (/<html/i.test(compact)) {
    return `QMetry returned HTML instead of JSON. This usually means the request was redirected to login/SSO. Preview: ${compact.slice(0, 180)}`;
  }
  return null;
}

function qmetrySessionHeader(cfg: QmetryIntegrationConfig): string | null {
  const sessionCfg = cfg as QmetrySessionConfig;
  const full = sessionCfg.sessionHeader || process.env.QMETRY_SESSION_HEADER || process.env.JIRA_SESSION_HEADER || process.env.JIRA_COOKIE;
  if (full?.trim()) return cleanSessionHeader(full);
  const sessionId = sessionCfg.sessionId || process.env.QMETRY_SESSION_ID || process.env.JIRA_SESSION_ID;
  const xsrf = sessionCfg.xsrfToken || process.env.QMETRY_XSRF_TOKEN || process.env.JIRA_XSRF_TOKEN || process.env.ATLASSIAN_XSRF_TOKEN;
  const parts: string[] = [];
  if (sessionId?.trim()) parts.push(`JSESSIONID=${sessionId.trim()}`);
  if (xsrf?.trim()) parts.push(`atlassian.xsrf.token=${xsrf.trim()}`);
  return parts.length ? parts.join('; ') : null;
}

function qmetryXsrfToken(cfg: QmetryIntegrationConfig): string | null {
  const sessionCfg = cfg as QmetrySessionConfig;
  const direct = sessionCfg.xsrfToken || process.env.QMETRY_XSRF_TOKEN || process.env.JIRA_XSRF_TOKEN || process.env.ATLASSIAN_XSRF_TOKEN;
  if (direct?.trim()) return direct.trim();
  const cookie = qmetrySessionHeader(cfg) || '';
  const match = cookie.match(/(?:^|;\s*)atlassian\.xsrf\.token=([^;]+)/i);
  return match?.[1]?.trim() || null;
}

function requestHeaders(cfg: QmetryIntegrationConfig): Record<string, string> | null {
  const auth = authHeader(cfg);
  const sessionHeader = qmetrySessionHeader(cfg);
  if (!auth && !sessionHeader) return null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) headers.Authorization = auth;
  if (sessionHeader) headers.Cookie = sessionHeader;
  const xsrfToken = qmetryXsrfToken(cfg);
  if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;
  return headers;
}

async function qmetryFetch(cfg: QmetryIntegrationConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const headers = requestHeaders(cfg);
  if (!headers) return { ok: false, error: 'QMetry credentials not configured' };
  const url = `${cfg.baseUrl}${cfg.apiPrefix}${path}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  try {
    const res = await fetchWithTimeout(url, init);
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 431) return { ok: false, error: 'QMetry API error 431: request headers are too large. Refresh or trim the JIRA/QMetry session cookie, then retry.' };
      return { ok: false, error: safeApiError('QMetry API', res.status, text) };
    }
    const authError = nonJsonAuthError(text);
    if (authError) return { ok: false, error: authError };
    try { return { ok: true, data: text ? JSON.parse(text) : null }; } catch (err) { return { ok: false, error: `QMetry API returned invalid JSON: ${(err as Error).message}` }; }
  } catch (err) { return { ok: false, error: `QMetry API request failed: ${describeFetchError(err)}` }; }
}

function extractItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const p = data as { data?: unknown; values?: Record<string, unknown>[]; items?: Record<string, unknown>[]; results?: Record<string, unknown>[]; testCycles?: Record<string, unknown>[]; testCases?: Record<string, unknown>[]; folders?: Record<string, unknown>[]; rootFolders?: Record<string, unknown>[]; children?: Record<string, unknown>[] };
  if (Array.isArray(p?.data)) return p.data as Record<string, unknown>[];
  if (p?.data && typeof p.data === 'object') return extractItems(p.data);
  return p?.values || p?.items || p?.results || p?.testCycles || p?.testCases || p?.folders || p?.rootFolders || p?.children || [];
}

function extractTotal(data: unknown, fallback: number): number {
  const p = data as { total?: unknown; totalCount?: unknown; count?: unknown; recordsTotal?: unknown };
  const parsed = Number(p?.total ?? p?.totalCount ?? p?.recordsTotal ?? p?.count);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unwrapName(value: unknown): string {
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return sanitizeText(o.name ?? o.displayName ?? o.fullName ?? o.value ?? o.key);
  }
  return sanitizeText(value);
}

function unwrapUser(value: unknown): string {
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const nested = o.user ?? o.assignee ?? o.executedBy ?? o.executionAssignee ?? o.updatedBy;
    if (nested && nested !== value) {
      const nestedName = unwrapUser(nested);
      if (nestedName) return nestedName;
    }
    return sanitizeText(o.displayName ?? o.fullName ?? o.name ?? o.username ?? o.userName ?? o.emailAddress ?? o.value ?? o.key ?? o.accountId);
  }
  return sanitizeText(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function qmetryDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return qmetryDate(o.updatedOn ?? o.executedOn ?? o.lastModified ?? o.value ?? o.date);
  }
  const s = sanitizeText(raw);
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const ms = s.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/);
  if (m) {
    const [, dd, mon, yy] = m;
    const mm = MONTHS[mon.toLowerCase()];
    if (mm) return `${yy.length === 2 ? `20${yy}` : yy}-${mm}-${dd.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function normalizeCycle(item: Record<string, unknown>): QmetryCycleSummary | null {
  const id = sanitizeText(item.id || item.cycleId || item.testCycleId || item.entityId);
  const key = sanitizeText(item.key || item.cycleKey || item.testCycleKey);
  const name = sanitizeText(item.name || item.summary || item.cycleName || item.testCycleName) || key || id;
  const resolvedId = id || key;
  if (!resolvedId) return null;
  const cycle: QmetryCycleSummary = { id: resolvedId, name };
  const status = unwrapName(item.status || item.executionStatus);
  const folderId = sanitizeText(item.folderId || item.folder || item.folderID);
  const updated = qmetryDate(item.updated || item.updatedOn || item.lastModified);
  const plannedStart = qmetryDate(item.plannedStartDate);
  const plannedEnd = qmetryDate(item.plannedEndDate);
  if (key) cycle.key = key;
  if (status) cycle.status = status;
  if (folderId) cycle.folderId = folderId;
  if (updated) cycle.updated = updated;
  if (plannedStart) cycle.plannedStartDate = plannedStart;
  if (plannedEnd) cycle.plannedEndDate = plannedEnd;
  if (Array.isArray(item.testcaseExecutionProgress)) {
    const progress = (item.testcaseExecutionProgress as Record<string, unknown>[]).map((e) => ({ name: unwrapName(e.name), count: Number(e.count) || 0 })).filter((e) => e.name);
    if (progress.length) cycle.progress = progress;
  }
  return cycle;
}

function flattenFolderItems(items: Record<string, unknown>[], parentPath = '', parentId = ''): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    const name = sanitizeText(item.name || item.folderName || item.summary || item.label);
    const currentPath = parentPath && name ? `${parentPath} / ${name}` : name;
    const entry: Record<string, unknown> = { ...item };
    if (currentPath && !entry.path) entry.path = currentPath;
    if (parentId && !entry.parentId) entry.parentId = parentId;
    out.push(entry);
    const children = item.children ?? item.subFolders ?? item.childFolders ?? item.folders ?? item.childNodes;
    if (Array.isArray(children) && children.length) {
      const id = sanitizeText(item.id || item.folderId || item.folderID || item.entityId || item.key);
      out.push(...flattenFolderItems(children as Record<string, unknown>[], currentPath, id));
    }
  }
  return out;
}

function normalizeFolder(item: Record<string, unknown>): QmetryFolderSummary | null {
  const id = sanitizeText(item.id || item.folderId || item.folderID || item.entityId || item.key);
  const name = sanitizeText(item.name || item.folderName || item.summary || item.label) || id;
  if (!id) return null;
  const folder: QmetryFolderSummary = { id, name };
  const parentId = sanitizeText(item.parentId || item.parentFolderId || item.parentID);
  const path = sanitizeText(item.path || item.folderPath || item.fullPath);
  if (parentId) folder.parentId = parentId;
  if (path) folder.path = path;
  return folder;
}

function numericProjectId(cfg: QmetryIntegrationConfig): number | string | null {
  if (!cfg.projectId) return null;
  return /^\d+$/.test(cfg.projectId) ? Number(cfg.projectId) : cfg.projectId;
}

function projectBody(cfg: QmetryIntegrationConfig): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const projectId = numericProjectId(cfg);
  if (projectId !== null) filter.projectId = projectId;
  return { filter };
}

function filterBody(cfg: QmetryIntegrationConfig, folderId?: string): Record<string, unknown> {
  const body = projectBody(cfg);
  const filter = body.filter as Record<string, unknown>;
  if (folderId && folderId !== 'all') filter.folderId = folderId;
  return body;
}

function cycleSearchPath(cfg: QmetryIntegrationConfig, startAt: number, maxResults: number): string {
  const basePath = (cfg.testCyclesSearchPath || '/testcycles/search').replace('{projectId}', encodeURIComponent(cfg.projectId || ''));
  return `${basePath}?${new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults), fields: TEST_CYCLE_FIELDS })}`;
}

function dateInScope(value: string | null | undefined, scope?: ApiFetchScope): boolean {
  if (!scope?.startDate && !scope?.endDate) return true;
  const date = (value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (scope.startDate && date < scope.startDate) return false;
  if (scope.endDate && date > scope.endDate) return false;
  return true;
}

function dateRangeOverlapsScope(startDate: string | null | undefined, endDate: string | null | undefined, scope?: ApiFetchScope): boolean {
  if (!scope?.startDate && !scope?.endDate) return true;
  const start = (startDate || endDate || '').slice(0, 10);
  const end = (endDate || startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  if (scope.startDate && end < scope.startDate) return false;
  if (scope.endDate && start > scope.endDate) return false;
  return true;
}

function cycleInScope(cycle: QmetryCycleSummary, scope?: ApiFetchScope): boolean {
  if (!scope?.startDate && !scope?.endDate) return true;
  if (cycle.plannedStartDate || cycle.plannedEndDate) return dateRangeOverlapsScope(cycle.plannedStartDate, cycle.plannedEndDate, scope);
  if (cycle.updated) return dateInScope(cycle.updated, scope);
  return true;
}

function cycleHasUsableScopeDate(cycle: QmetryCycleSummary): boolean {
  return Boolean(cycle.plannedStartDate || cycle.plannedEndDate || cycle.updated);
}

function cycleDateFallback(cycle: QmetryCycleSummary): string | null {
  return cycle.updated || cycle.plannedEndDate || cycle.plannedStartDate || null;
}

function sameProject(left: string | null | undefined, right: string | null | undefined): boolean {
  return sanitizeText(left).toUpperCase() === sanitizeText(right).toUpperCase();
}

function executionInScope(row: ExecutionRow, scope?: ApiFetchScope, allowUndatedScopedCycleRows = false): boolean {
  if (scope?.project && scope.project !== 'all' && !sameProject(row.project, scope.project)) return false;
  if (!scope?.startDate && !scope?.endDate) return true;
  if (row.executedAt) return dateInScope(row.executedAt, scope);
  if (row.updatedAt) return dateInScope(row.updatedAt, scope);
  return allowUndatedScopedCycleRows;
}

function progressRowsFromCycle(cycle: QmetryCycleSummary, projectKey?: string): ExecutionRow[] {
  const progress = cycle.progress || [];
  if (!progress.length) return [];
  const cycleKey = cycle.key || cycle.id;
  const cycleName = cycle.name || cycleKey;
  const fallbackDate = cycleDateFallback(cycle);
  const projectFromCycle = projectFromKey(cycleKey);
  const project = projectFromCycle === 'UNKNOWN' ? (projectKey || 'UNKNOWN') : projectFromCycle;
  const rows: ExecutionRow[] = [];
  for (const entry of progress) {
    const count = Math.max(0, Math.floor(Number(entry.count) || 0));
    if (!count) continue;
    const result = mapExecutionResult(entry.name);
    for (let i = 0; i < count; i++) {
      rows.push({
        project,
        cycleKey,
        cycleName,
        caseKey: `${cycleKey}-PROGRESS-${result}-${i + 1}`,
        result,
        tester: null,
        executedAt: null,
        updatedAt: fallbackDate,
        source: 'qmetry',
      });
    }
  }
  return rows;
}

function compactWarnings(warnings: string[]): string {
  if (!warnings.length) return '';
  const unique = [...new Set(warnings.filter(Boolean))];
  const detailFailures = unique.filter((warning) => /QMetry API|request failed|invalid JSON|login\/logout|redirected to login/i.test(warning));
  const notices = unique.filter((warning) => !detailFailures.includes(warning));
  const parts: string[] = [];
  if (detailFailures.length) {
    const first = detailFailures[0].replace(/^.*?:\s*/, '').replace(/\s+/g, ' ').slice(0, 180);
    parts.push(`QMetry detail retrieval failed for ${detailFailures.length} cycle(s). Aggregate execution progress was used where available; Quality Assurance attribution may be incomplete.${first ? ` First error: ${first}` : ''}`);
  }
  parts.push(...notices.slice(0, 2));
  if (notices.length > 2) parts.push(`${notices.length - 2} more QMetry notice(s)`);
  return parts.join(' ');
}

export async function fetchQmetryExecutionSummaryByAssignee(
  cfg: QmetryIntegrationConfig,
  scope?: ApiFetchScope,
): Promise<QmetryExecutionSummaryFetchResult> {
  if (cfg.executionSummaryEnabled === false) return { executions: [], total: 0 };
  if (!scope?.startDate || !scope?.endDate) return { executions: [], total: 0 };
  const projectId = numericProjectId(cfg);
  if (typeof projectId !== 'number') {
    return { executions: [], total: 0, error: 'QMetry execution summary requires a numeric Project ID.' };
  }

  const body = {
    projectIds: [projectId],
    qql: executionSummaryQql(scope.startDate, scope.endDate),
    customFieldQQL: [],
    defectJql: null,
    requirementJql: null,
  };
  const path = cfg.executionSummaryPath || '/gadgets/TESTCASE_EXECUTION_SUMMARY_BY_ASSIGNEE';
  const response = await qmetryFetch(cfg, 'POST', path, body);
  if (!response.ok) return { executions: [], total: 0, error: response.error || 'QMetry execution summary request failed' };
  const parsed = parseQmetryExecutionSummary(response.data);
  if (!parsed) {
    const shape = describeQmetryExecutionSummaryShape(response.data);
    return { executions: [], total: 0, error: `QMetry execution summary returned an unsupported response shape (${shape}). Detailed cycle data was kept.` };
  }
  return {
    executions: executionRowsFromSummary(parsed, cfg.projectKey, scope.startDate, scope.endDate),
    total: parsed.total,
  };
}

export async function searchQmetryTestCycles(cfg: QmetryIntegrationConfig, options: { startAt?: number; maxResults?: number; folderId?: string } = {}): Promise<QmetryCycleSearchResult> {
  if (!cfg.enabled) return { cycles: [], total: 0 };
  if (!cfg.projectId && !cfg.testCyclesSearchBody) return { cycles: [], total: 0, error: 'QMetry projectId is required for test cycle search' };
  const body = options.folderId ? filterBody(cfg, options.folderId) : (cfg.testCyclesSearchBody || filterBody(cfg));
  const path = cycleSearchPath(cfg, options.startAt ?? 0, options.maxResults ?? cfg.pageSize);
  const result = await qmetryFetch(cfg, 'POST', path, body);
  if (!result.ok) return { cycles: [], total: 0, error: result.error || 'QMetry test cycle search failed' };
  const items = extractItems(result.data);
  const cycles = items.map(normalizeCycle).filter((c): c is QmetryCycleSummary => Boolean(c));
  return { cycles, total: extractTotal(result.data, cycles.length) };
}

export async function searchQmetryFolders(cfg: QmetryIntegrationConfig, options: { startAt?: number; maxResults?: number } = {}): Promise<QmetryFolderSearchResult> {
  if (!cfg.enabled) return { folders: [], total: 0 };
  if (!cfg.projectId) return { folders: [], total: 0, error: 'QMetry projectId is required for folder search' };
  const qs = new URLSearchParams({ startAt: String(options.startAt ?? 0), maxResults: String(options.maxResults ?? cfg.pageSize) });
  const candidates: Array<{ method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }> = [
    { method: 'POST', path: `/projects/${encodeURIComponent(cfg.projectId)}/testcycle-folders?sort=NAME:ASC`, body: projectBody(cfg) },
    { method: 'GET', path: `/projects/${encodeURIComponent(cfg.projectId)}/testcycle-folders?sort=NAME:ASC` },
    { method: 'POST', path: `/testcycles/folders/search?${qs}`, body: projectBody(cfg) },
    { method: 'POST', path: `/folders/search?${qs}`, body: projectBody(cfg) },
    { method: 'GET', path: `/testcycles/folders?${qs}` },
  ];
  let lastError = '';
  for (const candidate of candidates) {
    const result = await qmetryFetch(cfg, candidate.method, candidate.path, candidate.body);
    if (!result.ok) { lastError = result.error || 'Folder search failed'; continue; }
    const items = flattenFolderItems(extractItems(result.data));
    const folders = items.map(normalizeFolder).filter((f): f is QmetryFolderSummary => Boolean(f));
    if (!folders.length) { lastError = 'Folder endpoint responded but no folders were parsed'; continue; }
    return { folders, total: extractTotal(result.data, folders.length) };
  }
  return { folders: [], total: 0, error: lastError || 'QMetry folder search failed' };
}

export async function fetchProjectFolders(cfg: QmetryIntegrationConfig): Promise<QmetryFolderSummary[]> {
  const folders: QmetryFolderSummary[] = [{ id: 'all', name: 'All folders' }];
  let startAt = 0;
  for (let page = 0; page < cfg.maxPages; page++) {
    const result = await searchQmetryFolders(cfg, { startAt, maxResults: cfg.pageSize });
    if (result.error) break;
    folders.push(...result.folders);
    startAt += result.folders.length;
    if (!result.folders.length || startAt >= result.total) break;
  }
  return folders;
}

export async function fetchProjectCycles(cfg: QmetryIntegrationConfig, folderId?: string): Promise<{ id: string; name: string }[]> {
  const cycles: { id: string; name: string }[] = [];
  let startAt = 0;
  for (let page = 0; page < cfg.maxPages; page++) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize, folderId });
    if (result.error) break;
    cycles.push(...result.cycles.map((c) => ({ id: c.id, name: c.name })));
    startAt += result.cycles.length;
    if (!result.cycles.length || startAt >= result.total) break;
  }
  return cycles;
}

function normalizeTestCase(tc: Record<string, unknown>, cycleKey: string, cycleName: string, fallbackUpdatedAt: string | null = null): ExecutionRow | null {
  const nestedTestCase = objectValue(tc.testCase);
  const execution = objectValue(tc.execution || tc.executionDetails || tc.latestExecution);
  const updated = objectValue(tc.updated);
  const executionUpdated = objectValue(execution.updated);
  const caseKey = sanitizeText(tc.key || tc.testCaseKey || tc.issueKey || nestedTestCase.key || nestedTestCase.testCaseKey || nestedTestCase.issueKey);
  if (!caseKey) return null;
  const executedAt = qmetryDate(tc.executedOn ?? execution.executedOn ?? execution.executedAt);
  const updatedAt = qmetryDate(tc.updated) || qmetryDate(tc.lastModified) || qmetryDate(execution.updated) || qmetryDate(execution.lastModified) || executedAt || fallbackUpdatedAt;
  const resultText = unwrapName(tc.executionResult) || unwrapName(execution.executionResult) || unwrapName(tc.status) || unwrapName(execution.status);
  const result = mapExecutionResult(resultText);
  const directTester = unwrapUser(tc.executedBy) || unwrapUser(execution.executedBy) || unwrapUser(tc.executionAssignee) || unwrapUser(execution.executionAssignee);
  const updatedBy = unwrapUser(updated.updatedBy) || unwrapUser(executionUpdated.updatedBy);
  const tester = directTester || (result !== 'NE' ? updatedBy : '');
  return { project: projectFromKey(caseKey), cycleKey, cycleName, caseKey, result, tester: tester || null, executedAt, updatedAt, source: 'qmetry' };
}

function testCaseSearchBody(cfg: QmetryIntegrationConfig): Record<string, unknown> {
  const configured = objectValue(cfg.testCasesSearchBody);
  const configuredFilter = objectValue(configured.filter);
  const defaultFilter = objectValue(projectBody(cfg).filter);
  return { ...configured, filter: { ...defaultFilter, ...configuredFilter } };
}

function invalidFieldsError(error?: string): boolean { return /field|fields|invalid|not supported/i.test(error || ''); }

async function fetchCycleExecutions(cfg: QmetryIntegrationConfig, cycleId: string, cycleNameHint?: string, scope?: ApiFetchScope, cycleKeyHint?: string, allowUndatedScopedCycleRows = false, fallbackUpdatedAt: string | null = null): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleKeyHint || cycleId;
  let cycleName = cycleNameHint || cycleId;
  let startAt = 0;
  let includeFields = true;
  const method: 'GET' | 'POST' = cfg.usePostSearch ? 'POST' : 'GET';
  const searchPath = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
  const body = testCaseSearchBody(cfg);

  for (let page = 0; page < cfg.maxPages; page++) {
    const buildQs = (withFields: boolean) => {
      const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(cfg.pageSize) });
      if (withFields && cfg.testCaseFields) qs.set('fields', cfg.testCaseFields);
      return qs;
    };
    const request = (withFields: boolean) => qmetryFetch(cfg, method, `${searchPath}?${buildQs(withFields)}`, method === 'POST' ? body : undefined);

    let result = await request(includeFields);
    if (!result.ok && includeFields && invalidFieldsError(result.error)) {
      result = await request(false);
      if (result.ok) includeFields = false;
    }
    if (!result.ok) return { executions, cycleKey, cycleName, error: result.error };

    const items = extractItems(result.data);
    if (!items.length) break;
    for (const item of items) {
      if (item.cycleKey) cycleKey = sanitizeText(item.cycleKey);
      if (item.cycleSummary || item.cycleName) cycleName = sanitizeText(item.cycleSummary || item.cycleName);
      const row = normalizeTestCase(item, cycleKey, cycleName, fallbackUpdatedAt);
      if (row && executionInScope(row, scope, allowUndatedScopedCycleRows)) executions.push(row);
    }
    const total = extractTotal(result.data, startAt + items.length);
    startAt += items.length;
    if (items.length < cfg.pageSize || startAt >= total) break;
  }
  return { executions, cycleKey, cycleName };
}

function looksLikeUserIdentifier(value: string): boolean {
  const clean = value.trim();
  if (!clean || clean.includes(' ') || clean.includes('@')) return false;
  return /^(JIRAUSER\d+|[A-Za-z]\d{4,}|[A-Za-z0-9._-]+)$/i.test(clean);
}

async function resolveQmetryUserDisplayName(cfg: QmetryIntegrationConfig, identifier: string): Promise<string> {
  const clean = identifier.trim();
  if (!looksLikeUserIdentifier(clean)) return clean;
  const cacheKey = `${cfg.baseUrl}|${clean.toLowerCase()}`;
  const cached = testerNameCache.get(cacheKey);
  if (cached) return cached;
  const headers = requestHeaders(cfg);
  if (!headers) return clean;

  for (const parameter of ['key', 'username']) {
    const url = `${cfg.baseUrl}/rest/api/2/user?${parameter}=${encodeURIComponent(clean)}`;
    try {
      const response = await fetchWithTimeout(url, { method: 'GET', headers });
      if (!response.ok) continue;
      const text = await response.text();
      const authError = nonJsonAuthError(text);
      if (authError) continue;
      const data = JSON.parse(text) as Record<string, unknown>;
      const resolved = unwrapUser(data);
      if (resolved && resolved.toLowerCase() !== clean.toLowerCase()) {
        testerNameCache.set(cacheKey, resolved);
        return resolved;
      }
    } catch {
      // Tester-name enrichment is best-effort. Keep the QMetry identifier when JIRA user lookup is unavailable.
    }
  }
  testerNameCache.set(cacheKey, clean);
  return clean;
}

async function hydrateTesterDisplayNames(cfg: QmetryIntegrationConfig, rows: ExecutionRow[]): Promise<ExecutionRow[]> {
  const identifiers = [...new Set(rows.map((row) => row.tester || '').filter(looksLikeUserIdentifier))];
  if (!identifiers.length) return rows;
  const resolved = new Map<string, string>();
  for (const identifier of identifiers) resolved.set(identifier, await resolveQmetryUserDisplayName(cfg, identifier));
  return rows.map((row) => row.tester && resolved.has(row.tester) ? { ...row, tester: resolved.get(row.tester)! } : row);
}

function summarizeCycle(cycleKey: string, cycleName: string, executions: ExecutionRow[]): QmetryCycleHealthSummary {
  const total = executions.length;
  const pass = executions.filter((e) => e.result === 'PASS').length;
  const fail = executions.filter((e) => e.result === 'FAIL').length;
  const blocked = executions.filter((e) => e.result === 'BLOCKED').length;
  const ne = executions.filter((e) => e.result === 'NE').length;
  const na = executions.filter((e) => e.result === 'NA').length;
  const executed = pass + fail + blocked + na;
  return { key: cycleKey, name: cycleName, total, pass, fail, blocked, ne, na, passPct: executed ? Math.round((pass / executed) * 100) : 0, coverage: total ? Math.round((executed / total) * 100) : 0, status: !executed ? 'Not Started' : fail || blocked ? 'At Risk' : ne ? 'In Progress' : 'Healthy' };
}

export async function fetchFolderCycleHealth(cfg: QmetryIntegrationConfig, folderId?: string, scope?: ApiFetchScope): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  const found = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (found.error) return { cycles: [], error: found.error };
  const cycles: QmetryCycleHealthSummary[] = [];
  const warnings: string[] = [];
  const scopedCycles = found.cycles.filter((cycle) => cycleInScope(cycle, scope));
  for (const cycle of scopedCycles) {
    const result = await fetchCycleExecutions(cfg, cycle.id, cycle.name, scope, cycle.key || cycle.id, cycleHasUsableScopeDate(cycle), cycleDateFallback(cycle));
    if (result.error) warnings.push(`${cycle.name}: ${result.error}`);
    const rows = result.executions.length ? result.executions : progressRowsFromCycle(cycle, cfg.projectKey);
    cycles.push(summarizeCycle(result.cycleKey || cycle.key || cycle.id, result.cycleName || cycle.name, rows));
  }
  const error = compactWarnings(warnings);
  return error ? { cycles, error } : { cycles };
}

async function discoverProjectCyclesForExecution(cfg: QmetryIntegrationConfig, scope?: ApiFetchScope): Promise<{ cycles: QmetryCycleSummary[]; error?: string }> {
  const cycles: QmetryCycleSummary[] = [];
  let startAt = 0;
  for (let page = 0; page < cfg.maxPages; page++) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize });
    if (result.error) return { cycles, error: result.error };
    cycles.push(...result.cycles.filter((cycle) => cycleInScope(cycle, scope)));
    startAt += result.cycles.length;
    if (!result.cycles.length || startAt >= result.total) break;
  }
  return { cycles };
}

export async function fetchQmetryExecutions(cfg: QmetryIntegrationConfig, scope?: ApiFetchScope): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };
  const summary = await fetchQmetryExecutionSummaryByAssignee(cfg, scope);
  const warnings: string[] = [];
  if (summary.error) warnings.push(`QMetry execution summary unavailable; detailed cycle fallback used: ${summary.error}`);
  else if (summary.executions.length) warnings.push(`QMetry execution-level summary applied for ${scope?.startDate}..${scope?.endDate}: ${summary.total} result(s), using execution.executedon and latest executions only.`);

  let cycles: QmetryCycleSummary[] = cfg.cycleIds.map((id) => ({ id, key: id, name: id }));
  if (!cycles.length && cfg.projectId) {
    const discovered = await discoverProjectCyclesForExecution(cfg, scope);
    if (discovered.error) {
      warnings.push(`QMetry test cycle search failed: ${discovered.error}`);
      if (summary.executions.length) {
        const error = compactWarnings(warnings);
        return { executions: summary.executions, cycleMeta: new Map(), ...(error ? { error } : {}) };
      }
      return { executions: [], cycleMeta: new Map(), error: compactWarnings(warnings) };
    }
    cycles = discovered.cycles;
  }
  if (!cycles.length) {
    const project = cfg.projectKey || cfg.projectId || 'unknown project';
    const range = scope?.startDate || scope?.endDate ? ` in ${scope.startDate || 'any'}..${scope.endDate || 'any'}` : '';
    warnings.push(`No QMetry test cycles found for ${project}${range}. Check Project ID, Folder ID, and session/auth headers.`);
    const error = compactWarnings(warnings);
    return summary.executions.length
      ? { executions: summary.executions, cycleMeta: new Map(), ...(error ? { error } : {}) }
      : { executions: [], cycleMeta: new Map(), error };
  }
  const all: ExecutionRow[] = [];
  const cycleMeta = new Map<string, string>();
  let usedProgressFallback = false;
  for (const cycle of cycles) {
    const result = await fetchCycleExecutions(cfg, cycle.id, cycle.name, scope, cycle.key || cycle.id, cycleHasUsableScopeDate(cycle), cycleDateFallback(cycle));
    if (result.error) warnings.push(`${cycle.name || cycle.id}: ${result.error}`);
    const fallbackRows = !result.executions.length ? progressRowsFromCycle(cycle, cfg.projectKey) : [];
    if (fallbackRows.length) usedProgressFallback = true;
    all.push(...(result.executions.length ? result.executions : fallbackRows));
    cycleMeta.set(result.cycleKey || cycle.key || cycle.id, result.cycleName || cycle.name || cycle.id);
  }
  const hydrated = await hydrateTesterDisplayNames(cfg, all);
  if (!hydrated.length && !warnings.length) {
    warnings.push(`QMetry cycles were found, but no testcase execution rows or cycle-level progress counts were available for ${cfg.projectKey || cfg.projectId || 'the configured project'}. Check the testcase search path, selected date range, and session permissions.`);
  } else if (usedProgressFallback) {
    warnings.push('One or more cycles used aggregate QMetry execution progress because detailed testcase rows were unavailable. Aggregate rows do not include Executed By and are excluded from Quality Assurance rankings.');
  }
  const executions = [...hydrated, ...summary.executions];
  const error = compactWarnings(warnings);
  return error ? { executions, cycleMeta, error } : { executions, cycleMeta };
}

export async function fetchQmetryDataset(cfg: IntegrationsConfig, scope?: ApiFetchScope): Promise<import('../types/dataset').Dataset> {
  const ds = emptyDataset();
  const { executions, cycleMeta, error } = await fetchQmetryExecutions(cfg.qmetry, scope);
  ds.executions = executions.map((e) => ({ ...e, cycleName: cycleMeta.get(e.cycleKey) || e.cycleName }));
  ds.meta.fetchedAt = new Date().toISOString();
  ds.meta.integrations.qmetry = true;
  if (error) ds.meta.warnings.push(error);
  if (executions.length) {
    ds.files.push({ name: 'qmetry-api', ext: 'API', project: executions[0]?.project || cfg.qmetry.projectKey, rows: executions.length, status: 'parsed', detectedType: 'test-execution', source: 'qmetry-api' });
    ds.projects = [...new Set(executions.map((e) => e.project))];
  }
  return ds;
}
