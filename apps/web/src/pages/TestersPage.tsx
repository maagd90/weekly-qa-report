import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';

interface TestersPageProps {
  dashboard: DashboardPayload;
}

export function TestersPage({ dashboard }: TestersPageProps) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Tester</th>
              <th className="px-4 py-3 text-right">Executed</th>
              <th className="px-4 py-3 text-right">Pass</th>
              <th className="px-4 py-3 text-right">Fail</th>
              <th className="px-4 py-3 text-right">Blocked</th>
              <th className="px-4 py-3 text-right">Pass %</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.testers.map((t) => (
              <tr key={t.name} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{t.name}</td>
                <td className="px-4 py-2.5 text-right">{t.executed}</td>
                <td className="px-4 py-2.5 text-right text-green-600">{t.pass}</td>
                <td className="px-4 py-2.5 text-right text-red-600">{t.fail}</td>
                <td className="px-4 py-2.5 text-right text-amber-600">{t.blocked}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{t.passPct}%</td>
              </tr>
            ))}
            {!dashboard.testers.length && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No tester data for this filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
