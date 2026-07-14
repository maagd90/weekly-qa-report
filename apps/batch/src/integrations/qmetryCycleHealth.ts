import type { ApiFetchScope, ExecutionRow } from '../types/dataset';
import type { QmetryIntegrationConfig } from '../config/loadIntegrations';
import {
  fetchFolderCycleHealth as fetchFolderCycleHealthBase,
  fetchQmetryExecutions,
  searchQmetryTestCycles,
  type QmetryCycleHealthSummary,
  type QmetryCycleSummary,
} from './qmetryClient';

function hasDateScope(scope?: ApiFetchScope): boolean {
  return Boolean(scope?.startDate || scope?.endDate);
}

function dateInScope(value: string | null | undefined, scope?: ApiFetchScope): boolean {
  if (!hasDateScope(scope)) return true;
  const date = (value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (scope?.startDate && date < scope.startDate) return false;
  if (scope?.endDate && date > scope.endDate) return false;
  return true;
}

function dateRangeOverlapsScope(startDate: string | null | undefined, endDate: string | null | undefined, scope?: ApiFetchScope): boolean {
  if (!hasDateScope(scope)) return true;
  const start = (startDate || endDate || '').slice(0, 10);
  const end = (endDate || startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  if (scope?.startDate && end < scope.startDate) return false;
  if (scope?.endDate && start > scope.endDate) return false;
  return true;
}

function cycleInScope(cycle: QmetryCycleSummary, scope?: ApiFetchScope): boolean {
  if (!hasDateScope(scope)) return true;
  if (cycle.plannedStartDate || cycle.plannedEndDate) {
    return dateRangeOverlapsScope(cycle.plannedStartDate, cycle.plannedEndDate, scope);
  }
  if (cycle.updated) return dateInScope(cycle.updated, scope);
  return true;
}

function isAggregateProgressRow(row: ExecutionRow): boolean {
  return row.source === 'qmetry'
    && row.executedAt === null
    && /-PROGRESS-(PASS|FAIL|BLOCKED|NE|NA)-\d+$/i.test(row.caseKey);
}

function summarizeCycle(cycleKey: string, cycleName: string, executions: ExecutionRow[]): QmetryCycleHealthSummary {
  const total = executions.length;
  const pass = executions.filter((row) => row.result === 'PASS').length;
  const fail = executions.filter((row) => row.result === 'FAIL').length;
  const blocked = executions.filter((row) => row.result === 'BLOCKED').length;
  const ne = executions.filter((row) => row.result === 'NE').length;
  const na = executions.filter((row) => row.result === 'NA').length;
  const executed = pass + fail + blocked + na;
  return {
    key: cycleKey,
    name: cycleName,
    total,
    pass,
    fail,
    blocked,
    ne,
    na,
    passPct: executed ? Math.round((pass / executed) * 100) : 0,
    coverage: total ? Math.round((executed / total) * 100) : 0,
    status: !total ? 'NOT STARTED' : fail || blocked ? 'AT RISK' : ne ? 'IN PROGRESS' : 'CLEAN',
  };
}

function isGenericNoDetailWarning(error?: string): boolean {
  return /QMetry cycles were found, but no testcase execution rows or cycle-level progress counts were available/i.test(error || '');
}

function compactWarnings(detailErrors: string[], excludedCycleNames: string[]): string {
  const parts: string[] = [];
  if (detailErrors.length) {
    const first = detailErrors[0].replace(/\s+/g, ' ').slice(0, 220);
    parts.push(`QMetry detail retrieval failed for ${detailErrors.length} cycle(s).${first ? ` First error: ${first}` : ''}`);
  }
  if (excludedCycleNames.length) {
    const unique = [...new Set(excludedCycleNames)];
    const named = unique.slice(0, 3).join(', ') + (unique.length > 3 ? `, +${unique.length - 3} more` : '');
    parts.push(`Detailed execution dates were unavailable for: ${named}. Excluded from this period's totals rather than shown as an approximate all-time count.`);
  }
  return parts.join(' ');
}

/**
 * The folder drill-down is a separate path from the dashboard dataset. For a
 * selected date range, fetch only testcase-level rows with usable execution
 * dates and never substitute the cycle's all-time aggregate progress totals.
 */
export async function fetchFolderCycleHealth(
  cfg: QmetryIntegrationConfig,
  folderId?: string,
  scope?: ApiFetchScope,
): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  if (!hasDateScope(scope)) return fetchFolderCycleHealthBase(cfg, folderId, scope);

  const found = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (found.error) return { cycles: [], error: found.error };

  const cycles: QmetryCycleHealthSummary[] = [];
  const detailErrors: string[] = [];
  const excludedCycleNames: string[] = [];

  for (const cycle of found.cycles.filter((candidate) => cycleInScope(candidate, scope))) {
    const result = await fetchQmetryExecutions({ ...cfg, cycleIds: [cycle.id] }, scope);
    const detailedRows = result.executions.filter((row) => !isAggregateProgressRow(row));

    if (result.error && !isGenericNoDetailWarning(result.error)) {
      detailErrors.push(`${cycle.name}: ${result.error}`);
    }
    if (!detailedRows.length) excludedCycleNames.push(cycle.name || cycle.key || cycle.id);

    cycles.push(summarizeCycle(cycle.key || cycle.id, cycle.name || cycle.key || cycle.id, detailedRows));
  }

  const error = compactWarnings(detailErrors, excludedCycleNames);
  return error ? { cycles, error } : { cycles };
}
