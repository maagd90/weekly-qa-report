import React from 'react';
import type { DashboardPayload, DashboardWorkItem } from 'qa-dashboard-batch';
import { QA, fmt } from '../../theme/qaTheme';

function uploadedRows(dashboard: DashboardPayload): DashboardWorkItem[] {
  return (dashboard.workItems || []).filter((row) => Boolean(row.sourceFile) && /^(DP|DTTRV|WONDERMILES)$/i.test(row.project || ''));
}

export function hasWonderMilesExportData(dashboard: DashboardPayload): boolean {
  return uploadedRows(dashboard).length > 0;
}

export function AiReportWonderMilesSection({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = uploadedRows(dashboard);
  if (!rows.length) return null;
  const stories = rows.filter((row) => row.issueType === 'Story');
  const bugs = rows.filter((row) => row.issueType === 'Bug');
  const openBugs = bugs.filter((row) => row.status === 'open').length;
  const sources = new Set(rows.map((row) => row.sourceFile).filter(Boolean));
  return (
    <div className="pdf-section border border-qa-border bg-white p-5">
      <div className="mb-4 font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light">Wonder Miles Export Data</div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[{ label: 'Total Rows', value: rows.length, color: QA.accent }, { label: 'Stories', value: stories.length, color: QA.accent }, { label: 'Bugs', value: bugs.length, color: QA.FAIL }, { label: 'Open Bugs', value: openBugs, color: QA.BLOCKED }].map((item) => <div key={item.label} className="border border-[#efece4] bg-[#faf8f2] p-3"><div className="mb-1 font-mono-qa text-[9px] uppercase text-qa-muted-light">{item.label}</div><div className="font-spectral text-2xl font-bold" style={{ color: item.color }}>{fmt(item.value)}</div></div>)}
      </div>
      <div className="mb-3 text-[11px] text-qa-muted">{sources.size} uploaded source file{sources.size === 1 ? '' : 's'} · latest 10 items shown</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-[12px]"><thead><tr className="border-b border-qa-border text-left font-mono-qa text-[10px] uppercase text-qa-muted-light"><th className="py-2 pr-3">Key</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Summary</th><th className="py-2 pr-3">Status</th><th className="py-2">Priority</th></tr></thead><tbody>{rows.slice(0, 10).map((row) => <tr key={`${row.project}:${row.key}:${row.sourceFile}`} className="border-b border-[#f3f0e8] last:border-b-0"><td className="py-2 pr-3 font-mono-qa">{row.key}</td><td className="py-2 pr-3">{row.issueType}</td><td className="max-w-[360px] py-2 pr-3">{row.summary}</td><td className="py-2 pr-3">{row.status === 'done' ? 'Done / Closed' : 'Open'}</td><td className="py-2">{row.priority}</td></tr>)}</tbody></table></div>
    </div>
  );
}
