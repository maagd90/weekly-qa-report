import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { fmt } from '../../theme/qaTheme';

interface QaMastheadProps {
  dashboard?: DashboardPayload | null;
}

export function QaMasthead({ dashboard }: QaMastheadProps) {
  const projectLabel = dashboard?.scope.project && dashboard.scope.project !== 'all'
    ? `${dashboard.scope.project} · Travel Studio`
    : 'DLM · Travel Studio';

  const totalCases = dashboard?.overview.totalCases ?? 0;
  const cycleCount = dashboard?.cycles.length ?? 0;
  const fileHint = dashboard?.files?.length
    ? dashboard.files.map((f) => f.name).slice(0, 2).join(', ')
    : 'no files loaded';

  return (
    <>
      <div className="h-1.5 bg-qa-ink" />
      <header className="max-w-qa mx-auto px-8 pt-[18px] print:hidden">
        <div className="flex items-end justify-between gap-6 pb-3.5 border-b-2 border-qa-ink">
          <div className="flex items-baseline gap-3.5">
            <div className="font-spectral font-extrabold text-[30px] tracking-tight leading-none">
              QA&nbsp;Weekly
            </div>
            <div className="font-mono-qa text-[11px] tracking-widest uppercase text-qa-muted-light pb-0.5">
              Test&nbsp;Execution&nbsp;Report
            </div>
          </div>
          <div className="text-right pb-0.5">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">Project</div>
            <div className="font-spectral font-semibold text-[15px]">{projectLabel}</div>
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-qa-ink">
          <div className="font-mono-qa text-[10.5px] tracking-wide uppercase text-qa-muted-light">
            {dashboard
              ? `Test execution data · ${fmt(totalCases)} records · ${cycleCount} cycles`
              : 'Awaiting data — stage files or generate report'}
          </div>
          <div className="font-mono-qa text-[10.5px] tracking-wide uppercase text-qa-muted-light hidden sm:block">
            Source: {fileHint}
          </div>
        </div>
      </header>
    </>
  );
}
