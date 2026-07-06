import type { ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig, QmetryIntegrationConfig } from '../config/loadIntegrations';
import { getBasicAuth, getEncodedAuth } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError, describeFetchError } from '../utils/fetchWithTimeout';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';
import { isoDateFromApi } from '../utils/jiraHelpers';

export interface QmetryCycleSummary { id: string; key?: string; name: string; status?: string; folderId?: string }
export interface QmetryFolderSummary { id: string; name: string; parentId?: string; path?: string }
export interface QmetryCycleHealthSummary { key: string; name: string; total: number; pass: number; fail: number; blocked: number; ne: number; na: number; passPct: number; coverage: number; status: string }
export interface QmetryCycleSearchResult { cycles: QmetryCycleSummary[]; total: number; error?: string }
export interface QmetryFolderSearchResult { folders: QmetryFolderSummary[]; total: number; error?: string }

function authHeader(cfg: QmetryIntegrationConfig): string | null {
  const encoded = getEncodedAuth(cfg.authEncodedEnv);
  if (encoded) return encoded.startsWith('Basic ') ? encoded : `Basic ${encoded}`;
  const basic = getBasicAuth(cfg.auth);
  return basic ? `Basic ${basic}` : null;
}

async function qmetryFetch(cfg: QmetryIntegrationConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const auth = authHeader(cfg);
  if (!auth) return { ok: false, error: 'QMetry credentials not configured' };
  const url = `${cfg.baseUrl}${cfg.apiPrefix}${path}`;
  const headers: Record<string, string> = { Authorization: auth, Accept: 'application/json' };
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
  const p = data as { data?: Record<string, unknown>[]; values?: Record<string, unknown>[]; items?: Record<string, unknown>[]; results?: Record<string, unknown>[]; testCycles?: Record<string, unknown>[]; testCases?: Record<string, unknown>[]; folders?: Record<string, unknown>[] };
  return p?.data || p?.values || p?.items || p?.results || p?.testCycles || p?.testCases || p?.folders || [];
}

