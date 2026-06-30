import React from 'react';
import { StatusBadge } from '../components/common/StatusBadge';
import type { DashboardPayload } from 'qa-dashboard-batch';

interface CyclesPageProps {
  dashboard: DashboardPayload;
}

export function CyclesPage({ dashboard }: CyclesPageProps) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Pass</th>
              <th className="px-4 py-3 text-right">Fail</th>
              <th className="px-4 py-3 text-right">Blocked</th>
              <th className="px-4 py-3 text-right">NE</th>
              <th className="px-4 py-3 text-right">Pass %</th>
              <th className="px-4 py-3 text-right">Coverage</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.cyclesByPassPctAsc.map((c) => (
              <tr key={c.key} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-400 font-mono">{c.key}</div>
                </td>
                <td className="px-4 py-2.5 text-right">{c.total}</td>
                <td className="px-4 py-2.5 text-right text-green-600">{c.pass}</td>
                <td className="px-4 py-2.5 text-right text-red-600">{c.fail}</td>
                <td className="px-4 py-2.5 text-right text-amber-600">{c.blocked}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{c.ne}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{c.passPct}%</td>
                <td className="px-4 py-2.5 text-right">{c.coverage}%</td>
                <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
              </tr>
            ))}
            {!dashboard.cyclesByPassPctAsc.length && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No cycle data for this filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
