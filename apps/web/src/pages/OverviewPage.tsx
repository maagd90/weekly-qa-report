import React from 'react';
import { KpiCard } from '../components/common/KpiCard';
import { StatusDonutChart } from '../components/charts/StatusDonutChart';
import { ByMonthChart } from '../components/charts/ByMonthChart';
import type { DashboardPayload } from 'qa-dashboard-batch';

interface OverviewPageProps {
  dashboard: DashboardPayload;
}

export function OverviewPage({ dashboard }: OverviewPageProps) {
  const { overview, storyBug, defectBacklog } = dashboard;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total cases" value={overview.totalCases} />
        <KpiCard label="Executed" value={overview.executed} />
        <KpiCard label="Pass rate" value={`${overview.passRate}%`} color="green" />
        <KpiCard label="Failed / Blocked" value={`${overview.failed} / ${overview.blocked}`} color="red" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Execution result mix</h3>
          <StatusDonutChart data={overview.chartSeries.resultMix} />
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {overview.resultMix.map((r) => (
              <div key={r.code} className="flex justify-between bg-slate-50 rounded px-2 py-1">
                <span>{r.label}</span>
                <span className="font-medium">{r.count} ({r.pct}%)</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Stories & bugs</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-blue-50 rounded-xl p-3"><div className="text-xs text-blue-600">Stories</div><div className="text-2xl font-bold">{storyBug.story}</div><div className="text-xs text-slate-500">{storyBug.storyOpen} open · {storyBug.storyDone} done</div></div>
            <div className="bg-red-50 rounded-xl p-3"><div className="text-xs text-red-600">Bugs</div><div className="text-2xl font-bold">{storyBug.bug}</div><div className="text-xs text-slate-500">{storyBug.bugOpen} open · {storyBug.bugDone} done</div></div>
          </div>
          <h3 className="text-sm font-semibold text-slate-700 pt-2">Defect backlog</h3>
          <p className="text-2xl font-bold text-slate-800">{defectBacklog.openTotal} open bugs</p>
          <div className="space-y-1 text-xs max-h-32 overflow-y-auto">
            {defectBacklog.topPriorities.map((p) => (
              <div key={p.priority} className="flex justify-between"><span>{p.priority}</span><span>{p.open} open</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Execution by month</h3>
        <ByMonthChart data={overview.byMonth} />
      </div>
    </div>
  );
}
