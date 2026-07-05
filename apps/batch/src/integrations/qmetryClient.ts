import type { IntegrationsConfig, QmetryConfig } from '../config/loadIntegrations';
import { emptyDataset } from '../types/dataset';
import type { ExecutionRow } from '../types/dataset';

interface QmetryExecutionResponse {
  data?: unknown[];
  values?: unknown[];
  content?: unknown[];
  executions?: unknown[];
  testCases?: unknown[];
}

interface CycleOption {
  id: string;
  name: string;
}

function authHeader(cfg: QmetryConfig): string {
  if (cfg.auth === 'bearer') return `Bearer ${cfg.apiToken}`;
  return `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

function pickString(obj: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      const nested = asRecord(value);
      const nestedValue = nested.name ?? nested.key ?? nested.value ?? nested.displayName;
      if (nestedValue !== null && nestedValue !== undefined) return String(nestedValue).trim();
    } else {
      return String(value).trim();
    }
  }
  return fallback;
}

function normalizeResult(raw: string): ExecutionRow['result'] {
  const v = raw.toUpperCase();
  if (v.includes('PASS')) return 'PASS';
  if (v.includes('FAIL')) return 'FAIL';
  if (v.includes('BLOCK')) return 'BLOCKED';
  if (v.includes('NOT APPLICABLE') || v === 'NA' || v === 'N/A') return 'NA';
  return 'NE';
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function qmetryFetch(cfg: QmetryConfig, url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(cfg),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = text; }
  if (!response.ok) throw new Error(`QMetry ${response.status}: ${typeof json === 'string' ? json : JSON.stringify(json).slice(0, 500)}`);
  return json;
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const p = asRecord(payload) as QmetryExecutionResponse;
  return p.data || p.values || p.content || p.executions || p.testCases || [];
}

function mapExecution(item: unknown, cfg: QmetryConfig, cycleId: string, cycleName: string): ExecutionRow {
  const row = asRecord(item);
  const testCase = asRecord(row.testCase ?? row.testcase ?? row.issue ?? row.testcaseDetails);
  const status = asRecord(row.status ?? row.executionStatus ?? row.result);
  const executedBy = asRecord(row.executedBy ?? row.assignee ?? row.user);
  const executedOn = pickString(row, ['executedOn', 'executionDate', 'executedAt', 'updatedAt', 'lastModified']);
  const caseKey = pickString(testCase, ['key', 'issueKey', 'testCaseKey', 'id'], pickString(row, ['testCaseKey', 'issueKey', 'key']));

  return {
    project: cfg.projectKey || (caseKey.includes('-') ? caseKey.split('-')[0] : 'UNKNOWN'),
    cycleKey: cycleId,
    cycleName,
    caseKey,
    result: normalizeResult(pickString(status, ['name', 'value', 'status'], pickString(row, ['executionStatus', 'status', 'result']))),
    tester: pickString(executedBy, ['displayName', 'name', 'emailAddress'], pickString(row, ['executedBy'])) || null,
    executedAt: normalizeDate(executedOn),
    updatedAt: normalizeDate(pickString(row, ['updatedAt', 'lastModified'], executedOn)),
    source: 'qmetry',
  };
}

export async function fetchProjectCycles(cfg: QmetryConfig): Promise<CycleOption[]> {
  if (!cfg.enabled) return [];
  const base = cfg.baseUrl.replace(/\/$/, '');
  const url = `${base}${cfg.testCyclesSearchPath}?projectId=${encodeURIComponent(cfg.projectId || cfg.projectKey)}`;
  const json = await qmetryFetch(cfg, url);
  return extractArray(json).map((item) => {
    const row = asRecord(item);
    return {
      id: pickString(row, ['id', 'cycleId', 'key']),
      name: pickString(row, ['name', 'summary', 'cycleName'], pickString(row, ['id', 'cycleId', 'key'])),
    };
  }).filter((c) => c.id);
}

async function fetchCycleExecutions(cfg: QmetryConfig, cycleId: string) {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const path = cfg.executionsPath.replace('{cycleId}', encodeURIComponent(cycleId));
  const url = `${base}${path}`;
  const json = await qmetryFetch(cfg, url);
  const rows = extractArray(json);
  const cycleName = pickString(asRecord(json), ['name', 'summary', 'cycleName'], cycleId);
  return {
    executions: rows.map((r) => mapExecution(r, cfg, cycleId, cycleName)),
    cycleKey: cycleId,
    cycleName,
  };
}

export async function fetchQmetryExecutions(cfg: QmetryConfig): Promise<{ executions: ExecutionRow[]; cycleMeta: Map<string, string>; error?: string }> {
  if (!cfg.enabled) return { executions: [], cycleMeta: new Map() };
  let cycleIds = cfg.cycleIds || [];
  if (!cycleIds.length && cfg.projectId && cfg.testCyclesSearchPath) {
    try {
      cycleIds = (await fetchProjectCycles(cfg)).map((c) => c.id);
    } catch (err) {
      return { executions: [], cycleMeta: new Map(), error: (err as Error).message };
    }
  }
  if (!cycleIds.length) {
    return { executions: [], cycleMeta: new Map(), error: 'No cycleIds configured — set cycleIds or projectId + testCyclesSearchPath in integrations.json' };
  }

  const executions: ExecutionRow[] = [];
  const cycleMeta = new Map<string, string>();
  const errors: string[] = [];
  for (const cycleId of cycleIds) {
    try {
      const { executions: batch, cycleKey, cycleName } = await fetchCycleExecutions(cfg, cycleId);
      executions.push(...batch);
      cycleMeta.set(cycleKey, cycleName);
    } catch (err) {
      errors.push(`Cycle ${cycleId}: ${(err as Error).message}`);
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
      detectedType: 'test-execution',
      source: 'qmetry-api',
    });
    ds.projects = [...new Set(executions.map((e) => e.project))];
  }
  return ds;
}
