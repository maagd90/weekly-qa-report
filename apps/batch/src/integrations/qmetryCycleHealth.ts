import type { ApiFetchScope, ExecutionResult } from '../types/dataset';
import type { QmetryIntegrationConfig } from '../config/loadIntegrations';
import { mapExecutionResult } from '../utils/excel';
import {
  fetchFolderCycleHealth as fetchFolderCycleHealthBase,
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

function summarizeCycleProgress(cycle: QmetryCycleSummary): QmetryCycleHealthSummary {
  const counts: Record<ExecutionResult, number> = { PASS: 0, FAIL: 0, BLOCKED: 0, NE: 0, NA: 0 };
  for (const entry of cycle.progress || []) {
    const count = Math.max(0, Math.floor(Number(entry.count) || 0));
    counts[mapExecutionResult(entry.name)] += count;
  }
  const { PASS: pass, FAIL: fail, BLOCKED: blocked, NE: ne, NA: na } = counts;
  const total = pass + fail + blocked + ne + na;
  const executed = pass + fail + blocked + na;
  return {
    key: cycle.key || cycle.id,
    name: cycle.name || cycle.key || cycle.id,
    total,
    pass,
    fail,
    blocked,
    ne,
    na,
    passPct: executed ? Math.round((pass / executed) * 100) : 0,
    coverage: total ? Math.round((executed / total) * 100) : 0,
    status: !executed ? 'Not Started' : fail || blocked ? 'At Risk' : ne ? 'In Progress' : 'Healthy',
  };
}

/**
 * The folder drill-down is a live cycle-health view, separate from the
 * date-scoped report metrics. The cycle search response already contains
 * QMetry's authoritative current result split for each cycle. Keep that split
 * cycle-specific; the project-wide execution-summary gadget must never be
 * applied to an individual cycle card or drawer.
 *
 * The selected period determines which cycles are shown (using their planned
 * or updated dates). Once selected, each cycle displays its current QMetry
 * progress snapshot. This intentionally does not feed the report dataset,
 * where undated aggregate progress remains excluded from period totals.
 */
export async function fetchFolderCycleHealth(
  cfg: QmetryIntegrationConfig,
  folderId?: string,
  scope?: ApiFetchScope,
): Promise<{ cycles: QmetryCycleHealthSummary[]; error?: string }> {
  if (!hasDateScope(scope)) return fetchFolderCycleHealthBase(cfg, folderId, scope);

  const found = await searchQmetryTestCycles(cfg, { startAt: 0, maxResults: cfg.pageSize, folderId });
  if (found.error) return { cycles: [], error: found.error };

  const cycles = found.cycles
    .filter((candidate) => cycleInScope(candidate, scope))
    .map(summarizeCycleProgress);
  return { cycles };
}
