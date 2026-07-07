import { useState, useEffect, useMemo, useCallback } from 'react';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import { getActiveProject, setActiveProject, getActiveDateRange, setActiveDateRange } from '../lib/api';

export function useFilters(dashboard: DashboardPayload | undefined) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const storedProject = getActiveProject();
  const storedRange = getActiveDateRange();

  const [startDate, setStartDate] = useState(dashboard?.scope.startDate || storedRange.startDate || weekAgo);
  const [endDate, setEndDate] = useState(dashboard?.scope.endDate || storedRange.endDate || today);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<'all' | 'PASS' | 'FAIL' | 'BLOCKED'>('all');
  const [project, setProjectState] = useState(storedProject || 'all');

  useEffect(() => {
    if (dashboard?.scope.startDate) setStartDate(dashboard.scope.startDate);
    if (dashboard?.scope.endDate) setEndDate(dashboard.scope.endDate);
  }, [dashboard?.scope.startDate, dashboard?.scope.endDate]);

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
