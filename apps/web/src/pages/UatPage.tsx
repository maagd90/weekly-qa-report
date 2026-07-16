import React, { useMemo, useState } from 'react';
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
}

function barWidth(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max((count / max) * 100, 3);
}

type PhaseFilter = 'all' | VendorPortalPhaseCategory;

const PHASE_FILTER_LABELS: Record<PhaseFilter, string> = {
  all: 'All bugs',
  'phase1-uat': 'Phase 1 UAT',
  'phase2-uat': 'Phase 2 UAT',
  production: 'Production',
  unclassified: 'Unclassified',
};

function displaySourceName(name: string): string {
  return name.replace(/^\d+_/, '');
}

export function UatPage({ dashboard, kpiStyle }: UatPageProps) {
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const uat = dashboard.uat;
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
  const phaseItems = uat.byReportedPhase || [];
  const sourceFiles = uat.sourceFiles || [];
  const visibleRows = phaseFilter === 'all'
    ? uat.rows
    : uat.rows.filter((row) => (row.reportedPhase || 'unclassified') === phaseFilter);

  const priorityItems = useMemo(() =>
    uat.byPriority.map((p) => ({
      label: p.priority,
      count: p.count,
      color: PRIORITY_COLORS[p.priority] || QA.muted,
    })),
  [uat.byPriority]);

  return (
    <QaPageShell
      title="Vendor Portal Bugs"
      subtitle={`${fmt(uat.total)} bugs · ${uat.open} open`}
      intro="DLM Vendor Portal bug logs — daily ODL and production exports are merged, then separated by the Subject prefix. This tab is shown only when the dashboard project filter is DLM."
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
          title="Reported Phase / Environment"
          subtitle="Automatically derived from the start of each Subject: UAT → Phase 1, Phase 2B UAT → Phase 2, INC → Production."
          className="mb-[22px]"
          headerRight={sourceFiles.length > 0 ? (
            <div className="max-w-full text-right font-mono-qa text-[10px] text-qa-muted-light">
              <div>{sourceFiles.length} ODL source file{sourceFiles.length === 1 ? '' : 's'} in scope</div>
              <div className="mt-1 flex max-w-full flex-wrap justify-end gap-1.5">
                {sourceFiles.map((file) => (
                  <span key={file.name} className="max-w-full truncate border border-qa-border bg-[#faf8f2] px-2 py-1" title={displaySourceName(file.name)}>
                    {displaySourceName(file.name)} · {file.rows}
                  </span>
                ))}
              </div>
            </div>
          ) : undefined}
        >
          <VendorPortalPhaseChart items={phaseItems} />
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

      <QaSection
        title={`Vendor Portal Bugs — ${PHASE_FILTER_LABELS[phaseFilter]}`}
        subtitle={`${visibleRows.length} of ${uat.rows.length} rows shown`}
        noPadding
        headerRight={phaseItems.length > 0 ? (
          <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label="Filter Vendor Portal bugs by reported phase">
            {(['all', 'phase1-uat', 'phase2-uat', 'production', 'unclassified'] as PhaseFilter[]).map((category) => {
              const count = category === 'all'
                ? uat.total
                : phaseItems.find((item) => item.category === category)?.count || 0;
              const active = phaseFilter === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPhaseFilter(category)}
                  className={`border px-2.5 py-1 font-mono-qa text-[9.5px] font-semibold ${active ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white text-qa-muted hover:border-qa-ink'}`}
                >
                  {PHASE_FILTER_LABELS[category]} · {count}
                </button>
              );
            })}
          </div>
        ) : undefined}
      >
        <QaTable>
          <QaThead cols={[
            { label: 'Ticket', className: 'pl-[22px]' },
            { label: 'Subject' },
            { label: 'Area' },
            { label: 'Priority' },
            { label: 'Status' },
            { label: 'Phase / Env' },
            { label: 'By' },
            { label: 'Submitted', align: 'right', className: 'pr-[22px]' },
          ]} />
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.id} className="border-t border-[#f0ede5]">
                <td className="py-2.5 pl-[22px] font-mono-qa text-[11.5px]" style={{ color: QA.accent }}>{r.id}</td>
                <td className="py-2.5 px-3 max-w-[360px]"><div className="truncate">{r.subject}</div></td>
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
                <td className="py-2.5 px-3 text-qa-muted whitespace-nowrap">{r.submitter}</td>
                <td className="py-2.5 pr-[22px] text-right font-mono-qa text-[11.5px] text-qa-muted whitespace-nowrap">
                  {r.submittedAt ? r.submittedAt.slice(0, 10) : '—'}
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[12.5px] text-qa-muted-light sm:px-[22px]">
                  No {PHASE_FILTER_LABELS[phaseFilter].toLowerCase()} rows in the current scope.
                </td>
              </tr>
            )}
          </tbody>
        </QaTable>
      </QaSection>
    </QaPageShell>
  );
}
