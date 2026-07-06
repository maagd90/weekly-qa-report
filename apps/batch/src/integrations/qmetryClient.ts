import type { ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig, QmetryIntegrationConfig } from '../config/loadIntegrations';
import { getBasicAuth, getEncodedAuth } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError, describeFetchError } from '../utils/fetchWithTimeout';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';
import { isoDateFromApi } from '../utils/jiraHelpers';

export interface QmetryCycleSummary {
  id: string;
  key?: string;
  name: string;
  status?: string;
  folderId?: string;
}

export interface QmetryFolderSummary {
  id: string;
  name: string;
  parentId?: string;
  path?: string;
}

export interface QmetryCycleHealthSummary {
  key: string;
  name: string;
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  ne: number;
  na: number;
  passPct: number;
  coverage: number;
  status: string;
}

export interface QmetryCycleSearchResult {
  cycles: QmetryCycleSummary[];
  total: number;
  error?: string;
}

export interface QmetryFolderSearchResult {
  folders: QmetryFolderSummary[];
  total: number;
  error?: string;
}

function authHeader(cfg: QmetryIntegrationConfig): string | null {
  const encoded = getEncodedAuth(cfg.authEncodedEnv);
  if (encoded) return encoded.startsWith('Basic ') ? encoded : `Basic ${encoded}`;
  const basic = getBasicAuth(cfg.auth);
  return basic ? `Basic ${basic}` : null;
}

async function qmetryFetch(
  cfg: QmetryIntegrationConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const auth = authHeader(cfg);
  if (!auth) return { ok: false, error: 'QMetry credentials not configured' };

  const url = `${cfg.baseUrl}${cfg.apiPrefix}${path}`;
  const headers: Record<string, string> = { Authorization: auth, Accept: 'application/json' };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: safeApiError('QMetry API', res.status, text) };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: `QMetry API request failed: ${describeFetchError(err)}` };
  }
}

function normalizeTestCase(tc: Record<string, unknown>, cycleKey: string, cycleName: string): ExecutionRow | null {
  const caseKey = sanitizeText(tc.key);
  if (!caseKey) return null;
  const executedAt = isoDateFromApi(tc.executedOn || tc.lastModified);
  const tester = sanitizeText(tc.executedBy || tc.executionAssignee) || null;
  return {
    project: projectFromKey(caseKey),
    cycleKey,
    cycleName,
    caseKey,
    result: mapExecutionResult(tc.executionResult || tc.status),
    tester,
    executedAt,
    updatedAt: isoDateFromApi(tc.lastModified) || executedAt,
    source: 'qmetry',
  };
}

function extractItems(data: unknown): Record<string, unknown>[] {
  const payload = data as {
    data?: Record<string, unknown>[];
    values?: Record<string, unknown>[];
    items?: Record<string, unknown>[];
    results?: Record<string, unknown>[];
    testCycles?: Record<string, unknown>[];
    testCases?: Record<string, unknown>[];
    folders?: Record<string, unknown>[];
  };
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return payload.data || payload.values || payload.items || payload.results || payload.testCycles || payload.testCases || payload.folders || [];
}

