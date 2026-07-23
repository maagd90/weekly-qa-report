import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardPayload, DashboardUatRow } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt, PRIORITY_COLORS } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { HorizBar } from '../components/qa/SegBar';
import { PriorityDonut } from '../components/qa/ResultDonut';
import { QaTable, QaThead } from '../components/qa/QaBadge';
import { VendorPortalPhaseChart } from '../components/qa/VendorPortalPhaseChart';
import {
  EMPTY_VENDOR_PORTAL_FILTERS,
  basicFilterOptions,
  basicFiltersToQuery,
  clearUnavailableBasicFilters,
  filterVendorPortalRows,
  hasBasicFilters,
  rowsForBugView,
  submittedDisplayValue,
  visibleVendorPortalRowValues,
  type VendorPortalBasicField,
  type VendorPortalBasicFilters,
  type VendorPortalBugView,
} from '../lib/vendorPortalBugFilters';
import {
  advancedQueryToBasicFilters,
  compileVendorPortalQuery,
  vendorPortalQuerySuggestions,
} from '../lib/vendorPortalQuery';

interface UatPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

type SearchMode = 'basic' | 'advanced';

const BUG_VIEW_LABELS: Record<VendorPortalBugView, string> = {
  uat: 'UAT Bugs',
  production: 'Production Bugs',
  unclassified: 'Unclassified',
};

const BASIC_FIELDS: Array<{ key: VendorPortalBasicField; stateKey: keyof VendorPortalBasicFilters; label: string }> = [
  { key: 'status', stateKey: 'status', label: 'Status' },
  { key: 'priority', stateKey: 'priority', label: 'Priority' },
  { key: 'area', stateKey: 'area', label: 'Area' },
  { key: 'changeRequest', stateKey: 'changeRequest', label: 'Change Request' },
  { key: 'reportedBy', stateKey: 'reportedBy', label: 'Reported By' },
];

const PAGE_SIZE = 10;

function barWidth(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max((count / max) * 100, 3);
}

function rowSort(left: DashboardUatRow, right: DashboardUatRow): number {
  return (right.submittedAt || right.updatedAt || '').localeCompare(left.submittedAt || left.updatedAt || '')
    || left.id.localeCompare(right.id);
}

function sameFilters(left: VendorPortalBasicFilters, right: VendorPortalBasicFilters): boolean {
  return BASIC_FIELDS.every(({ stateKey }) => left[stateKey] === right[stateKey]) && left.text === right.text;
}

