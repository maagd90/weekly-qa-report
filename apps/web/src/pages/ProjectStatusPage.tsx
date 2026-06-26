import React, { useMemo } from 'react';
import { FolderOpen, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import type { FilterParams } from '../lib/api';
import type { DashboardPayload } from '../lib/dashboardCompute';
import {
  computeProjectSummary,
  computeStatusDistribution,
  computeCompletionByProject,
  computeBugsByProject,
  computeCompletionTrends,
} from '../lib/dashboardCompute';
import { KpiCard } from '../components/common/KpiCard';
import { StatusDonutChart } from '../components/charts/StatusDonutChart';
import { CompletionByProjectChart } from '../components/charts/CompletionByProjectChart';
import { BugsByProjectChart } from '../components/charts/BugsByProjectChart';
import { CompletionTrendsChart } from '../components/charts/CompletionTrendsChart';
import { ProjectStatusTable } from '../components/projects/ProjectStatusTable';
import { useChartPreferences } from '../hooks/useChartPreferences';

interface Props {
  dashboard: DashboardPayload;
  filter: FilterParams;
  year: number;
}

export function ProjectStatusPage({ dashboard, filter, year }: Props) {
  const { prefs } = useChartPreferences();
  const summary = useMemo(() => computeProjectSummary(dashboard, filter), [dashboard, filter]);
  const statusDist = useMemo(() => computeStatusDistribution(dashboard, filter), [dashboard, filter]);
  const completion = useMemo(() => computeCompletionByProject(dashboard, filter), [dashboard, filter]);
  const bugs = useMemo(() => computeBugsByProject(dashboard, filter), [dashboard, filter]);
  const trends = useMemo(() => computeCompletionTrends(dashboard, year), [dashboard, year]);

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Active Projects" value={summary.totalProjects} color="blue" icon={<FolderOpen size={18} />} />
        <KpiCard label="On Track" value={summary.onTrack} color="green" icon={<CheckCircle size={18} />} />
        <KpiCard label="At Risk" value={summary.atRisk} color="yellow" icon={<AlertTriangle size={18} />} />
        <KpiCard label="Delayed" value={summary.delayed} color="red" />
        <KpiCard label="Avg Completion" value={`${summary.avgCompletion.toFixed(0)}%`} color="purple" icon={<TrendingUp size={18} />} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <ProjectStatusTable dashboard={dashboard} filter={filter} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {prefs['status-distribution'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Status Distribution</h3>
            <StatusDonutChart data={statusDist} />
          </div>
        )}
        {prefs['completion-by-project'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Completion % by Project</h3>
            <CompletionByProjectChart data={completion} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {prefs['bugs-by-project'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Bugs by Project</h3>
            <BugsByProjectChart data={bugs} />
          </div>
        )}
        {prefs['completion-trends'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Completion Trends — {year}</h3>
            <CompletionTrendsChart data={trends} />
          </div>
        )}
      </div>
    </div>
  );
}
