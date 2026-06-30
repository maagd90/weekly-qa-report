import React from 'react';
import { StatusBadge } from '../components/common/StatusBadge';
import type { DashboardPayload } from 'qa-dashboard-batch';

interface TraceabilityPageProps {
  dashboard: DashboardPayload;
}

export function TraceabilityPage({ dashboard }: TraceabilityPageProps) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Feature area</th>
              <th className="px-4 py-3 text-right">Stories</th>
              <th className="px-4 py-3 text-right">Done</th>
              <th className="px-4 py-3 text-right">Open</th>
              <th className="px-4 py-3 text-right">Bugs</th>
              <th className="px-4 py-3 text-right">Open bugs</th>
              <th className="px-4 py-3 text-right">Completion</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.traceability.map((r) => (
              <tr key={r.area} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{r.area}</td>
                <td className="px-4 py-2.5 text-right">{r.stories}</td>
                <td className="px-4 py-2.5 text-right text-green-600">{r.done}</td>
                <td className="px-4 py-2.5 text-right">{r.open}</td>
                <td className="px-4 py-2.5 text-right">{r.bugs}</td>
                <td className="px-4 py-2.5 text-right text-red-600">{r.openBugs}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{r.completion}%</td>
                <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
