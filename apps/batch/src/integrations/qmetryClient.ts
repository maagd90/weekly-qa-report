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
}

export interface QmetryCycleSearchResult {
  cycles: QmetryCycleSummary[];
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
  const headers: Record<string, string> = {
    Authorization: auth,
    Accept: 'application/json',
  };
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

function normalizeTestCase(
  tc: Record<string, unknown>,
  cycleKey: string,
  cycleName: string,
): ExecutionRow | null {
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
  };
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return payload.data || payload.values || payload.items || payload.results || payload.testCycles || payload.testCases || [];
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
  const name = sanitizeText(item.name || item.summary || item.cycleName || item.testCycleName || item.folderName) || key || id;
  const status = sanitizeText(item.status || item.executionStatus);
  const resolvedId = id || key;
  if (!resolvedId) return null;
  const cycle: QmetryCycleSummary = { id: resolvedId, name };
  if (key) cycle.key = key;
  if (status) cycle.status = status;
  return cycle;
}

function cycleSearchBody(cfg: QmetryIntegrationConfig): Record<string, unknown> {
  if (cfg.testCyclesSearchBody) return cfg.testCyclesSearchBody;
  const filter: Record<string, unknown> = {};
  if (cfg.projectId) filter.projectId = /^\d+$/.test(cfg.projectId) ? Number(cfg.projectId) : cfg.projectId;
  return { filter };
}

function cycleSearchPath(cfg: QmetryIntegrationConfig, startAt: number, maxResults: number): string {
  const basePath = (cfg.testCyclesSearchPath || '/testcycles/search').replace('{projectId}', encodeURIComponent(cfg.projectId || ''));
  const qs = new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) });
  return `${basePath}?${qs}`;
}

export async function searchQmetryTestCycles(
  cfg: QmetryIntegrationConfig,
  options: { startAt?: number; maxResults?: number } = {},
): Promise<QmetryCycleSearchResult> {
  if (!cfg.enabled) return { cycles: [], total: 0 };
  if (!cfg.projectId && !cfg.testCyclesSearchBody) {
    return { cycles: [], total: 0, error: 'QMetry projectId is required for test cycle search' };
  }
  if (!cfg.testCyclesSearchPath) {
    return { cycles: [], total: 0, error: 'QMetry testCyclesSearchPath is required' };
  }

  const startAt = options.startAt ?? 0;
  const maxResults = options.maxResults ?? cfg.pageSize;
  const path = cycleSearchPath(cfg, startAt, maxResults);
  const body = cycleSearchBody(cfg);
  const { ok, data, error } = await qmetryFetch(cfg, 'POST', path, body);
  if (!ok) return { cycles: [], total: 0, error: error || 'QMetry test cycle search failed' };

  const items = extractItems(data);
  const cycles = items.map(normalizeCycle).filter((cycle): cycle is QmetryCycleSummary => Boolean(cycle));
  return { cycles, total: extractTotal(data, cycles.length) };
}

async function fetchProjectCycleIds(cfg: QmetryIntegrationConfig): Promise<{ ids: string[]; error?: string }> {
  const ids: string[] = [];
  let startAt = 0;
  let pages = 0;

  while (pages < cfg.maxPages) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize });
    if (result.error) return { ids, error: result.error };
    ids.push(...result.cycles.map((cycle) => cycle.id).filter((id): id is string => Boolean(id)));
    startAt += result.cycles.length;
    pages++;
    if (!result.cycles.length || startAt >= result.total) break;
  }

  if (pages >= cfg.maxPages) return { ids, error: 'QMetry test cycle search pagination limit reached' };
  return { ids };
}

export async function fetchProjectCycles(cfg: QmetryIntegrationConfig): Promise<{ id: string; name: string }[]> {
  const cycles: { id: string; name: string }[] = [];
  let startAt = 0;
  let pages = 0;

  while (pages < cfg.maxPages) {
    const result = await searchQmetryTestCycles(cfg, { startAt, maxResults: cfg.pageSize });
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

async function fetchCycleExecutions(
  cfg: QmetryIntegrationConfig,
  cycleId: string,
): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleId;
  let cycleName = cycleId;
  let startAt = 0;
  let pages = 0;

  const searchPath = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
  const filterBody = cfg.testCasesSearchBody || { filter: { filter: { folderId: -1 } } };

  while (pages < cfg.maxPages) {
    const qs = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(cfg.pageSize),
      fields: cfg.testCaseFields,
    });
    const path = `${searchPath}?${qs}`;

    const { ok, data, error } = cfg.usePostSearch
      ? await qmetryFetch(cfg, 'POST', path, filterBody)
      : await qmetryFetch(cfg, 'GET', path);

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

export async function fetchQmetryExecutions(cfg: QmetryIntegrationConfig): Promise<{
  executions: ExecutionRow[];
  cycleMeta: Map<string, string>;
  error?: string;
}> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };

  let cycleIds = [...cfg.cycleIds];
  if (!cycleIds.length && cfg.projectId) {
    const discovered = await fetchProjectCycleIds(cfg);
    if (discovered.error) return { executions: [], cycleMeta: new Map(), error: `QMetry test cycle search failed: ${discovered.error}` };
    cycleIds = discovered.ids;
  }
  if (!cycleIds.length) {
    return {
      executions: [],
      cycleMeta: new Map(),
      error: 'No QMetry test cycles found. Set projectId and optional folderId, or provide cycleIds manually.',
    };
  }

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
    ds.meta.sourceFiles.push(`qmetry-api:${cfg.qmetry.cycleIds.join(',') || 'project'}`);
  }
  return ds;
}
