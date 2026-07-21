import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardPayload, DashboardWorkItem } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { PRIORITY_COLORS, QA, fmt } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { QaTable, QaThead } from '../components/qa/QaBadge';

interface WonderMilesExportPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

type WorkItemStatusFilter = 'all' | DashboardWorkItem['status'];

const PAGE_SIZE = 10;
const STATUS_FILTERS: Array<{ id: WorkItemStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done / Closed' },
];

function displaySourceName(name?: string): string {
  return name ? name.replace(/^\d+_/, '') : '—';
}

function compareNewestFirst(left: DashboardWorkItem, right: DashboardWorkItem): number {
  const leftTime = Date.parse(left.updatedAt || '');
  const rightTime = Date.parse(right.updatedAt || '');
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.key.localeCompare(right.key);
}

function StatusTabs({ rows, value, onChange, label }: {
  rows: DashboardWorkItem[];
  value: WorkItemStatusFilter;
  onChange: (status: WorkItemStatusFilter) => void;
  label: string;
}) {
  const counts: Record<WorkItemStatusFilter, number> = {
    all: rows.length,
    open: rows.filter((row) => row.status === 'open').length,
    done: rows.filter((row) => row.status === 'done').length,
  };

  return (
    <div className="qa-scroll max-w-full overflow-x-auto overscroll-x-contain" role="tablist" aria-label={label}>
      <div className="flex min-w-max gap-1.5">
        {STATUS_FILTERS.map((status) => {
          const active = status.id === value;
          return (
            <button
              key={status.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(status.id)}
              className={`shrink-0 border px-3 py-1.5 font-mono-qa text-[9.5px] font-semibold ${active ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white text-qa-muted hover:border-qa-ink'}`}
            >
              {status.label} · {counts[status.id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkItemTable({ rows, emptyText }: { rows: DashboardWorkItem[]; emptyText: string }) {
  return (
    <>
      <QaTable>
        <QaThead cols={[
          { label: 'Key', className: 'pl-[22px]' },
          { label: 'Sprint' },
          { label: 'Summary' },
          { label: 'Priority' },
          { label: 'Status' },
          { label: 'Assignee' },
          { label: 'Updated' },
          { label: 'Source file', className: 'pr-[22px]' },
        ]} />
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.key}-${row.sourceFile || 'upload'}`} className="border-t border-[#f0ede5]">
              <td className="py-2.5 pl-[22px] font-mono-qa text-[11.5px]" style={{ color: row.issueType === 'Bug' ? QA.FAIL : QA.accent }}>{row.key}</td>
              <td className="px-3 py-2.5 font-mono-qa text-[11px] text-qa-muted whitespace-nowrap">{row.sprint || 'Not mapped'}</td>
              <td className="max-w-[420px] px-3 py-2.5"><div className="whitespace-normal break-words leading-relaxed">{row.summary || row.area}</div></td>
              <td className="px-3 py-2.5">
                <span className="px-2 py-0.5 font-mono-qa text-[10px] text-white" style={{ background: PRIORITY_COLORS[row.priority] || QA.muted }}>{row.priority}</span>
              </td>
              <td className="px-3 py-2.5 text-[12px]" style={{ color: row.status === 'done' ? QA.PASS : QA.BLOCKED }}>{row.status === 'done' ? 'Done / Closed' : 'Open'}</td>
              <td className="px-3 py-2.5 text-qa-muted whitespace-nowrap">{row.assignee}</td>
              <td className="px-3 py-2.5 font-mono-qa text-[11px] text-qa-muted whitespace-nowrap">{row.updatedAt || '—'}</td>
              <td className="max-w-[220px] py-2.5 pr-[22px] font-mono-qa text-[10px] text-qa-muted" title={displaySourceName(row.sourceFile)}>
                <div className="truncate">{displaySourceName(row.sourceFile)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </QaTable>
      {!rows.length && <div className="px-4 py-10 text-center text-[12.5px] text-qa-muted-light sm:px-[22px]">{emptyText}</div>}
    </>
  );
}

function Pager({ page, totalPages, totalRows, onPage }: { page: number; totalPages: number; totalRows: number; onPage: (page: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono-qa text-[10.5px] text-qa-muted-light">
      <span>Page {page + 1} of {totalPages} · {totalRows} rows</span>
      <button type="button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
      <button type="button" onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40">Next</button>
    </div>
  );
}

export function WonderMilesExportPage({ dashboard, kpiStyle, searchQuery }: WonderMilesExportPageProps) {
  const [storyStatus, setStoryStatus] = useState<WorkItemStatusFilter>('all');
  const [bugStatus, setBugStatus] = useState<WorkItemStatusFilter>('all');
  const [storyPage, setStoryPage] = useState(0);
  const [bugPage, setBugPage] = useState(0);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const allRows = useMemo(() => (dashboard.workItems || [])
    .filter((row) => !normalizedSearch || `${row.key} ${row.summary} ${row.sprint} ${row.area} ${row.assignee} ${row.status} ${row.priority} ${row.sourceFile || ''}`.toLowerCase().includes(normalizedSearch))
    .sort(compareNewestFirst), [dashboard.workItems, normalizedSearch]);
  const allStories = useMemo(() => allRows.filter((row) => row.issueType === 'Story'), [allRows]);
  const allBugs = useMemo(() => allRows.filter((row) => row.issueType === 'Bug'), [allRows]);
  const stories = useMemo(() => allStories.filter((row) => storyStatus === 'all' || row.status === storyStatus), [allStories, storyStatus]);
  const bugs = useMemo(() => allBugs.filter((row) => bugStatus === 'all' || row.status === bugStatus), [allBugs, bugStatus]);
  const storyPages = Math.max(1, Math.ceil(stories.length / PAGE_SIZE));
  const bugPages = Math.max(1, Math.ceil(bugs.length / PAGE_SIZE));
  const safeStoryPage = Math.min(storyPage, storyPages - 1);
  const safeBugPage = Math.min(bugPage, bugPages - 1);
  const storyRows = stories.slice(safeStoryPage * PAGE_SIZE, safeStoryPage * PAGE_SIZE + PAGE_SIZE);
  const bugRows = bugs.slice(safeBugPage * PAGE_SIZE, safeBugPage * PAGE_SIZE + PAGE_SIZE);
  const sourceFiles = useMemo(() => [...new Set(allRows.map((row) => row.sourceFile).filter((name): name is string => Boolean(name)))].sort(), [allRows]);

  useEffect(() => { setStoryPage(0); setBugPage(0); }, [dashboard.scope.startDate, dashboard.scope.endDate, normalizedSearch]);
  useEffect(() => { if (storyPage >= storyPages) setStoryPage(storyPages - 1); }, [storyPage, storyPages]);
  useEffect(() => { if (bugPage >= bugPages) setBugPage(bugPages - 1); }, [bugPage, bugPages]);

  return (
    <QaPageShell
      title="Wonder Miles Export Data"
      subtitle={`${fmt(allStories.length)} stories · ${fmt(allBugs.length)} bugs`}
      intro="Wonder Miles Story and Bug data from uploaded spreadsheets only. Live Jira and QMetry connection data is excluded; search is instant and Apply dates refilters the stored upload without calling either API."
    >
      <QaKpiGrid cols={4}>
        <QaKpiCard kpiStyle={kpiStyle} label="Stories" value={fmt(allStories.length)} sub="uploaded rows in scope" color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Open Stories" value={fmt(allStories.filter((row) => row.status === 'open').length)} sub="not Done / Closed" color={QA.BLOCKED} />
        <QaKpiCard kpiStyle={kpiStyle} label="Bugs" value={fmt(allBugs.length)} sub="uploaded rows in scope" color={QA.FAIL} />
        <QaKpiCard kpiStyle={kpiStyle} label="Open Bugs" value={fmt(allBugs.filter((row) => row.status === 'open').length)} sub="awaiting resolution" color={QA.FAIL} />
      </QaKpiGrid>

      <QaSection title="Uploaded Wonder Miles files" subtitle="Only synchronized Jira-style Story/Bug exports owned by the selected project are included" className="mb-[22px]">
        {sourceFiles.length ? (
          <div className="flex flex-wrap gap-2">{sourceFiles.map((name) => <span key={name} className="border border-qa-border bg-[#f7f5ef] px-2.5 py-1.5 font-mono-qa text-[10.5px] text-qa-muted">{displaySourceName(name)}</span>)}</div>
        ) : (
          <div className="text-[13px] text-qa-muted-light">No Wonder Miles Story/Bug export is loaded for this period. Upload the spreadsheet under the selected project; it will synchronize automatically.</div>
        )}
      </QaSection>

      <QaSection
        title={`Wonder Miles Stories (${allStories.length})`}
        subtitle={`${stories.length} matching rows · newest updates first`}
        noPadding
        className="mb-[22px]"
        headerRight={<div className="flex max-w-full flex-col items-start gap-2 sm:items-end"><StatusTabs rows={allStories} value={storyStatus} onChange={(status) => { setStoryStatus(status); setStoryPage(0); }} label="Filter Wonder Miles Stories by status" /><Pager page={safeStoryPage} totalPages={storyPages} totalRows={stories.length} onPage={setStoryPage} /></div>}
      >
        <WorkItemTable rows={storyRows} emptyText="No Wonder Miles Story rows match the current filters." />
      </QaSection>

      <QaSection
        title={`Wonder Miles Bugs (${allBugs.length})`}
        subtitle={`${bugs.length} matching rows · newest updates first`}
        noPadding
        headerRight={<div className="flex max-w-full flex-col items-start gap-2 sm:items-end"><StatusTabs rows={allBugs} value={bugStatus} onChange={(status) => { setBugStatus(status); setBugPage(0); }} label="Filter Wonder Miles Bugs by status" /><Pager page={safeBugPage} totalPages={bugPages} totalRows={bugs.length} onPage={setBugPage} /></div>}
      >
        <WorkItemTable rows={bugRows} emptyText="No Wonder Miles Bug rows match the current filters." />
      </QaSection>
    </QaPageShell>
  );
}
