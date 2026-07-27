import React from 'react';
import type { DashboardByProject, DashboardPayload } from 'qa-dashboard-batch';
import { fmt } from '../../theme/qaTheme';
import { projectDisplayName } from '../../lib/projectDisplay';
export { projectSliceAsDashboard } from '../../lib/projectDashboardSlice';

function summary(slice?: DashboardByProject, dashboard?: DashboardPayload): string {
  const overview = slice?.overview || dashboard?.overview;
  const storyBug = slice?.storyBug || dashboard?.storyBug;
  if (!overview || !storyBug) return 'no metrics';
  if (overview.totalCases) return `${fmt(overview.totalCases)} test cases`;
  if (storyBug.story + storyBug.bug) return `${fmt(storyBug.story + storyBug.bug)} work items`;
  return 'no metrics';
}

export function ProjectBreakdownTabs({ dashboard, value, onChange, label }: {
  dashboard: DashboardPayload;
  value: string;
  onChange: (project: string) => void;
  label: string;
}) {
  const projects = dashboard.byProject || [];
  if (dashboard.scope.project !== 'all' || projects.length === 0) return null;
  return (
    <div className="qa-scroll mb-[22px] max-w-full overflow-x-auto overscroll-x-contain" role="tablist" aria-label={label}>
      <div className="flex min-w-max gap-2 pb-1">
        {['all', ...projects.map((item) => item.project)].map((project) => {
          const slice = projects.find((item) => item.project === project);
          const active = project === value;
          return <button key={project} type="button" role="tab" aria-selected={active} onClick={() => onChange(project)} className={`min-h-11 shrink-0 border bg-white px-3 py-2 text-left ${active ? 'border-qa-ink shadow-sm' : 'border-qa-border hover:border-qa-ink'}`}><div className="font-mono-qa text-[10px] uppercase tracking-wide text-qa-ink">{project === 'all' ? 'All' : projectDisplayName(project, dashboard.scope.projectNamesByKey)}</div><div className="mt-0.5 font-mono-qa text-[9.5px] text-qa-muted-light">{summary(slice, project === 'all' ? dashboard : undefined)}</div></button>;
        })}
      </div>
    </div>
  );
}
