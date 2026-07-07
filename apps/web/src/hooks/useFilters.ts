import { useState, useEffect, useMemo, useCallback } from 'react';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import { getActiveProject, setActiveProject, getActiveDateRange, setActiveDateRange } from '../lib/api';

function overlapsDataRange(startDate: string | undefined, endDate: string | undefined, dataMin?: string | null, dataMax?: string | null): boolean {
  if (!startDate || !endDate) return false;
  if (!dataMin || !dataMax) return true;
  return !(endDate < dataMin || startDate > dataMax);
}

function initialRange(dashboard: DashboardPayload | undefined): { startDate: string; endDate: string } {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const storedRange = getActiveDateRange();
  const dataMin = dashboard?.meta.dataMin;
  const dataMax = dashboard?.meta.dataMax;
  if (overlapsDataRange(storedRange.startDate, storedRange.endDate, dataMin, dataMax)) {
    return { startDate: storedRange.startDate!, endDate: storedRange.endDate! };
  }
  return { startDate: dashboard?.scope.startDate || dataMin || weekAgo, endDate: dashboard?.scope.endDate || dataMax || today };
}

export function useFilters(dashboard: DashboardPayload | undefined) {
  const storedProject = getActiveProject();
  const seededRange = initialRange(dashboard);

  const [startDate, setStartDate] = useState(seededRange.startDate);
  const [endDate, setEndDate] = useState(seededRange.endDate);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<'all' | 'PASS' | 'FAIL' | 'BLOCKED'>('all');
  const [project, setProjectState] = useState(storedProject || 'all');

  useEffect(() => {
    if (!dashboard) return;
    if (!overlapsDataRange(startDate, endDate, dashboard.meta.dataMin, dashboard.meta.dataMax)) {
      const next = initialRange(dashboard);
      setStartDate(next.startDate);
      setEndDate(next.endDate);
    }
  }, [dashboard?.meta.dataMin, dashboard?.meta.dataMax]);

  useEffect(() => {
    setActiveDateRange(startDate, endDate);
  }, [startDate, endDate]);

  const projects = useMemo(() => {
    const values = new Set<string>(['all']);
    for (const p of dashboard?.scope.projects || []) if (p) values.add(p);
    return [...values];
  }, [dashboard?.scope.projects]);

  useEffect(() => {
    if (project !== 'all' && dashboard?.scope.projects?.length && !dashboard.scope.projects.includes(project)) {
      setProjectState('all');
      setActiveProject('all');
    }
  }, [dashboard?.scope.projects, project]);

  const setProject = useCallback((next: string) => {
    const value = next || 'all';
    setProjectState(value);
    setActiveProject(value);
  }, []);

  const filterParams: FilterParams = useMemo(() => ({
    startDate,
    endDate,
    search: search || undefined,
    result,
    project: project === 'all' ? undefined : project,
  }), [startDate, endDate, search, result, project]);

  return {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    search,
    setSearch,
    result,
    setResult,
    project,
    setProject,
    projects,
    filterParams,
    generatedAt: dashboard?.meta.generatedAt,
  };
}
