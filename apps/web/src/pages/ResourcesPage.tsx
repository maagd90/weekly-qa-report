import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TestTube2, Bug, Users, CheckCircle } from 'lucide-react';
import { resourcesApi, type FilterParams } from '../lib/api';
import { KpiCard } from '../components/common/KpiCard';
import { ExecutionByResourceChart } from '../components/charts/ExecutionByResourceChart';
import { BugsByResourceChart } from '../components/charts/BugsByResourceChart';
import { WeeklyTrendsChart } from '../components/charts/WeeklyTrendsChart';

interface Props { filter: FilterParams; year: number; }

export function ResourcesPage({ filter, year }: Props) {
  const { data: summary } = useQuery({
    queryKey: ['resource-summary', filter],
    queryFn: () => resourcesApi.summary(filter),
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['cr-assignments', filter],
    queryFn: () => resourcesApi.crAssignments(filter),
  });

  return (
    <div className="p-6 space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Tests Executed" value={summary?.testsExecuted ?? '—'} sub={`${summary?.testsPassed ?? 0} passed / ${summary?.testsFailed ?? 0} failed`} color="blue" icon={<TestTube2 size={18} />} />
        <KpiCard label="Bugs Reported"  value={summary?.bugsReported ?? '—'}  color="red"    icon={<Bug size={18} />} />
        <KpiCard label="Bugs Closed"    value={summary?.bugsClosed ?? '—'}    color="green"  icon={<CheckCircle size={18} />} />
        <KpiCard label="Closure Rate"   value={summary ? `${summary.bugClosureRate}%` : '—'} color="yellow" />
        <KpiCard label="Active Resources" value={summary?.activeResources ?? '—'} color="purple" icon={<Users size={18} />} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Test Execution by Resource</h3>
          <ExecutionByResourceChart filter={filter} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Bugs by Resource</h3>
          <BugsByResourceChart filter={filter} />
        </div>
      </div>

      {/* Weekly trends */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Weekly Trends — {year}</h3>
        <WeeklyTrendsChart year={year} />
      </div>

      {/* Assignment table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Resource — CR Assignments</h3>
        {assignments.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No assignments logged for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                  <th className="text-left px-4 py-3 font-semibold">Resource</th>
                  <th className="text-left px-4 py-3 font-semibold">Team</th>
                  <th className="text-left px-4 py-3 font-semibold">CR</th>
                  <th className="text-left px-4 py-3 font-semibold">Project</th>
                  <th className="text-right px-4 py-3 font-semibold">TC Exec</th>
                  <th className="text-right px-4 py-3 font-semibold">Pass</th>
                  <th className="text-right px-4 py-3 font-semibold">Fail</th>
                  <th className="text-right px-4 py-3 font-semibold">Bugs Rep.</th>
                  <th className="text-right px-4 py-3 font-semibold">Bugs Closed</th>
                  <th className="text-right px-4 py-3 font-semibold">Hours</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((row: Record<string, unknown>, i: number) => (
                  <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{String(row.resource_name || row.resource_id)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{String(row.team || '—')}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-blue-600">{String(row.cr_id)}</span>
                      <span className="ml-2 text-slate-600">{String(row.cr_title || '')}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{String(row.project_name || '—')}</td>
                    <td className="px-4 py-2.5 text-right">{String(row.tc_executed)}</td>
                    <td className="px-4 py-2.5 text-right text-green-600">{String(row.tc_passed)}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{String(row.tc_failed)}</td>
                    <td className="px-4 py-2.5 text-right">{String(row.bugs_reported)}</td>
                    <td className="px-4 py-2.5 text-right text-green-600">{String(row.bugs_closed)}</td>
                    <td className="px-4 py-2.5 text-right">{String(row.hours_spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