export function UatPage({ dashboard, kpiStyle, searchQuery }: UatPageProps) {
  const [bugView, setBugView] = useState<VendorPortalBugView>('uat');
  const [page, setPage] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode>('basic');
  const [basicFilters, setBasicFilters] = useState<VendorPortalBasicFilters>({ ...EMPTY_VENDOR_PORTAL_FILTERS });
  const [advancedDraft, setAdvancedDraft] = useState('');
  const [appliedAdvancedQuery, setAppliedAdvancedQuery] = useState('');
  const [advancedError, setAdvancedError] = useState<{ message: string; position?: number } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<VendorPortalBugView, HTMLButtonElement | null>>>({});
  const uat = dashboard.uat;
  const inheritedSearch = searchQuery.trim().toLocaleLowerCase();
  const phaseItems = uat?.byReportedPhase || [];

  const scopedRows = useMemo(() => (uat?.rows || []).filter((row) =>
    !inheritedSearch
    || visibleVendorPortalRowValues(row).some((value) => value.toLocaleLowerCase().includes(inheritedSearch))),
  [inheritedSearch, uat?.rows]);

  const viewCounts: Record<VendorPortalBugView, number> = {
    uat: rowsForBugView(scopedRows, 'uat').length,
    production: rowsForBugView(scopedRows, 'production').length,
    unclassified: rowsForBugView(scopedRows, 'unclassified').length,
  };
  const availableBugViews: VendorPortalBugView[] = viewCounts.unclassified > 0
    ? ['uat', 'production', 'unclassified']
    : ['uat', 'production'];
  const activeTabRows = useMemo(() => rowsForBugView(scopedRows, bugView), [bugView, scopedRows]);

  const priorityItems = useMemo(() =>
    (uat?.byPriority || []).map((item) => ({
      label: item.priority,
      count: item.count,
      color: PRIORITY_COLORS[item.priority] || QA.muted,
    })),
  [uat?.byPriority]);

  const compiledAdvancedQuery = useMemo(
    () => compileVendorPortalQuery(appliedAdvancedQuery),
    [appliedAdvancedQuery],
  );

  const visibleRows = useMemo(() => {
    const filtered = searchMode === 'basic'
      ? filterVendorPortalRows(activeTabRows, basicFilters)
      : activeTabRows.filter(compiledAdvancedQuery.predicate || (() => true));
    return [...filtered].sort(rowSort);
  }, [activeTabRows, appliedAdvancedQuery, basicFilters, compiledAdvancedQuery.predicate, searchMode]);

  const filterOptions = useMemo(() => Object.fromEntries(BASIC_FIELDS.map(({ key }) => [
    key,
    basicFilterOptions(activeTabRows, key, basicFilters),
  ])) as Record<VendorPortalBasicField, ReturnType<typeof basicFilterOptions>>, [activeTabRows, basicFilters]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const firstVisible = visibleRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const lastVisible = Math.min((safePage + 1) * PAGE_SIZE, visibleRows.length);
  const suggestions = useMemo(() => vendorPortalQuerySuggestions(activeTabRows), [activeTabRows]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  useEffect(() => {
    setPage(0);
  }, [bugView, dashboard.scope.project, dashboard.scope.startDate, dashboard.scope.endDate]);

  useEffect(() => {
    if (bugView === 'unclassified' && viewCounts.unclassified === 0) {
      setBugView('uat');
      setPage(0);
    }
  }, [bugView, viewCounts.unclassified]);

  useEffect(() => {
    setBasicFilters((current) => {
      const next = clearUnavailableBasicFilters(current, activeTabRows);
      return sameFilters(current, next) ? current : next;
    });
  }, [activeTabRows]);

  if (!uat) {
    return (
      <QaPageShell title="Vendor Portal Bugs">
        <div className="py-8 text-center text-qa-muted-light">No Vendor Portal Bug data loaded</div>
      </QaPageShell>
    );
  }

  const statusMax = Math.max(1, ...uat.byStatus.map((item) => item.count));
  const areaMax = Math.max(1, ...uat.byArea.map((item) => item.count));
  const submitterMax = Math.max(1, ...uat.bySubmitter.map((item) => item.count));

  function selectBugView(view: VendorPortalBugView, scrollToDetail = false): void {
    setBugView(view);
    setPage(0);
    if (scrollToDetail) {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior, block: 'start' }));
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: VendorPortalBugView): void {
    const currentIndex = availableBugViews.indexOf(current);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % availableBugViews.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + availableBugViews.length) % availableBugViews.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableBugViews.length - 1;
    else return;
    event.preventDefault();
    const next = availableBugViews[nextIndex];
    selectBugView(next);
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  function updateBasicFilter(key: keyof VendorPortalBasicFilters, value: string): void {
    setBasicFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }

  function openAdvancedSearch(): void {
    const query = basicFiltersToQuery(basicFilters);
    setAdvancedDraft(query);
    setAppliedAdvancedQuery(query);
    setAdvancedError(null);
    setSearchMode('advanced');
    setPage(0);
  }

  function returnToBasicSearch(): void {
    const converted = advancedQueryToBasicFilters(advancedDraft);
    if (!converted) {
      setAdvancedError({
        message: 'This query uses OR, NOT, ranges, grouping, or field-specific contains logic that Basic Search cannot represent. Clear or simplify it before returning to Basic Search.',
      });
      return;
    }
    setBasicFilters(converted);
    setAdvancedError(null);
    setSearchMode('basic');
    setPage(0);
  }

  function applyAdvancedSearch(): void {
    const compiled = compileVendorPortalQuery(advancedDraft);
    if (!compiled.predicate) {
      setAdvancedError({ message: compiled.error || 'The advanced query is invalid.', position: compiled.errorPosition });
      return;
    }
    setAppliedAdvancedQuery(advancedDraft.trim());
    setAdvancedError(null);
    setPage(0);
  }

  function clearAdvancedSearch(): void {
    setAdvancedDraft('');
    setAppliedAdvancedQuery('');
    setAdvancedError(null);
    setPage(0);
  }

  const activeSearchDescription = searchMode === 'advanced' && appliedAdvancedQuery
    ? ` for advanced query "${appliedAdvancedQuery}"`
    : searchMode === 'basic' && basicFilters.text.trim()
      ? ` matching "${basicFilters.text.trim()}"`
      : '';

  return (
    <QaPageShell
      title="Vendor Portal Bugs"
      subtitle={`${fmt(uat.total)} bugs · ${uat.open} open`}
      intro="Vendor Portal bugs are separated into UAT and Production views from the imported Subject convention. Use Basic Search for quick criteria or open Advanced Search for a local JQL-style expression."
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

      <div className="grid grid-cols-1 gap-[22px] mb-[22px] lg:grid-cols-[1.1fr_0.9fr]">
        <QaSection title="Bugs by Status" subtitle="Source statuses from the current Vendor Portal scope">
          <div className="flex flex-col gap-3">
            {uat.byStatus.map((item) => (
              <div key={item.status} className="flex items-center gap-3">
                <span className="w-[130px] shrink-0 truncate text-[12.5px]">{item.status}</span>
                <div className="flex-1"><HorizBar pct={barWidth(item.count, statusMax)} color={QA.accent} /></div>
                <span className="w-7 text-right font-mono-qa text-xs text-qa-muted">{item.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
        <QaSection title="By Priority">
          <PriorityDonut items={priorityItems} />
        </QaSection>
      </div>

      <div className="grid grid-cols-1 gap-[22px] mb-[22px] lg:grid-cols-2">
        <QaSection title="By Product Area">
          <div className="flex flex-col gap-2.5">
            {uat.byArea.map((item) => (
              <div key={item.area} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 truncate text-xs">{item.area}</span>
                <div className="flex-1"><HorizBar pct={barWidth(item.count, areaMax)} color={QA.NA} /></div>
                <span className="w-6 text-right font-mono-qa text-[11px] text-qa-muted">{item.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
        <QaSection title="By Submitter">
          <div className="flex flex-col gap-2.5">
            {uat.bySubmitter.map((item) => (
              <div key={item.name} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 truncate text-xs">{item.name}</span>
                <div className="flex-1"><HorizBar pct={barWidth(item.count, submitterMax)} color={QA.BLOCKED} /></div>
                <span className="w-6 text-right font-mono-qa text-[11px] text-qa-muted">{item.count}</span>
              </div>
            ))}
          </div>
        </QaSection>
      </div>

      <div ref={detailRef} className="scroll-mt-4">
        <QaSection
          title={`Vendor Portal Bugs — ${BUG_VIEW_LABELS[bugView]}`}
          subtitle={`${activeTabRows.length} classified rows · ${visibleRows.length} matching · newest submissions first`}
          noPadding
        >
          <div className="border-b border-[#e9e5dc] px-4 py-3 sm:px-[22px]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="qa-scroll max-w-full overflow-x-auto overscroll-x-contain" role="tablist" aria-label="Vendor Portal bug environment">
                <div className="flex min-w-max gap-1.5">
                  {availableBugViews.map((view) => {
                    const active = bugView === view;
                    return (
                      <button
                        ref={(node) => { tabRefs.current[view] = node; }}
                        key={view}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => selectBugView(view)}
                        onKeyDown={(event) => handleTabKeyDown(event, view)}
                        className={`shrink-0 border px-3 py-2 font-mono-qa text-[10px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-qa-accent ${active ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white text-qa-muted hover:border-qa-ink'}`}
                      >
                        {BUG_VIEW_LABELS[view]} · {viewCounts[view]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono-qa text-[10.5px] text-qa-muted-light" aria-label="Vendor Portal bug pagination">
                <span aria-live="polite">{firstVisible}–{lastVisible} of {visibleRows.length}</span>
                <span>Page {safePage + 1} of {totalPages}</span>
                <button type="button" aria-label="Go to previous Vendor Portal bug page" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage === 0} className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <button type="button" aria-label="Go to next Vendor Portal bug page" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={safePage >= totalPages - 1} className="border border-qa-border bg-white px-2.5 py-1.5 text-qa-ink disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
            </div>

            <div className="mt-4 border border-qa-border bg-[#faf8f2] p-3" aria-label={`${searchMode === 'basic' ? 'Basic' : 'Advanced'} Search`}>
              {searchMode === 'basic' ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-mono-qa text-[11px] uppercase tracking-wider">Basic Search</strong>
                    <button type="button" onClick={openAdvancedSearch} className="min-h-9 border-0 bg-transparent px-2 font-mono-qa text-[11px] font-semibold text-qa-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2">Advanced Search</button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {BASIC_FIELDS.map(({ key, stateKey, label }) => (
                      <label key={key} className="min-w-0 text-[11px] font-semibold text-qa-muted">
                        <span className="mb-1 block">{label}</span>
                        <select
                          aria-label={label}
                          value={basicFilters[stateKey]}
                          onChange={(event) => updateBasicFilter(stateKey, event.target.value)}
                          className="min-h-10 w-full min-w-0 border border-qa-border bg-white px-2 text-[12px] text-qa-ink"
                        >
                          <option value="">Any</option>
                          {filterOptions[key].map((option) => (
                            <option key={option.value.toLocaleLowerCase()} value={option.value}>
                              {option.value}{key === 'status' ? ` (${option.count})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="min-w-0 flex-1 text-[11px] font-semibold text-qa-muted">
                      <span className="mb-1 block">Search anything</span>
                      <input
                        type="search"
                        aria-label="Search anything"
                        value={basicFilters.text}
                        onChange={(event) => updateBasicFilter('text', event.target.value)}
                        placeholder="Ticket, subject, area, Change Request, priority, status, reported by, or submitted date"
                        className="min-h-10 w-full border border-qa-border bg-white px-3 text-[12px] text-qa-ink"
                      />
                    </label>
                    {hasBasicFilters(basicFilters) && (
                      <button type="button" onClick={() => { setBasicFilters({ ...EMPTY_VENDOR_PORTAL_FILTERS }); setPage(0); }} className="min-h-10 border border-qa-ink bg-white px-3 font-mono-qa text-[10.5px] font-semibold uppercase">Clear filters</button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-mono-qa text-[11px] uppercase tracking-wider">Advanced Search</strong>
                    <button type="button" onClick={returnToBasicSearch} className="min-h-9 border-0 bg-transparent px-2 font-mono-qa text-[11px] font-semibold text-qa-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2">Basic Search</button>
                  </div>
                  <label className="block text-[11px] font-semibold text-qa-muted">
                    <span className="mb-1 block">JQL-style query</span>
                    <input
                      type="text"
                      list="vendor-portal-query-suggestions"
                      aria-label="JQL-style query"
                      aria-invalid={Boolean(advancedError)}
                      aria-describedby={advancedError ? 'vendor-portal-query-error' : 'vendor-portal-query-help'}
                      value={advancedDraft}
                      onChange={(event) => setAdvancedDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          applyAdvancedSearch();
                        }
                      }}
                      placeholder='status = "Pending" AND priority = "High"'
                      className="min-h-11 w-full border border-qa-border bg-white px-3 font-mono-qa text-[12px] text-qa-ink"
                    />
                    <datalist id="vendor-portal-query-suggestions">
                      {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                    </datalist>
                  </label>
                  <p id="vendor-portal-query-help" className="mb-0 mt-1 text-[11px] text-qa-muted-light">Fields: ticket, subject, area, changeRequest, priority, status, by, submitted, text. Apply with Ctrl/Cmd + Enter.</p>
                  {advancedError && <p id="vendor-portal-query-error" role="alert" className="mb-0 mt-2 text-[12px] text-[#a13d2c]">{advancedError.message}{advancedError.position !== undefined ? ` Near character ${advancedError.position + 1}.` : ''}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={applyAdvancedSearch} className="min-h-10 border border-qa-ink bg-qa-ink px-4 font-mono-qa text-[10.5px] font-semibold uppercase text-white">Apply</button>
                    <button type="button" onClick={clearAdvancedSearch} className="min-h-10 border border-qa-ink bg-white px-4 font-mono-qa text-[10.5px] font-semibold uppercase">Clear</button>
                  </div>
                </>
              )}
            </div>
          </div>

          <QaTable label={`Vendor Portal ${BUG_VIEW_LABELS[bugView]} table`}>
            <QaThead cols={[
              { label: 'Ticket', className: 'w-[120px] pl-[22px] whitespace-nowrap' },
              { label: 'Subject', className: 'min-w-[280px] px-3' },
              { label: 'Area', className: 'min-w-[150px] px-3' },
              { label: 'Change Request', className: 'min-w-[150px] px-3' },
              { label: 'Priority', className: 'w-[110px] px-3 whitespace-nowrap' },
              { label: 'Status', className: 'w-[170px] px-3 whitespace-nowrap' },
              { label: 'By', className: 'min-w-[150px] px-3' },
              { label: 'Submitted', align: 'right', className: 'w-[120px] pr-[22px] whitespace-nowrap' },
            ]} />
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id} className="border-t border-[#f0ede5] align-top">
                  <td className="w-[120px] whitespace-nowrap py-2.5 pl-[22px] font-mono-qa text-[11.5px]" style={{ color: QA.accent }}>{row.id || '—'}</td>
                  <td className="min-w-[280px] max-w-[420px] px-3 py-2.5"><div className="break-words leading-relaxed">{row.subject || '—'}</div></td>
                  <td className="min-w-[150px] max-w-[220px] break-words px-3 py-2.5 text-qa-muted">{row.area || '—'}</td>
                  <td className="min-w-[150px] max-w-[240px] break-words px-3 py-2.5 font-mono-qa text-[11px] text-qa-muted" title={row.cr?.trim() || undefined}>{row.cr?.trim() || '—'}</td>
                  <td className="w-[110px] whitespace-nowrap px-3 py-2.5">
                    <span className="inline-block min-w-[70px] px-2 py-1 text-center font-mono-qa text-[10px] font-semibold text-white" style={{ background: PRIORITY_COLORS[row.priority] || QA.muted }}>{row.priority || '—'}</span>
                  </td>
                  <td className="w-[170px] whitespace-nowrap px-3 py-2.5">
                    <span className="inline-block min-w-[90px] border border-qa-border bg-[#f5f3ed] px-2 py-1 text-center font-mono-qa text-[10px] font-semibold text-qa-ink">{row.status || '—'}</span>
                  </td>
                  <td className="min-w-[150px] max-w-[220px] break-words px-3 py-2.5 text-qa-muted">{row.submitter || '—'}</td>
                  <td className="w-[120px] whitespace-nowrap py-2.5 pr-[22px] text-right font-mono-qa text-[11.5px] text-qa-muted">{submittedDisplayValue(row)}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[12.5px] text-qa-muted-light sm:px-[22px]">
                    No Vendor Portal {BUG_VIEW_LABELS[bugView].toLowerCase()} match the current search{activeSearchDescription}.
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
