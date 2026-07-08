import { useState, useCallback, useMemo, useEffect } from 'react';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { QaTab } from '../theme/qaTheme';
import { getActiveProject, setActiveProject } from '../lib/api';
import { canonicalProjectOrAll, canonicalProjectOrUndefined, uniqueCanonicalProjects } from '../lib/projectKey';

// Tabs that have an independent date/search/result filter.
const FILTERABLE: QaTab[] = ['overview', 'testers', 'cycles', 'trace', 'uat'];

type TabFilter = { startDate: string; endDate: string; search: string; result: 'all' | 'PASS' | 'FAIL' | 'BLOCKED' };

function seedRange(baseDashboard: DashboardPayload | undefined): { startDate: string; endDate: string } {
  const today = new Date().toISOString().slice(0, 10);
  // Default each tab to the FULL data range so nothing looks empty on first load.
  return {
    startDate: baseDashboard?.meta.dataMin || baseDashboard?.scope.startDate || today,
    endDate: baseDashboard?.meta.dataMax || baseDashboard?.scope.endDate || today,
  };
}

function blankMap(baseDashboard: DashboardPayload | undefined): Record<string, TabFilter> {
  const r = seedRange(baseDashboard);
  const map: Record<string, TabFilter> = {};
  for (const t of FILTERABLE) map[t] = { startDate: r.startDate, endDate: r.endDate, search: '', result: 'all' };
  return map;
}

/**
 * Per-tab filter state. Each filterable tab keeps its OWN startDate/endDate/search/result,
 * so changing the period on Overview does not affect Cycles, Testers, etc.
 * Project stays GLOBAL (one business scope across all tabs).
 */
export function usePerTabFilters(activeTab: QaTab, baseDashboard: DashboardPayload | undefined) {
  const [tabFilters, setTabFilters] = useState<Record<string, TabFilter>>(() => blankMap(baseDashboard));
  const [project, setProjectState] = useState(canonicalProjectOrAll(getActiveProject()) || 'all');
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);

  // Re-seed ranges once when a baseDashboard with a real data range first arrives.
  // MUST be an effect, not inline — setting state during render is unsafe.
  // Include project + scope so a project change re-seeds each tab's dates to the new full range
  // (otherwise the filter bar could still show April while the base data is the full range).
  const dataKey = `${project}:${baseDashboard?.meta.dataMin || ''}:${baseDashboard?.meta.dataMax || ''}`;
  useEffect(() => {
    if (baseDashboard && dataKey !== ':' && seededFor !== dataKey) {
      setTabFilters(blankMap(baseDashboard));
      setSeededFor(dataKey);
    }
  }, [dataKey, seededFor, baseDashboard]);

  const key = FILTERABLE.includes(activeTab) ? activeTab : 'overview';
  const current = tabFilters[key] || blankMap(baseDashboard)[key];

  const patch = useCallback((p: Partial<TabFilter>) => {
    setTabFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
  }, [key]);

  const projects = useMemo(() => ['all', ...uniqueCanonicalProjects(baseDashboard?.scope.projects || [])], [baseDashboard?.scope.projects]);

  const setProject = useCallback((next: string) => {
    const value = canonicalProjectOrAll(next);
    setProjectState(value);
    setActiveProject(value);
  }, []);

  const filterParams: FilterParams = useMemo(() => ({
    startDate: current.startDate,
    endDate: current.endDate,
    search: current.search || undefined,
    result: current.result,
    project: canonicalProjectOrUndefined(project),
  }), [current.startDate, current.endDate, current.search, current.result, project]);

  return {
    startDate: current.startDate,
    endDate: current.endDate,
    setStartDate: (v: string) => patch({ startDate: v }),
    setEndDate: (v: string) => patch({ endDate: v }),
    search: current.search,
    setSearch: (v: string) => patch({ search: v }),
    result: current.result,
    setResult: (v: TabFilter['result']) => patch({ result: v }),
    project,
    setProject,
    projects,
    filterParams,
    generatedAt: baseDashboard?.meta.generatedAt,
  };
}
