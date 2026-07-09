import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { fmt } from '../../theme/qaTheme';
import { getJiraConnections, getQmetryConnections } from '../../lib/api';
import { listWorkspaces, workspaceDisplayName } from '../../lib/workspace';

interface QaMastheadProps { dashboard?: DashboardPayload | null; project: string; projects: string[]; onProjectChange: (project: string) => void }

export function QaMasthead({ dashboard, project, projects, onProjectChange }: QaMastheadProps) {
  const totalCases = dashboard?.overview.totalCases ?? 0;
  const cycleCount = dashboard?.cycles.length ?? 0;
  const workspaces = useMemo(() => listWorkspaces({ jira: getJiraConnections(), qmetry: getQmetryConnections() }), []);

  return (
    <>
      <div className="h-1.5 bg-qa-ink" />
      <header className="max-w-qa mx-auto px-8 pt-[18px] print:hidden">
        <div className="flex items-end justify-between gap-6 pb-3.5 border-b-2 border-qa-ink">
          <div className="flex items-baseline gap-3.5"><div className="font-spectral font-extrabold text-[30px] tracking-tight leading-none">QA Weekly</div><div className="font-mono-qa text-[11px] tracking-widest uppercase text-qa-muted-light pb-0.5">Test Execution Report</div></div>
          <div className="text-right pb-0.5"><div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Project Workspace</div><div className="relative inline-flex items-center mt-1"><select value={project} onChange={(e) => onProjectChange(e.target.value)} className="appearance-none font-spectral font-semibold text-[15px] py-1 pl-2 pr-7 border border-qa-ink bg-white text-qa-ink cursor-pointer">{projects.map((p) => <option key={p} value={p}>{workspaceDisplayName(p, workspaces)}</option>)}</select><span className="absolute right-2 pointer-events-none text-[9px] text-qa-ink">▼</span></div></div>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-qa-ink"><div className="font-mono-qa text-[10.5px] tracking-wide uppercase text-qa-muted-light">{dashboard ? `Test execution data · ${fmt(totalCases)} records · ${cycleCount} cycles` : 'Awaiting data — stage files or sync report'}</div></div>
      </header>
    </>
  );
}
