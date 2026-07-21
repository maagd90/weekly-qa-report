import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { fmt } from '../../theme/qaTheme';
import { projectDisplayName } from '../../lib/projectDisplay';

interface QaMastheadProps {
  dashboard?: DashboardPayload | null;
  project: string;
  projects: string[];
  projectNames?: Record<string, string>;
  onProjectChange: (project: string) => void;
}

export function QaMasthead({ dashboard, project, projects, projectNames = {}, onProjectChange }: QaMastheadProps) {
  const totalCases = dashboard?.overview.totalCases ?? 0;
  const cycleCount = dashboard?.cycles.length ?? 0;

  return (
    <>
      <div className="h-1.5 bg-qa-ink" />
      <header className="max-w-qa mx-auto px-4 pt-4 sm:px-6 sm:pt-[18px] lg:px-8 print:hidden">
        <div className="flex flex-col items-stretch gap-3 pb-3.5 border-b-2 border-qa-ink sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:gap-3.5">
            <div className="font-spectral font-extrabold text-[26px] sm:text-[30px] tracking-tight leading-none">
              QA Weekly
            </div>
            <div className="font-mono-qa text-[11px] tracking-widest uppercase text-qa-muted-light pb-0.5">
              Test Execution Report
            </div>
          </div>
          <div className="min-w-0 text-left pb-0.5 sm:text-right">
            <label htmlFor="qa-project-select" className="block font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Project</label>
            <div className="relative flex w-full min-w-0 items-center mt-1 sm:inline-flex sm:w-auto">
              <select
                id="qa-project-select"
                value={project}
                onChange={(e) => onProjectChange(e.target.value)}
                className="appearance-none min-h-11 w-full min-w-0 max-w-full font-spectral font-semibold text-[15px] py-2 pl-3 pr-9 border border-qa-ink bg-white text-qa-ink cursor-pointer sm:min-h-0 sm:w-auto sm:py-1"
              >
                {projects.map((p) => <option key={p} value={p}>{projectNames[p] || projectDisplayName(p)}</option>)}
              </select>
              <span className="absolute right-2 pointer-events-none text-[9px] text-qa-ink">▼</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-qa-ink" aria-live="polite">
          <div className="min-w-0 font-mono-qa text-[10px] sm:text-[10.5px] tracking-wide uppercase text-qa-muted-light break-words">
            {dashboard
              ? `Test execution data · ${fmt(totalCases)} records · ${cycleCount} cycles`
              : 'Awaiting data — stage files or sync report'}
          </div>
        </div>
      </header>
    </>
  );
}
