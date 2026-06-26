import React, { useMemo } from 'react';
import { TestTube2, Bug, Users, CheckCircle } from 'lucide-react';
import type { FilterParams } from '../lib/api';
import type { DashboardPayload } from '../lib/dashboardCompute';
import {
  computeResourceSummary,
  computeCrAssignments,
  computeExecutionByResource,
  computeBugsByResource,
  computeWeeklyTrends,
} from '../lib/dashboardCompute';
import { KpiCard } from '../components/common/KpiCard';
import { ExecutionByResourceChart } from '../components/charts/ExecutionByResourceChart';
import { BugsByResourceChart } from '../components/charts/BugsByResourceChart';
import { WeeklyTrendsChart } from '../components/charts/WeeklyTrendsChart';
import { useChartPreferences } from '../hooks/useChartPreferences';

interface Props {
  dashboard: DashboardPayload;
  filter: FilterParams;
  year: number;
}

export function ResourcesPage({ dashboard, filter, year }: Props) {
  const { prefs } = useChartPreferences();

  const summary = useMemo(() => computeResourceSummary(dashboard, filter), [dashboard, filter]);
  const assignments = useMemo(() => computeCrAssignments(dashboard, filter), [dashboard, filter]);
  const execution = useMemo(() => computeExecutionByResource(dashboard, filter), [dashboard, filter]);
  const bugs = useMemo(() => computeBugsByResource(dashboard, filter), [dashboard, filter]);
  const trends = useMemo(() => computeWeeklyTrends(dashboard, year), [dashboard, year]);

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Tests Executed" value={summary.testsExecuted} sub={`${summary.testsPassed} passed / ${summary.testsFailed} failed`} color="blue" icon={<TestTube2 size={18} />} />
        <KpiCard label="Bugs Reported" value={summary.bugsReported} color="red" icon={<Bug size={18} />} />
        <KpiCard label="Bugs Closed" value={summary.bugsClosed} color="green" icon={<CheckCircle size={18} />} />
        <KpiCard label="Closure Rate" value={`${summary.bugClosureRate}%`} color="yellow" />
        <KpiCard label="Active Resources" value={summary.activeResources} color="purple" icon={<Users size={18} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {prefs['execution-by-resource'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Test Execution by Resource</h3>
            <ExecutionByResourceChart data={execution} />
          </div>
        )}
        {prefs['bugs-by-resource'] && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Bugs by Resource</h3>
            <BugsByResourceChart data={bugs} />
          </div>
        )}
      </div>

      {prefs['weekly-trends'] && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Weekly Trends — {year}</h3>
          <WeeklyTrendsChart data={trends} />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Resource — CR Assignments</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase text-xs">
              <th className="text-left px-4 py-3">Resource</th>
              <th className="text-left px-4 py-3">CR</th>
              <th className="text-left px-4 py-3">Project</th>
              <th className="text-right px-4 py-3">TC Exec</th>
              <th className="text-right px-4 py-3">Bugs</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-2">{String(row.resource_name)}</td>
                <td className="px-4 py-2 font-mono text-blue-600">{String(row.cr_id)}</td>
                <td className="px-4 py-2">{String(row.project_name)}</td>
                <td className="px-4 py-2 text-right">{String(row.tc_executed)}</td>
                <td className="px-4 py-2 text-right">{String(row.bugs_reported)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