function extractTotal(data: unknown, fallback: number): number {
  const p = data as { total?: unknown; totalCount?: unknown; count?: unknown; recordsTotal?: unknown };
  const parsed = Number(p?.total ?? p?.totalCount ?? p?.recordsTotal ?? p?.count);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCycle(item: Record<string, unknown>): QmetryCycleSummary | null {
  const id = sanitizeText(item.id || item.cycleId || item.testCycleId || item.entityId);
  const key = sanitizeText(item.key || item.cycleKey || item.testCycleKey);
  const name = sanitizeText(item.name || item.summary || item.cycleName || item.testCycleName) || key || id;
  const resolvedId = id || key;
  if (!resolvedId) return null;
  const cycle: QmetryCycleSummary = { id: resolvedId, name };
  const status = sanitizeText(item.status || item.executionStatus);
  const folderId = sanitizeText(item.folderId || item.folder || item.folderID);
  if (key) cycle.key = key;
  if (status) cycle.status = status;
  if (folderId) cycle.folderId = folderId;
  return cycle;
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

function filterBody(cfg: QmetryIntegrationConfig, folderId?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (cfg.projectId) filter.projectId = /^\d+$/.test(cfg.projectId) ? Number(cfg.projectId) : cfg.projectId;
  if (folderId && folderId !== 'all') filter.folderId = folderId;
  return { filter };
}

function cycleSearchPath(cfg: QmetryIntegrationConfig, startAt: number, maxResults: number): string {
  const basePath = (cfg.testCyclesSearchPath || '/testcycles/search').replace('{projectId}', encodeURIComponent(cfg.projectId || ''));
  return `${basePath}?${new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) })}`;
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
  const candidates: Array<{ method: 'GET' | 'POST'; path: string }> = [
    { method: 'POST', path: `/testcycles/folders/search?${qs}` },
    { method: 'POST', path: `/folders/search?${qs}` },
    { method: 'GET', path: `/testcycles/folders?${qs}` },
  ];
  let lastError = '';
  for (const c of candidates) {
    const result = await qmetryFetch(cfg, c.method, c.path, c.method === 'POST' ? filterBody(cfg) : undefined);
    if (!result.ok) { lastError = result.error || 'Folder search failed'; continue; }
    const items = extractItems(result.data);
    const folders = items.map(normalizeFolder).filter((f): f is QmetryFolderSummary => Boolean(f));
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
  const executedAt = isoDateFromApi(tc.executedOn || tc.lastModified);
  return { project: projectFromKey(caseKey), cycleKey, cycleName, caseKey, result: mapExecutionResult(tc.executionResult || tc.status), tester: sanitizeText(tc.executedBy || tc.executionAssignee) || null, executedAt, updatedAt: isoDateFromApi(tc.lastModified) || executedAt, source: 'qmetry' };
}

async function fetchCycleExecutions(cfg: QmetryIntegrationConfig, cycleId: string, cycleNameHint?: string): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleId;
  let cycleName = cycleNameHint || cycleId;
  let startAt = 0;
  const searchPath = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
  for (let page = 0; page < cfg.maxPages; page++) {
    const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(cfg.pageSize), fields: cfg.testCaseFields });
    const result = cfg.usePostSearch ? await qmetryFetch(cfg, 'POST', `${searchPath}?${qs}`, cfg.testCasesSearchBody || { filter: { filter: { folderId: -1 } } }) : await qmetryFetch(cfg, 'GET', `${searchPath}?${qs}`);
    if (!result.ok) return { executions, cycleKey, cycleName, error: result.error };
    const items = extractItems(result.data);
    if (!items.length) break;
    for (const item of items) {
      if (item.cycleKey) cycleKey = sanitizeText(item.cycleKey);
      if (item.cycleSummary || item.cycleName) cycleName = sanitizeText(item.cycleSummary || item.cycleName);
      const row = normalizeTestCase(item, cycleKey, cycleName);
      if (row) executions.push(row);
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

export async function fetchFolderCycleHealth(cfg: QmetryIntegrationConfig, folderId?: string): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  const found = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (found.error) return { cycles: [], error: found.error };
  const cycles: QmetryCycleHealthSummary[] = [];
  const warnings: string[] = [];
  for (const cycle of found.cycles) {
    const result = await fetchCycleExecutions(cfg, cycle.id, cycle.name);
    if (result.error) warnings.push(`${cycle.name}: ${result.error}`);
    cycles.push(summarizeCycle(result.cycleKey, result.cycleName || cycle.name, result.executions));
  }
  const error = warnings.join('; ');
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

export async function fetchQmetryExecutions(cfg: QmetryIntegrationConfig): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
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
    const result = await fetchCycleExecutions(cfg, cycleId);
    if (result.error) warnings.push(`${cycleId}: ${result.error}`);
    all.push(...result.executions);
    cycleMeta.set(result.cycleKey, result.cycleName);
  }
  const error = warnings.join('; ');
  return error ? { executions: all, cycleMeta, error } : { executions: all, cycleMeta };
}

export async function fetchQmetryDataset(cfg: IntegrationsConfig) {
  const ds = emptyDataset();
  const { executions, error } = await fetchQmetryExecutions(cfg.qmetry);
  ds.executions = executions;
  ds.meta.integrations.qmetry = true;
  ds.meta.fetchedAt = new Date().toISOString();
  if (error) ds.meta.warnings.push(error);
  if (executions.length) {
    ds.files.push({ name: 'qmetry-api', ext: 'API', project: cfg.qmetry.projectKey, rows: executions.length, status: 'parsed', detectedType: 'test-execution', source: 'qmetry-api' });
    ds.projects = [...new Set(executions.map((e) => e.project))];
    ds.meta.sourceFiles.push('qmetry-api:project');
  }
  return ds;
}
