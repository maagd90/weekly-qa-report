import type { ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig, QmetryIntegrationConfig } from '../config/loadIntegrations';
import { getBasicAuth, getEncodedAuth } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError } from '../utils/fetchWithTimeout';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';
import { isoDateFromApi } from '../utils/jiraHelpers';

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
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return { ok: false, error: safeApiError('QMetry API', res.status, await res.text()) };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: `QMetry API timeout: ${(err as Error).message}` };
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
  const payload = data as { data?: Record<string, unknown>[]; values?: Record<string, unknown>[]; testCases?: Record<string, unknown>[]; total?: number };
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return payload.data || payload.values || payload.testCases || [];
}

async function fetchProjectCycleIds(cfg: QmetryIntegrationConfig): Promise<string[]> {
  return (await fetchProjectCycles(cfg)).map((c) => c.id);
}

export async function fetchProjectCycles(cfg: QmetryIntegrationConfig): Promise<{ id: string; name: string }[]> {
  if (!cfg.projectId || !cfg.testCyclesSearchPath) return [];
  const path = cfg.testCyclesSearchPath.replace('{projectId}', encodeURIComponent(cfg.projectId));
  const cycles: { id: string; name: string }[] = [];
  let startAt = 0;
  let pages = 0;

  while (pages < cfg.maxPages) {
    const qs = `?startAt=${startAt}&maxResults=${cfg.pageSize}`;
    const body = cfg.testCyclesSearchBody || { filter: { projectId: cfg.projectId } };
    const { ok, data, error } = await qmetryFetch(cfg, 'POST', `${path}${qs}`, body);
    if (!ok) {
      console.error('[QMetry] cycle search:', error);
      break;
    }
    const items = extractItems(data);
    for (const item of items) {
      const id = sanitizeText(item.id || item.cycleId);
      const name = sanitizeText(item.name || item.summary || item.folderName) || id;
      if (id) cycles.push({ id, name });
    }
    const total = (data as { total?: number })?.total ?? items.length;
    startAt += items.length;
    pages++;
    if (!items.length || startAt >= total) break;
  }
  return cycles;
}

async function fetchCycleExecutions(cfg: QmetryIntegrationConfig, cycleId: string): Promise<{ executions: ExecutionRow[]; cycleKey: string; cycleName: string; error?: string }> {
  const executions: ExecutionRow[] = [];
  let cycleKey = cycleId;
  let cycleName = cycleId;
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

    const total = (data as { total?: number })?.total ?? startAt + items.length;
    startAt += items.length;
    pages++;
    if (items.length < cfg.pageSize || startAt >= total) break;
  }

  return { executions, cycleKey, cycleName };
}

export async function fetchQmetryExecutions(cfg: QmetryIntegrationConfig): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };

  let cycleIds = [...cfg.cycleIds];
  if (!cycleIds.length && cfg.projectId) cycleIds = await fetchProjectCycleIds(cfg);
  if (!cycleIds.length) {
    return { executions: [], cycleMeta: new Map(), error: 'No cycleIds configured — set cycleIds or projectId + testCyclesSearchPath in integrations.json' };
  }

  const executions: ExecutionRow[] = [];
  const cycleMeta = new Map<string, string>();
  const errors: string[] = [];
  for (const cycleId of cycleIds) {
    const { executions: batch, cycleKey, cycleName, error } = await fetchCycleExecutions(cfg, cycleId);
    if (error) errors.push(`Cycle ${cycleId}: ${error}`);
    executions.push(...batch);
    cycleMeta.set(cycleKey, cycleName);
  }
  return { executions, cycleMeta, error: errors.length ? errors.join('; ') : undefined };
}

export async function fetchQmetryDataset(cfg: IntegrationsConfig) {
  const ds = emptyDataset();
  const { executions, error } = await fetchQmetryExecutions(cfg.qmetry);
  ds.executions = executions;
  ds.meta.integrations.qmetry = true;
  ds.meta.fetchedAt = new Date().toISOString();
  if (error) ds.meta.warnings.push(error);
  if (executions.length) {
    ds.files.push({
      name: 'qmetry-api',
      ext: 'API',
      project: executions[0]?.project || cfg.qmetry.projectKey,
      rows: executions.length,
      status: 'parsed',
      detectedType: 'zephyr',
      source: 'qmetry-api',
    });
    ds.projects = [...new Set(executions.map((e) => e.project))];
  }
  return ds;
}