function extractTotal(data: unknown, fallback: number): number {
  const payload = data as { total?: unknown; totalCount?: unknown; count?: unknown; recordsTotal?: unknown };
  const value = payload.total ?? payload.totalCount ?? payload.recordsTotal ?? payload.count;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCycle(item: Record<string, unknown>): QmetryCycleSummary | null {
  const id = sanitizeText(item.id || item.cycleId || item.testCycleId || item.entityId);
  const key = sanitizeText(item.key || item.cycleKey || item.testCycleKey);
  const name = sanitizeText(item.name || item.summary || item.cycleName || item.testCycleName) || key || id;
  const status = sanitizeText(item.status || item.executionStatus);
  const folderId = sanitizeText(item.folderId || item.folder || item.folderID);
  const resolvedId = id || key;
  if (!resolvedId) return null;
  const cycle: QmetryCycleSummary = { id: resolvedId, name };
  if (key) cycle.key = key;
  if (status) cycle.status = status;
  if (folderId) cycle.folderId = folderId;
  return cycle;
}

function normalizeFolder(item: Record<string, unknown>): QmetryFolderSummary | null {
  const id = sanitizeText(item.id || item.folderId || item.folderID || item.entityId || item.key);
  const name = sanitizeText(item.name || item.folderName || item.summary || item.label) || id;
  const parentId = sanitizeText(item.parentId || item.parentFolderId || item.parentID);
  const path = sanitizeText(item.path || item.folderPath || item.fullPath);
  if (!id) return null;
  const folder: QmetryFolderSummary = { id, name };
  if (parentId) folder.parentId = parentId;
  if (path) folder.path = path;
  return folder;
}

function qmetryFilter(projectId: string | null, folderId?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (projectId) filter.projectId = /^\d+$/.test(projectId) ? Number(projectId) : projectId;
  const cleanFolderId = (folderId || '').trim();
  if (cleanFolderId && cleanFolderId !== 'all') filter.folderId = cleanFolderId;
  return filter;
}

function cycleSearchBody(cfg: QmetryIntegrationConfig, folderId?: string): Record<string, unknown> {
  if (!folderId && cfg.testCyclesSearchBody) return cfg.testCyclesSearchBody;
  return { filter: qmetryFilter(cfg.projectId, folderId) };
}

function folderSearchBody(cfg: QmetryIntegrationConfig): Record<string, unknown> {
  return { filter: qmetryFilter(cfg.projectId) };
}

function cycleSearchPath(cfg: QmetryIntegrationConfig, startAt: number, maxResults: number): string {
  const basePath = (cfg.testCyclesSearchPath || '/testcycles/search').replace('{projectId}', encodeURIComponent(cfg.projectId || ''));
  const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) });
  return `${basePath}?${qs}`;
}

function folderPathCandidates(startAt: number, maxResults: number): Array<{ method: 'GET' | 'POST'; path: string }> {
  const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) });
  return [
    { method: 'POST', path: `/testcycles/folders/search?${qs}` },
    { method: 'POST', path: `/folders/search?${qs}` },
    { method: 'GET', path: `/testcycles/folders?${qs}` },
  ];
}

export async function searchQmetryTestCycles(cfg: QmetryIntegrationConfig, options: { startAt?: number; maxResults?: number; folderId?: string } = {}): Promise<QmetryCycleSearchResult> {
  if (!cfg.enabled) return { cycles: [], total: 0 };
  if (!cfg.projectId && !cfg.testCyclesSearchBody) return { cycles: [], total: 0, error: 'QMetry projectId is required for test cycle search' };
  if (!cfg.testCyclesSearchPath) return { cycles: [], total: 0, error: 'QMetry testCyclesSearchPath is required' };

  const startAt = options.startAt ?? 0;
  const maxResults = options.maxResults ?? cfg.pageSize;
  const path = cycleSearchPath(cfg, startAt, maxResults);
  const body = cycleSearchBody(cfg, options.folderId);
  const { ok, data, error } = await qmetryFetch(cfg, 'POST', path, body);
  if (!ok) return { cycles: [], total: 0, error: error || 'QMetry test cycle search failed' };

  const items = extractItems(data);
  const cycles = items.map(normalizeCycle).filter((cycle): cycle is QmetryCycleSummary => Boolean(cycle));
  return { cycles, total: extractTotal(data, cycles.length) };
}

export async function searchQmetryFolders(cfg: QmetryIntegrationConfig, options: { startAt?: number; maxResults?: number } = {}): Promise<QmetryFolderSearchResult> {
  if (!cfg.enabled) return { folders: [], total: 0 };
  if (!cfg.projectId) return { folders: [], total: 0, error: 'QMetry projectId is required for folder search' };

  const startAt = options.startAt ?? 0;
  const maxResults = options.maxResults ?? cfg.pageSize;
  const body = folderSearchBody(cfg);
  let lastError = '';

  for (const candidate of folderPathCandidates(startAt, maxResults)) {
    const result = await qmetryFetch(cfg, candidate.method, candidate.path, candidate.method === 'POST' ? body : undefined);
    if (!result.ok) {
      lastError = result.error || 'Folder search failed';
      continue;
    }
    const items = extractItems(result.data);
    const folders = items.map(normalizeFolder).filter((folder): folder is QmetryFolderSummary => Boolean(folder));
    return { folders, total: extractTotal(result.data, folders.length) };
  }

  return { folders: [], total: 0, error: lastError || 'QMetry folder search failed' };
}

