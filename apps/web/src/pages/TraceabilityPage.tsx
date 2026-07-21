import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt, coverageColor } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { HorizBar } from '../components/qa/SegBar';
import { TraceBadge, QaTable, QaThead } from '../components/qa/QaBadge';
import { PRIORITY_COLORS } from '../theme/qaTheme';

interface TraceabilityPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

type WorkItem = {
  key: string;
  summary: string;
  issueType: 'Story' | 'Bug';
  status: 'open' | 'done';
  priority: string;
  assignee: string;
  sprint: string;
  area: string;
  project: string;
  updatedAt: string;
};

const PAGE_SIZE = 10;
type WorkItemStatusFilter = 'all' | WorkItem['status'];

const STATUS_FILTERS: Array<{ id: WorkItemStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done / Closed' },
];

type WorkItemPager = {
  page: number;
  totalPages: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
};

function Pager({ page, totalPages, setPage }: WorkItemPager) {
  return totalPages > 1 ? (
    <div className="flex items-center gap-2 font-mono-qa text-[10.5px] text-qa-muted-light" aria-label="Table pagination">
      <span aria-live="polite">Page {page + 1} of {totalPages} · {PAGE_SIZE} rows/page</span>
      <button type="button" aria-label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="min-h-10 px-3 py-1 border border-qa-border bg-white text-qa-ink disabled:opacity-40 sm:min-h-0 sm:px-2">Prev</button>
      <button type="button" aria-label="Next page" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="min-h-10 px-3 py-1 border border-qa-border bg-white text-qa-ink disabled:opacity-40 sm:min-h-0 sm:px-2">Next</button>
    </div>
  ) : <span className="font-mono-qa text-[10.5px] text-qa-muted-light">latest first</span>;
}

function compareNewestFirst(left: WorkItem, right: WorkItem): number {
  const leftTime = Date.parse(left.updatedAt || '');
  const rightTime = Date.parse(right.updatedAt || '');
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
  return normalizedRight - normalizedLeft
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || left.key.localeCompare(right.key);
}

