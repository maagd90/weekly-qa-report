import { useState, useCallback, useMemo, useEffect } from 'react';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { QaTab } from '../theme/qaTheme';
import { getActiveProject, setActiveProject } from '../lib/api';
import { canonicalProjectOrAll, canonicalProjectOrUndefined, uniqueCanonicalProjects } from '../lib/projectKey';
import { defaultReportingPeriod } from '../lib/reportingPeriod';

// Tabs that have an independent date/search/result filter.
const FILTERABLE: QaTab[] = ['overview', 'testers', 'cycles', 'trace', 'uat'];

type TabFilter = { startDate: string; endDate: string; search: string; result: 'all' | 'PASS' | 'FAIL' | 'BLOCKED' };

function seedRange(baseDashboard: DashboardPayload | undefined): { startDate: string; endDate: string } {
  const fallback = defaultReportingPeriod();
  // Default every dashboard tab to the agreed 2026 year-to-date reporting window.
  // Do not seed from meta.dataMin because an old issue/execution can push the UI back to 2020.
  // Users can still manually select an earlier date when historical analysis is required.
  return {
    startDate: baseDashboard?.scope.startDate || fallback.startDate,
    endDate: baseDashboard?.scope.endDate || fallback.endDate,
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
  const [customized, setCustomized] = useState<Partial<Record<QaTab, boolean>>>({});

  // Re-seed ranges once when a baseDashboard for a project first arrives.
  // Preserve date ranges for tabs the user has already customized manually.
  const dataKey = `${project}:${baseDashboard?.scope.project || 'all'}:${baseDashboard?.meta.generatedAt || ''}`;
  useEffect(() => {
    if (baseDashboard && seededFor !== dataKey) {
      const fresh = blankMap(baseDashboard);
      setTabFilters((prev) => {
        const next: Record<string, TabFilter> = { ...fresh };
        for (const tab of FILTERABLE) {
          if (customized[tab] && prev[tab]) next[tab] = prev[tab];
        }
        return next;
      });
      setSeededFor(dataKey);
    }
  }, [dataKey, seededFor, baseDashboard, customized]);

  const key = FILTERABLE.includes(activeTab) ? activeTab : 'overview';
  const current = tabFilters[key] || blankMap(baseDashboard)[key];

  const patch = useCallback((p: Partial<TabFilter>) => {
    setTabFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
  }, [key]);

  const patchDate = useCallback((p: Partial<Pick<TabFilter, 'startDate' | 'endDate'>>) => {
    setCustomized((prev) => ({ ...prev, [key]: true }));
    patch(p);
  }, [key, patch]);

  const projects = useMemo(() => ['all', ...uniqueCanonicalProjects(baseDashboard?.scope.projects || [])], [baseDashboard?.scope.projects]);

  const setProject = useCallback((next: string) => {
    const value = canonicalProjectOrAll(next);
    setProjectState(value);
    setActiveProject(value);
    // A project switch invalidates every tab's previous filter result. Reset all tabs to the
    // same 2026 YTD period so the controls and the newly loaded base dashboard cannot disagree.
    setTabFilters(blankMap(undefined));
    setCustomized({});
    setSeededFor(undefined);
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
    setStartDate: (v: string) => patchDate({ startDate: v }),
    setEndDate: (v: string) => patchDate({ endDate: v }),
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