async function fetchProjectCycleIds(cfg: QmetryIntegrationConfig, folderId?: string): Promise<{ ids: string[]; error?: string }> {
  const ids: string[] = [];
  let startAt = 0;
  let pages = 0;
  while (pages < cfg.maxPages) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize, folderId });
    if (result.error) return { ids, error: result.error };
    ids.push(...result.cycles.map((cycle) => cycle.id).filter((id): id is string => Boolean(id)));
    startAt += result.cycles.length;
    pages++;
    if (!result.cycles.length || startAt >= result.total) break;
  }
  if (pages >= cfg.maxPages) return { ids, error: 'QMetry test cycle search pagination limit reached' };
  return { ids };
}

export async function fetchProjectFolders(cfg: QmetryIntegrationConfig): Promise<QmetryFolderSummary[]> {
  const folders: QmetryFolderSummary[] = [{ id: 'all', name: 'All folders' }];
  let startAt = 0;
  let pages = 0;
  while (pages < cfg.maxPages) {
    const result = await searchQmetryFolders(cfg, { startAt, maxResults: cfg.pageSize });
    if (result.error) {
      console.error('[QMetry] folder search:', result.error);
      break;
    }
    folders.push(...result.folders);
    startAt += result.folders.length;
    pages++;
    if (!result.folders.length || startAt >= result.total) break;
  }
  return folders;
}

export async function fetchProjectCycles(cfg: QmetryIntegrationConfig, folderId?: string): Promise<{ id: string; name: string }[]> {
  const cycles: { id: string; name: string }[] = [];
  let startAt = 0;
  let pages = 0;
  while (pages < cfg.maxPages) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize, folderId });
    if (result.error) {
      console.error('[QMetry] cycle search:', result.error);
      break;
    }
    cycles.push(...result.cycles.map((cycle) => ({ id: cycle.id, name: cycle.name })));
    startAt += result.cycles.length;
    pages++;
    if (!result.cycles.length || startAt >= result.total) break;
  }
  return cycles;
}

async function fetchCycleExecutions(cfg: QmetryIntegrationConfig, cycleId: string, cycleNameHint?: string): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleId;
  let cycleName = cycleNameHint || cycleId;
  let startAt = 0;
  let pages = 0;
  const searchPath = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
  const filterBody = cfg.testCasesSearchBody || { filter: { filter: { folderId: -1 } } };

  while (pages < cfg.maxPages) {
    const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(cfg.pageSize), fields: cfg.testCaseFields });
    const path = `${searchPath}?${qs}`;
    const { ok, data, error } = cfg.usePostSearch ? await qmetryFetch(cfg, 'POST', path, filterBody) : await qmetryFetch(cfg, 'GET', path);
    if (!ok) return { executions, cycleKey, cycleName, error };
    const items = extractItems(data);
    if (!items.length) break;
    for (const tc of items) {
      const row = tc as Record<string, unknown>;
      if (row.cycleKey) cycleKey = sanitizeText(row.cycleKey);
      if (row.cycleSummary || row.cycleName) cycleName = sanitizeText(row.cycleSummary || row.cycleName);
      const exec = normalizeTestCase(row, cycleKey, cycleName);
      if (exec) executions.push(exec);
    }
    const total = extractTotal(data, startAt + items.length);
    startAt += items.length;
    pages++;
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
  const passPct = executed ? Math.round((pass / executed) * 100) : 0;
  const coverage = total ? Math.round((executed / total) * 100) : 0;
  const status = !total ? 'NOT STARTED' : fail || blocked ? 'AT RISK' : ne ? 'IN PROGRESS' : 'CLEAN';
  return { key: cycleKey, name: cycleName, total, pass, fail, blocked, ne, na, passPct, coverage, status };
}

export async function fetchFolderCycleHealth(cfg: QmetryIntegrationConfig, folderId?: string): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  const result = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (result.error) return { cycles: [], error: result.error };
  const cycles: QmetryCycleHealthSummary[] = [];
  const warnings: string[] = [];
  for (const cycle of result.cycles) {
    const exec = await fetchCycleExecutions(cfg, cycle.id, cycle.name);
    if (exec.error) warnings.push(`${cycle.name}: ${exec.error}`);
    cycles.push(summarizeCycle(exec.cycleKey, exec.cycleName || cycle.name, exec.executions));
  }
  return { cycles, error: warnings.join('; ') || undefined };
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
  return { executions: all, cycleMeta, error: warnings.join('; ') || undefined };
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
