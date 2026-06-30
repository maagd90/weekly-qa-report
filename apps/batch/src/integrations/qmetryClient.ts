import type { ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig } from '../config/loadIntegrations';
import { getBasicAuth } from '../config/loadIntegrations';
import { mapExecutionResult, projectFromKey, sanitizeText } from '../utils/excel';

function isoDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

async function fetchJson(url: string, auth: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
  return { ok: true, data: await res.json() };
}

function normalizeTestCase(
  tc: Record<string, unknown>,
  cycleKey: string,
  cycleName: string,
): ExecutionRow | null {
  const caseKey = sanitizeText(tc.key);
  if (!caseKey) return null;
  const executedAt = isoDate(tc.executedOn || tc.lastModified);
  const tester = sanitizeText(tc.executedBy || tc.executionAssignee) || null;
  return {
    project: projectFromKey(caseKey),
    cycleKey,
    cycleName,
    caseKey,
    result: mapExecutionResult(tc.executionResult || tc.status),
    tester,
    executedAt,
    updatedAt: isoDate(tc.lastModified) || executedAt,
    source: 'qmetry',
  };
}

export async function fetchQmetryExecutions(cfg: IntegrationsConfig['qmetry']): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };
  const auth = getBasicAuth(cfg.auth);
  if (!auth) return { executions: [], cycleMeta: new Map(), error: 'QMetry credentials not configured' };

  const cycleIds = [...cfg.cycleIds];
  const executions: ExecutionRow[] = [];
  const cycleMeta = new Map<string, string>();
  const errors: string[] = [];

  if (!cycleIds.length) {
    return { executions, cycleMeta, error: 'No cycleIds configured — add cycle IDs to config/integrations.json' };
  }

  for (const cycleId of cycleIds) {
    let cycleKey = cycleId;
    let cycleName = cycleId;
    let startAt = 0;
    let pages = 0;

    while (pages < cfg.maxPages) {
      const path = cfg.testCasesSearchPath.replace('{cycleId}', encodeURIComponent(cycleId));
      const qs = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(cfg.pageSize),
        fields: cfg.testCaseFields,
      });
      const url = `${cfg.baseUrl}${cfg.apiPrefix}${path}?${qs}`;
      const { ok, data, error } = await fetchJson(url, auth);
      if (!ok) {
        errors.push(`Cycle ${cycleId}: ${error}`);
        break;
      }

      const payload = data as { data?: Record<string, unknown>[]; values?: Record<string, unknown>[]; testCases?: Record<string, unknown>[] };
      const items = payload.data || payload.values || payload.testCases || (Array.isArray(data) ? data as Record<string, unknown>[] : []);
      if (!items.length) break;

      for (const tc of items) {
        const row = tc as Record<string, unknown>;
        if (row.cycleKey) cycleKey = sanitizeText(row.cycleKey);
        if (row.cycleSummary || row.cycleName) cycleName = sanitizeText(row.cycleSummary || row.cycleName);
        const exec = normalizeTestCase(row, cycleKey, cycleName);
        if (exec) executions.push(exec);
      }

      cycleMeta.set(cycleKey, cycleName);
      startAt += items.length;
      pages++;
      if (items.length < cfg.pageSize) break;
    }
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
