import { useState, useEffect, useMemo } from 'react';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';

export function useFilters(dashboard: DashboardPayload | undefined) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(dashboard?.scope.startDate || weekAgo);
  const [endDate, setEndDate] = useState(dashboard?.scope.endDate || today);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<'all' | 'PASS' | 'FAIL' | 'BLOCKED'>('all');
  const [project, setProject] = useState('all');

  useEffect(() => {
    if (dashboard?.scope.startDate) setStartDate(dashboard.scope.startDate);
    if (dashboard?.scope.endDate) setEndDate(dashboard.scope.endDate);
  }, [dashboard?.scope.startDate, dashboard?.scope.endDate]);

  const projects = useMemo(() => {
    if (dashboard?.scope.projects?.length) {
      return ['all', ...dashboard.scope.projects];
    }
    return ['all'];
  }, [dashboard?.scope.projects]);

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