function StatusTabs({ rows, value, onChange, label }: {
  rows: WorkItem[];
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
              className={`min-h-10 shrink-0 border px-3 py-1.5 font-mono-qa text-[9.5px] font-semibold sm:min-h-0 ${active ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white text-qa-muted hover:border-qa-ink'}`}
            >
              {status.label} · {counts[status.id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkItemsTable({ rows, emptyText }: { rows: WorkItem[]; emptyText: string }) {
  return (
    <>
      <QaTable>
        <QaThead cols={[{ label: 'Key', className: 'pl-[22px]' }, { label: 'Sprint No.' }, { label: 'Summary' }, { label: 'Priority' }, { label: 'Status' }, { label: 'Updated' }, { label: 'Assignee', className: 'pr-[22px]' }]} />
        <tbody>
          {rows.map((w) => (
            <tr key={w.key} className="border-t border-[#f0ede5]">
              <td className="py-2.5 pl-[22px] font-mono-qa text-[11.5px]" style={{ color: w.issueType === 'Bug' ? QA.FAIL : QA.accent }}>{w.key}</td>
              <td className="py-2.5 px-3 font-mono-qa text-[11px] text-qa-muted whitespace-nowrap">{w.sprint || 'Not mapped'}</td>
              <td className="py-2.5 px-3 max-w-[420px]"><div className="whitespace-normal break-words leading-relaxed">{w.summary || w.area}</div></td>
              <td className="py-2.5 px-3 text-[12px]">{w.priority}</td>
              <td className="py-2.5 px-3 text-[12px]" style={{ color: w.status === 'done' ? QA.PASS : QA.BLOCKED }}>{w.status === 'done' ? 'Done / Closed' : 'Open'}</td>
              <td className="py-2.5 px-3 font-mono-qa text-[11px] text-qa-muted whitespace-nowrap">{w.updatedAt || '-'}</td>
              <td className="py-2.5 pr-[22px] text-qa-muted whitespace-nowrap">{w.assignee}</td>
            </tr>
          ))}
        </tbody>
      </QaTable>
      {!rows.length && <div className="py-8 text-center text-[13px] text-qa-muted-light">{emptyText}</div>}
    </>
  );
}

export function TraceabilityPage({ dashboard, kpiStyle, searchQuery }: TraceabilityPageProps) {
  const { traceability, storyBug, defectBacklog } = dashboard;
  const [storyPage, setStoryPage] = useState(0);
  const [bugPage, setBugPage] = useState(0);
  const [storyStatus, setStoryStatus] = useState<WorkItemStatusFilter>('all');
  const [bugStatus, setBugStatus] = useState<WorkItemStatusFilter>('all');
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const allWorkItems = useMemo(() => {
    const rows = (((dashboard as unknown as { workItems?: WorkItem[] }).workItems) || []);
    return rows
      .filter((row) => !normalizedSearch || `${row.key} ${row.summary} ${row.sprint} ${row.area} ${row.assignee} ${row.status} ${row.priority} ${row.project}`.toLowerCase().includes(normalizedSearch))
      .sort(compareNewestFirst);
  }, [dashboard, normalizedSearch]);

  const allStoryRows = useMemo(() => allWorkItems.filter((w) => w.issueType === 'Story'), [allWorkItems]);
  const allBugRows = useMemo(() => allWorkItems.filter((w) => w.issueType === 'Bug'), [allWorkItems]);
  const storyRows = useMemo(() => allStoryRows.filter((row) => storyStatus === 'all' || row.status === storyStatus), [allStoryRows, storyStatus]);
  const bugRows = useMemo(() => allBugRows.filter((row) => bugStatus === 'all' || row.status === bugStatus), [allBugRows, bugStatus]);
  const storyTotalPages = Math.max(1, Math.ceil(storyRows.length / PAGE_SIZE));
  const bugTotalPages = Math.max(1, Math.ceil(bugRows.length / PAGE_SIZE));
  const safeStoryPage = Math.min(storyPage, storyTotalPages - 1);
  const safeBugPage = Math.min(bugPage, bugTotalPages - 1);
  const visibleStories = storyRows.slice(safeStoryPage * PAGE_SIZE, safeStoryPage * PAGE_SIZE + PAGE_SIZE);
  const visibleBugs = bugRows.slice(safeBugPage * PAGE_SIZE, safeBugPage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { if (storyPage > storyTotalPages - 1) setStoryPage(Math.max(0, storyTotalPages - 1)); }, [storyPage, storyTotalPages]);
  useEffect(() => { if (bugPage > bugTotalPages - 1) setBugPage(Math.max(0, bugTotalPages - 1)); }, [bugPage, bugTotalPages]);
  useEffect(() => {
    setStoryPage(0);
    setBugPage(0);
  }, [dashboard.scope.startDate, dashboard.scope.endDate, dashboard.scope.project, normalizedSearch]);

  function selectStoryStatus(status: WorkItemStatusFilter): void {
    setStoryStatus(status);
    setStoryPage(0);
  }

  function selectBugStatus(status: WorkItemStatusFilter): void {
    setBugStatus(status);
    setBugPage(0);
  }

  const traceKpis = useMemo(() => {
    const verified = traceability.filter((t) => t.status === 'Verified').length;
    const atRisk = traceability.filter((t) => t.status === 'At Risk').length;
    const totStories = traceability.reduce((a, b) => a + b.stories, 0);
    const totDone = traceability.reduce((a, b) => a + b.done, 0);
    const avgCompletion = totStories ? Math.round((totDone / totStories) * 100) : 0;
    return { verified, atRisk, avgCompletion, areas: traceability.length };
  }, [traceability]);

  const openMax = Math.max(1, ...defectBacklog.byPriority.map((p) => p.open));
  const ownerMax = Math.max(1, ...defectBacklog.byOwner.map((o) => o.open));

  return (
    <QaPageShell
      title="Requirements Traceability Matrix"
      subtitle="Story and Bug rows are shown separately with pagination"
      intro="Every Story and Bug work item from JIRA is shown with sprint information when available. Search filters these rows instantly; change the dates and apply them only when you need a different reporting period."
    >
      <QaKpiGrid cols={4}>
        <QaKpiCard kpiStyle={kpiStyle} label="Story Requirements" value={fmt(storyBug.story)} sub={`${traceKpis.areas} feature areas`} color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Verified" value={traceKpis.verified} sub="all stories done, no open bugs" color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="At Risk" value={traceKpis.atRisk} sub="open defects against story" color={QA.FAIL} />
        <QaKpiCard kpiStyle={kpiStyle} label="Avg Completion" value={`${traceKpis.avgCompletion}%`} sub="stories delivered" color={QA.BLOCKED} />
      </QaKpiGrid>

      <QaSection title="Story Delivery by Feature Area" noPadding className="mb-[22px]" headerRight={<div className="flex gap-3.5 flex-wrap">{[{ label: 'Verified', border: '#2f6a48', bg: '#e7f0e9' }, { label: 'In Progress', border: '#9a6a12', bg: '#f6efd9' }, { label: 'At Risk', border: '#a13d2c', bg: '#f6e4df' }].map((l) => <span key={l.label} className="flex items-center gap-1 text-[10.5px] text-qa-muted"><span className="w-2.5 h-2.5 border" style={{ background: l.bg, borderColor: l.border }} />{l.label}</span>)}</div>}>
        <QaTable>
          <QaThead cols={[{ label: 'Feature Area', className: 'pl-[22px]' }, { label: 'Status' }, { label: 'Completion', className: 'w-[150px]' }, { label: 'Stories', align: 'right' }, { label: 'Done', align: 'right' }, { label: 'Open', align: 'right' }, { label: 'Bugs', align: 'right' }, { label: 'Open Bugs', align: 'right', className: 'pr-[22px]' }]} />
          <tbody>
            {traceability.map((r) => (
              <tr key={r.area} className="border-t border-[#f0ede5]">
                <td className="py-3 pl-[22px] font-semibold">{r.area}</td>
                <td className="py-3 px-3"><TraceBadge status={r.status} /></td>
                <td className="py-3 px-3"><div className="flex items-center gap-2"><div className="flex-1 h-[7px] bg-qa-track"><div style={{ width: `${r.completion}%`, height: '100%', background: r.completion >= 80 ? QA.PASS : r.completion >= 40 ? QA.BLOCKED : QA.FAIL }} /></div><span className="font-mono-qa text-[11px] w-[34px] text-right" style={{ color: coverageColor(r.completion) }}>{r.completion}%</span></div></td>
                <td className="py-3 px-3 text-right font-mono-qa">{r.stories}</td>
                <td className="py-3 px-3 text-right font-mono-qa text-[#2f6a48]">{r.done}</td>
                <td className="py-3 px-3 text-right font-mono-qa" style={{ color: r.open > 0 ? '#9a6a12' : '#b3aea3' }}>{r.open}</td>
                <td className="py-3 px-3 text-right font-mono-qa text-qa-muted">{r.bugs}</td>
                <td className="py-3 pr-[22px] text-right font-mono-qa" style={{ color: r.openBugs > 0 ? '#a13d2c' : '#b3aea3' }}>{r.openBugs}</td>
              </tr>
            ))}
          </tbody>
        </QaTable>
        {!traceability.length && <div className="py-8 text-center text-[13px] text-qa-muted-light">No Story requirements match the current filters.</div>}
      </QaSection>

      <QaSection
        title={`Stories by Sprint (${allStoryRows.length})`}
        subtitle={`${storyRows.length} matching rows · newest updates first`}
        noPadding
        className="mb-[22px]"
        headerRight={(
          <div className="flex max-w-full flex-col items-start gap-2 sm:items-end">
            <StatusTabs rows={allStoryRows} value={storyStatus} onChange={selectStoryStatus} label="Filter Stories by status" />
            <Pager page={safeStoryPage} totalPages={storyTotalPages} setPage={setStoryPage} />
          </div>
        )}
      >
        <WorkItemsTable rows={visibleStories} emptyText="No Story rows available for the current filters." />
      </QaSection>

      <QaSection
        title={`Bugs by Sprint (${allBugRows.length})`}
        subtitle={`${bugRows.length} matching rows · newest updates first`}
        noPadding
        className="mb-[22px]"
        headerRight={(
          <div className="flex max-w-full flex-col items-start gap-2 sm:items-end">
            <StatusTabs rows={allBugRows} value={bugStatus} onChange={selectBugStatus} label="Filter Bugs by status" />
            <Pager page={safeBugPage} totalPages={bugTotalPages} setPage={setBugPage} />
          </div>
        )}
      >
        <WorkItemsTable rows={visibleBugs} emptyText="No Bug rows available for the current filters." />
      </QaSection>

      <QaSection>
        <div className="flex flex-wrap gap-6">
          <div className="flex-1 min-w-0 sm:min-w-[280px]">
            <div className="flex items-baseline gap-2 mb-1"><h3 className="font-spectral font-semibold text-base m-0">Open Defect Backlog</h3><span className="font-mono-qa text-[10px] text-qa-muted-light">Bug issues · not Done</span></div>
            <p className="m-0 mb-4 text-[11.5px] text-qa-muted-light">{defectBacklog.openTotal} bugs open in scope · {defectBacklog.byPriority.find((p) => p.priority === 'Highest')?.open ?? 0} at Highest priority</p>
            <div className="flex flex-col gap-3">
              {defectBacklog.byPriority.map((b) => <div key={b.priority}><div className="flex justify-between items-baseline mb-1"><span className="flex items-center gap-2 text-[13px] font-semibold"><span className="w-[11px] h-[11px]" style={{ background: PRIORITY_COLORS[b.priority] || QA.muted }} />{b.priority} priority</span><span className="font-mono-qa text-xs text-qa-muted">{b.open} open / {b.total} total</span></div><HorizBar pct={(b.open / openMax) * 100} color={PRIORITY_COLORS[b.priority] || QA.muted} /></div>)}
            </div>
            {defectBacklog.openTotal === 0 && <div className="py-4 text-[12.5px] text-qa-muted-light">No open defects in the current scope.</div>}
          </div>
          <div className="flex-1 min-w-0 border-t border-[#efece4] pt-5 sm:min-w-[230px] sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <div className="font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light mb-3.5">Open bugs by owner</div>
            <div className="flex flex-col gap-3">{defectBacklog.byOwner.map((o) => <div key={o.name}><div className="flex justify-between items-baseline mb-1"><span className="text-[13px] font-semibold">{o.name}</span><span className="font-mono-qa text-xs text-qa-muted">{o.open}</span></div><HorizBar pct={(o.open / ownerMax) * 100} color={QA.FAIL} /></div>)}</div>
            {defectBacklog.openTotal === 0 && <div className="py-4 text-[12.5px] text-qa-muted-light">-</div>}
          </div>
        </div>
      </QaSection>
    </QaPageShell>
  );
}
