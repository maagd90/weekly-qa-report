import React from 'react';
import { KpiCard } from '../components/common/KpiCard';
import type { DashboardPayload } from 'qa-dashboard-batch';

interface UatPageProps {
  dashboard: DashboardPayload;
}

export function UatPage({ dashboard }: UatPageProps) {
  const uat = dashboard.uat;
  if (!uat) {
    return (
      <div className="p-6 text-center text-slate-400">No UAT data loaded</div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total UAT" value={uat.total} />
        <KpiCard label="Open" value={uat.open} color="yellow" />
        <KpiCard label="Closed" value={uat.closed} color="green" />
        <KpiCard label="Closure rate" value={`${uat.closureRate}%`} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitter</th>
            </tr>
          </thead>
          <tbody>
            {uat.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-2 max-w-md truncate">{r.subject}</td>
                <td className="px-4 py-2">{r.area}</td>
                <td className="px-4 py-2">{r.priority}</td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">{r.submitter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
