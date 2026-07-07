import type { ApiFetchScope, ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig, QmetryIntegrationConfig } from '../config/loadIntegrations';
import { getBasicAuth, getEncodedAuth } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError, describeFetchError } from '../utils/fetchWithTimeout';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';

export interface QmetryCycleProgressEntry { name: string; count: number }
export interface QmetryCycleSummary { id: string; key?: string; name: string; status?: string; folderId?: string; updated?: string; plannedStartDate?: string; plannedEndDate?: string; progress?: QmetryCycleProgressEntry[] }
export interface QmetryFolderSummary { id: string; name: string; parentId?: string; path?: string }
export interface QmetryCycleHealthSummary { key: string; name: string; total: number; pass: number; fail: number; blocked: number; ne: number; na: number; passPct: number; coverage: number; status: string }
export interface QmetryCycleSearchResult { cycles: QmetryCycleSummary[]; total: number; error?: string }
export interface QmetryFolderSearchResult { folders: QmetryFolderSummary[]; total: number; error?: string }

type QmetrySessionConfig = QmetryIntegrationConfig & { sessionHeader?: string; sessionId?: string; xsrfToken?: string };

const TEST_CYCLE_FIELDS = 'key,summary,priority,status,assignee,reporter,testcaseExecutionProgress,plannedStartDate,plannedEndDate,updated,automationRule';
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function authHeader(cfg: QmetryIntegrationConfig): string | null {
  const encoded = getEncodedAuth(cfg.authEncodedEnv);
  if (encoded) return encoded.startsWith('Basic ') ? encoded : `Basic ${encoded}`;
  const basic = getBasicAuth(cfg.auth);
  return basic ? `Basic ${basic}` : null;
}

function cleanSessionHeader(value: string): string {
  return value.replace(/^Cookie:\s*/i, '').trim();
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

async function qmetryFetch(cfg: QmetryIntegrationConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const auth = authHeader(cfg);
  if (!auth) return { ok: false, error: 'QMetry credentials not configured' };
  const url = `${cfg.baseUrl}${cfg.apiPrefix}${path}`;
  const headers: Record<string, string> = { Authorization: auth, Accept: 'application/json' };
  const sessionHeader = qmetrySessionHeader(cfg);
  if (sessionHeader) headers.Cookie = sessionHeader;
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return { ok: false, error: safeApiError('QMetry API', res.status, await res.text()) };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: `QMetry API request failed: ${describeFetchError(err)}` };
  }
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

function qmetryDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || /^\d{12,}$/.test(String(raw))) {
    const d = new Date(Number(raw));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return qmetryDate(o.updatedOn ?? o.executedOn ?? o.lastModified ?? o.value ?? o.date);
  }
  const s = sanitizeText(raw);
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

function executionInScope(row: ExecutionRow, scope?: ApiFetchScope): boolean {
  if (scope?.project && scope.project !== 'all' && row.project !== scope.project) return false;
  return dateInScope(row.executedAt || row.updatedAt, scope);
}

function compactWarnings(warnings: string[]): string {
  const max = 8;
  if (!warnings.length) return '';
  const visible = warnings.slice(0, max);
  const hidden = warnings.length - visible.length;
  return hidden > 0 ? `${visible.join('; ')}; ${hidden} more QMetry cycle request(s) failed` : visible.join('; ');
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

function normalizeTestCase(tc: Record<string, unknown>, cycleKey: string, cycleName: string): ExecutionRow | null {
  const caseKey = sanitizeText(tc.key);
  if (!caseKey) return null;
  const executedAt = qmetryDate(tc.executedOn) || qmetryDate(tc.lastModified);
  const resultText = unwrapName(tc.executionResult) || unwrapName(tc.status);
  const tester = unwrapName(tc.executedBy) || unwrapName(tc.executionAssignee);
  return { project: projectFromKey(caseKey), cycleKey, cycleName, caseKey, result: mapExecutionResult(resultText), tester: tester || null, executedAt, updatedAt: qmetryDate(tc.lastModified) || executedAt, source: 'qmetry' };
}

function testCaseSearchBody(cfg: QmetryIntegrationConfig): Record<string, unknown> {
  return cfg.testCasesSearchBody || projectBody(cfg);
}

async function fetchCycleExecutions(cfg: QmetryIntegrationConfig, cycleId: string, cycleNameHint?: string, scope?: ApiFetchScope): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleId;
  let cycleName = cycleNameHint || cycleId;
  let startAt = 0;
  let includeFields = true;
  const searchPath = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
  const body = testCaseSearchBody(cfg);
  for (let page = 0; page < cfg.maxPages; page++) {
    const buildQs = (withFields: boolean) => {
      const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(cfg.pageSize) });
      if (withFields && cfg.testCaseFields) qs.set('fields', cfg.testCaseFields);
      return qs;
    };
    let result = cfg.usePostSearch ? await qmetryFetch(cfg, 'POST', `${searchPath}?${buildQs(includeFields)}`, body) : await qmetryFetch(cfg, 'GET', `${searchPath}?${buildQs(includeFields)}`);
    if (!result.ok && includeFields && /field|fields|invalid|not supported/i.test(result.error || '')) {
      result = cfg.usePostSearch ? await qmetryFetch(cfg, 'POST', `${searchPath}?${buildQs(false)}`, body) : await qmetryFetch(cfg, 'GET', `${searchPath}?${buildQs(false)}`);
      if (result.ok) includeFields = false;
    }
    if (!result.ok) return { executions, cycleKey, cycleName, error: result.error };
    const items = extractItems(result.data);
    if (!items.length) break;
    for (const item of items) {
      if (item.cycleKey) cycleKey = sanitizeText(item.cycleKey);
      if (item.cycleSummary || item.cycleName) cycleName = sanitizeText(item.cycleSummary || item.cycleName);
      const row = normalizeTestCase(item, cycleKey, cycleName);
      if (row && executionInScope(row, scope)) executions.push(row);
    }
    const total = extractTotal(result.data, startAt + items.length);
    startAt += items.length;
    if (items.length < cfg.pageSize || startAt >= total) break;
  }
  return { executions, cycleKey, cycleName };
}

