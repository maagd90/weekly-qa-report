import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardPayload, VendorPortalPhaseCategory } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { HorizBar } from '../components/qa/SegBar';
import { PriorityDonut } from '../components/qa/ResultDonut';
import { QaTable, QaThead } from '../components/qa/QaBadge';
import { PRIORITY_COLORS } from '../theme/qaTheme';
import { VendorPortalPhaseChart } from '../components/qa/VendorPortalPhaseChart';

interface UatPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

function barWidth(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max((count / max) * 100, 3);
}

type BugView = 'uat' | 'production' | 'unclassified';

const PHASE_FILTER_LABELS: Record<VendorPortalPhaseCategory, string> = {
  'phase1-uat': 'Phase 1 UAT',
  'phase2-uat': 'Phase 2 UAT',
  'other-uat': 'Other UAT',
  production: 'Production',
  unclassified: 'Unclassified',
};

const BUG_VIEW_LABELS: Record<BugView, string> = {
  uat: 'UAT bugs',
  production: 'Production bugs',
  unclassified: 'Unclassified',
};

const PAGE_SIZE = 10;

function displaySourceName(name: string): string {
  return name.replace(/^\d+_/, '');
}

export function UatPage({ dashboard, kpiStyle, searchQuery }: UatPageProps) {
  const [bugView, setBugView] = useState<BugView>('uat');
  const [page, setPage] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const uat = dashboard.uat;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const phaseItems = uat?.byReportedPhase || [];
  const searchedRows = useMemo(() => (uat?.rows || []).filter((row) =>
    !normalizedSearch
    || `${row.id} ${row.subject} ${row.area} ${row.submitter} ${row.status} ${row.priority} ${row.cr} ${row.sourceFile || ''}`.toLowerCase().includes(normalizedSearch)),
  [normalizedSearch, uat?.rows]);
  const categoryCount = (category: VendorPortalPhaseCategory): number =>
    searchedRows.filter((row) => (row.reportedPhase || 'unclassified') === category).length;
  const viewCounts: Record<BugView, number> = {
    uat: categoryCount('phase1-uat') + categoryCount('phase2-uat') + categoryCount('other-uat'),
    production: categoryCount('production'),
    unclassified: categoryCount('unclassified'),
  };
  const availableBugViews: BugView[] = viewCounts.unclassified > 0
    ? ['uat', 'production', 'unclassified']
    : ['uat', 'production'];

  const priorityItems = useMemo(() =>
    (uat?.byPriority || []).map((p) => ({
      label: p.priority,
      count: p.count,
      color: PRIORITY_COLORS[p.priority] || QA.muted,
    })),
  [uat?.byPriority]);

  const visibleRows = useMemo(() => {
    const rows = [...searchedRows].sort((left, right) =>
      (right.submittedAt || right.updatedAt || '').localeCompare(left.submittedAt || left.updatedAt || '')
      || left.id.localeCompare(right.id));

    if (bugView === 'uat') {
      return rows.filter((row) => {
        const category = row.reportedPhase || 'unclassified';
        return category === 'phase1-uat' || category === 'phase2-uat' || category === 'other-uat';
      });
    }
    return rows.filter((row) => (row.reportedPhase || 'unclassified') === bugView);
  }, [bugView, searchedRows]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const firstVisible = visibleRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const lastVisible = Math.min((safePage + 1) * PAGE_SIZE, visibleRows.length);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  useEffect(() => {
    setPage(0);
  }, [normalizedSearch]);

  useEffect(() => {
    if (bugView === 'unclassified' && viewCounts.unclassified === 0) {
      setBugView('uat');
      setPage(0);
    }
  }, [bugView, viewCounts.unclassified]);

  if (!uat) {
    return (
      <QaPageShell title="Vendor Portal Bugs">
        <div className="py-8 text-center text-qa-muted-light">No Vendor Portal Bug data loaded</div>
      </QaPageShell>
    );
  }

  const statusMax = Math.max(1, ...uat.byStatus.map((s) => s.count));
  const areaMax = Math.max(1, ...uat.byArea.map((a) => a.count));
  const submitterMax = Math.max(1, ...uat.bySubmitter.map((s) => s.count));
  function selectBugView(view: BugView, scrollToDetail = false): void {
    setBugView(view);
    setPage(0);
    if (scrollToDetail) {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior, block: 'start' }));
    }
  }

  return (
    <QaPageShell
      title="Vendor Portal Bugs"
      subtitle={`${fmt(uat.total)} bugs · ${uat.open} open`}
      intro="Vendor Portal bug logs — INC subjects are separated as Production; all remaining non-empty subjects stay in the UAT view. Search filters the bug rows instantly; apply dates only when the reporting period changes."
    >
      <QaKpiGrid cols={4}>
        <QaKpiCard kpiStyle={kpiStyle} label="Total Vendor Portal Bugs" value={fmt(uat.total)}
          sub="in current scope" color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Open" value={uat.open}
          sub="awaiting resolution" color={QA.BLOCKED} />
        <QaKpiCard kpiStyle={kpiStyle} label="Closed" value={uat.closed}
          sub={`${uat.closureRate}% closure rate`} color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="Urgent Open" value={uat.urgentOpen}
          sub="priority = Urgent" color={QA.FAIL} />
      </QaKpiGrid>

      {phaseItems.some((item) => item.count > 0) && (
        <QaSection
          title="Bug Distribution by Environment & Phase"
          subtitle="Automatically derived from Subject: Phase 2B UAT → Phase 2, INC → Production, and every other non-empty subject → Phase 1."
          className="mb-[22px]"
        >
          <VendorPortalPhaseChart
            items={phaseItems}
            onViewUnclassified={viewCounts.unclassified > 0 ? () => selectBugView('unclassified', true) : undefined}
          />
        </QaSection>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-[22px] mb-[22px]">
        <QaSection title="Bugs by Status" subtitle="Closed vs in-flight vendor portal bugs">
          <div className="flex flex-col gap-3">
            {uat.byStatus.map((r) => (
              <div key={r.status} className="flex items-center gap-3">
                <span className="text-[12.5px] w-[130px] shrink-0 truncate">{r.status}</span>
                <div className="flex-1"><HorizBar pct={barWidth(r.count, statusMax)} color={QA.accent} /></div>
                <span className="font-mono-qa text-xs text-qa-muted w-7 text-right">{r.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
        <QaSection title="By Priority">
          <PriorityDonut items={priorityItems} />
        </QaSection>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px] mb-[22px]">
        <QaSection title="By Product Area">
          <div className="flex flex-col gap-2.5">
            {uat.byArea.map((r) => (
              <div key={r.area} className="flex items-center gap-3">
                <span className="text-xs w-[150px] shrink-0 truncate">{r.area}</span>
                <div className="flex-1"><HorizBar pct={barWidth(r.count, areaMax)} color={QA.NA} /></div>
                <span className="font-mono-qa text-[11px] text-qa-muted w-6 text-right">{r.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
        <QaSection title="By Submitter">
          <div className="flex flex-col gap-2.5">
            {uat.bySubmitter.map((r) => (
              <div key={r.name} className="flex items-center gap-3">
                <span className="text-xs w-[150px] shrink-0 truncate">{r.name}</span>
                <div className="flex-1"><HorizBar pct={barWidth(r.count, submitterMax)} color={QA.BLOCKED} /></div>
                <span className="font-mono-qa text-[11px] text-qa-muted w-6 text-right">{r.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
      </div>

      <div ref={detailRef} className="scroll-mt-4">
        <QaSection
          title={`Vendor Portal Bugs — ${BUG_VIEW_LABELS[bugView]}`}
          subtitle={`${visibleRows.length} rows · newest submissions first`}
          noPadding
        >
          <div className="flex flex-col gap-3 border-b border-[#e9e5dc] px-4 py-3 sm:px-[22px] lg:flex-row lg:items-center lg:justify-between">
            <div className="qa-scroll max-w-full overflow-x-auto overscroll-x-contain" role="tablist" aria-label="Vendor Portal bug environment">
              <div className="flex min-w-max gap-1.5">
                {availableBugViews.map((view) => {
                  const active = bugView === view;
                  return (
                    <button
                      key={view}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectBugView(view)}
                      className={`shrink-0 border px-3 py-2 font-mono-qa text-[10px] font-semibold ${active ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white text-qa-muted hover:border-qa-ink'}`}
                    >
                      {BUG_VIEW_LABELS[view]} · {viewCounts[view]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono-qa text-[10.5px] text-qa-muted-light" aria-label="Vendor Portal bug pagination">
              <span>{firstVisible}–{lastVisible} of {visibleRows.length}</span>
              <span>Page {safePage + 1} of {totalPages}</span>
              <button
                type="button"
                aria-label="Go to previous Vendor Portal bug page"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={safePage === 0}
                className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                aria-label="Go to next Vendor Portal bug page"
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                disabled={safePage >= totalPages - 1}
                className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
          <QaTable>
            <QaThead cols={[
            { label: 'Ticket', className: 'pl-[22px]' },
            { label: 'Subject' },
            { label: 'Area' },
            { label: 'Priority' },
            { label: 'Status' },
            { label: 'Phase / Env' },
            { label: 'Source file' },
            { label: 'By' },
            { label: 'Submitted', align: 'right', className: 'pr-[22px]' },
            ]} />
            <tbody>
              {pageRows.map((r) => (
              <tr key={r.id} className="border-t border-[#f0ede5]">
                <td className="py-2.5 pl-[22px] font-mono-qa text-[11.5px]" style={{ color: QA.accent }}>{r.id}</td>
                <td className="max-w-[420px] px-3 py-2.5"><div className="whitespace-normal break-words leading-relaxed">{r.subject}</div></td>
                <td className="py-2.5 px-3 text-qa-muted whitespace-nowrap">{r.area}</td>
                <td className="py-2.5 px-3">
                  <span className="font-mono-qa text-[10px] px-2 py-0.5 text-white" style={{ background: PRIORITY_COLORS[r.priority] || QA.muted }}>
                    {r.priority}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-[12px]">{r.status}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <span className="font-mono-qa text-[9.5px] text-qa-muted">
                    {PHASE_FILTER_LABELS[r.reportedPhase || 'unclassified']}
                  </span>
                </td>
                <td className="max-w-[190px] px-3 py-2.5 font-mono-qa text-[10px] text-qa-muted" title={r.sourceFile ? displaySourceName(r.sourceFile) : undefined}>
                  <div className="truncate">{r.sourceFile ? displaySourceName(r.sourceFile) : '—'}</div>
                </td>
                <td className="py-2.5 px-3 text-qa-muted whitespace-nowrap">{r.submitter}</td>
                <td className="py-2.5 pr-[22px] text-right font-mono-qa text-[11.5px] text-qa-muted whitespace-nowrap">
                  {r.submittedAt ? r.submittedAt.slice(0, 10) : '—'}
                </td>
              </tr>
              ))}
              {visibleRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[12.5px] text-qa-muted-light sm:px-[22px]">
                  No {BUG_VIEW_LABELS[bugView].toLowerCase()} in the current scope.
                </td>
              </tr>
              )}
            </tbody>
          </QaTable>
        </QaSection>
      </div>
    </QaPageShell>
  );
}
