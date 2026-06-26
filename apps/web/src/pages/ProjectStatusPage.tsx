import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { projectsApi, type FilterParams } from '../lib/api';
import { KpiCard } from '../components/common/KpiCard';
import { StatusDonutChart } from '../components/charts/StatusDonutChart';
import { CompletionByProjectChart } from '../components/charts/CompletionByProjectChart';
import { BugsByProjectChart } from '../components/charts/BugsByProjectChart';
import { CompletionTrendsChart } from '../components/charts/CompletionTrendsChart';
import { ProjectStatusTable } from '../components/projects/ProjectStatusTable';

interface Props { filter: FilterParams; year: number; }

export function ProjectStatusPage({ filter, year }: Props) {
  const { data: summary } = useQuery({
    queryKey: ['project-summary', filter],
    queryFn: () => projectsApi.summary(filter),
  });

  const avg = summary?.avgCompletion != null ? Number(summary.avgCompletion).toFixed(0) + '%' : '—';

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Active Projects" value={summary?.totalProjects ?? '—'} color="blue" icon={<FolderOpen size={18} />} />
        <KpiCard label="On Track"        value={summary?.onTrack ?? '—'}       color="green" icon={<CheckCircle size={18} />} />
        <KpiCard label="At Risk"         value={summary?.atRisk ?? '—'}        color="yellow" icon={<AlertTriangle size={18} />} />
        <KpiCard label="Delayed"         value={summary?.delayed ?? '—'}       color="red" />
        <KpiCard label="Avg Completion"  value={avg}                            color="purple" icon={<TrendingUp size={18} />} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Project Status Report</h3>
        <ProjectStatusTable filter={filter} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Status Distribution</h3>
          <StatusDonutChart filter={filter} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Completion % by Project</h3>
          <CompletionByProjectChart filter={filter} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Bugs by Project</h3>
          <BugsByProjectChart filter={filter} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Completion Trends — {year}</h3>
          <CompletionTrendsChart year={year} />
        </div>
      </div>
    </div>
  );
}