function summarizeCycle(cycleKey: string, cycleName: string, executions: ExecutionRow[]): QmetryCycleHealthSummary {
  const total = executions.length;
  const pass = executions.filter((e) => e.result === 'PASS').length;
  const fail = executions.filter((e) => e.result === 'FAIL').length;
  const blocked = executions.filter((e) => e.result === 'BLOCKED').length;
  const ne = executions.filter((e) => e.result === 'NE').length;
  const na = executions.filter((e) => e.result === 'NA').length;
  const executed = pass + fail + blocked + na;
  return { key: cycleKey, name: cycleName, total, pass, fail, blocked, ne, na, passPct: executed ? Math.round((pass / executed) * 100) : 0, coverage: total ? Math.round((executed / total) * 100) : 0, status: !total ? 'NOT STARTED' : fail || blocked ? 'AT RISK' : ne ? 'IN PROGRESS' : 'CLEAN' };
}

export async function fetchFolderCycleHealth(cfg: QmetryIntegrationConfig, folderId?: string, scope?: ApiFetchScope): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  const found = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (found.error) return { cycles: [], error: found.error };
  const cycles: QmetryCycleHealthSummary[] = [];
  const warnings: string[] = [];
  for (const cycle of found.cycles) {
    const result = await fetchCycleExecutions(cfg, cycle.id, cycle.name, scope);
    if (result.error) warnings.push(`${cycle.name}: ${result.error}`);
    cycles.push(summarizeCycle(result.cycleKey, result.cycleName || cycle.name, result.executions));
  }
  const error = compactWarnings(warnings);
  return error ? { cycles, error } : { cycles };
}

async function fetchProjectCycleIds(cfg: QmetryIntegrationConfig): Promise<{ ids: string[]; error?: string }> {
  const ids: string[] = [];
  let startAt = 0;
  for (let page = 0; page < cfg.maxPages; page++) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize });
    if (result.error) return { ids, error: result.error };
    ids.push(...result.cycles.map((c) => c.id));
    startAt += result.cycles.length;
    if (!result.cycles.length || startAt >= result.total) break;
  }
  return { ids };
}

export async function fetchQmetryExecutions(cfg: QmetryIntegrationConfig, scope?: ApiFetchScope): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };
  let cycleIds = [...cfg.cycleIds];
  if (!cycleIds.length && cfg.projectId) {
    const discovered = await fetchProjectCycleIds(cfg);
    if (discovered.error) return { executions: [], cycleMeta: new Map(), error: `QMetry test cycle search failed: ${discovered.error}` };
    cycleIds = discovered.ids;
  }
  if (!cycleIds.length) return { executions: [], cycleMeta: new Map(), error: 'No QMetry test cycles found for the configured Project ID / Folder ID.' };
  const all: ExecutionRow[] = [];
  const cycleMeta = new Map<string, string>();
  const warnings: string[] = [];
  for (const cycleId of cycleIds) {
    const result = await fetchCycleExecutions(cfg, cycleId, undefined, scope);
    if (result.error) warnings.push(`${cycleId}: ${result.error}`);
    all.push(...result.executions);
    cycleMeta.set(result.cycleKey, result.cycleName);
  }
  const error = compactWarnings(warnings);
  return error ? { executions: all, cycleMeta, error } : { executions: all, cycleMeta };
}

export async function fetchQmetryDataset(cfg: IntegrationsConfig, scope?: ApiFetchScope) {
  const ds = emptyDataset();
  const { executions, error } = await fetchQmetryExecutions(cfg.qmetry, scope);
  ds.executions = executions;
  ds.meta.integrations.qmetry = true;
  ds.meta.fetchedAt = new Date().toISOString();
  if (error) ds.meta.warnings.push(error);
  if (scope?.startDate || scope?.endDate) ds.meta.sourceFiles.push(`qmetry-api:overview-date-search:${scope.startDate || 'any'}:${scope.endDate || 'any'}`);
  if (executions.length) {
    ds.files.push({ name: 'qmetry-api', ext: 'API', project: cfg.qmetry.projectKey, rows: executions.length, status: 'parsed', detectedType: 'test-execution', source: 'qmetry-api' });
    ds.projects = [...new Set(executions.map((e) => e.project))];
    ds.meta.sourceFiles.push('qmetry-api:project');
  }
  return ds;
}
