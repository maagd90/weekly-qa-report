import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { HorizBar } from '../components/qa/SegBar';
import { PriorityDonut } from '../components/qa/ResultDonut';
import { QaTable, QaThead } from '../components/qa/QaBadge';
import { PRIORITY_COLORS } from '../theme/qaTheme';

interface UatPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
}

function barWidth(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max((count / max) * 100, 3);
}

export function UatPage({ dashboard, kpiStyle }: UatPageProps) {
  const uat = dashboard.uat;
  if (!uat) {
    return (
      <QaPageShell title="UAT Issue Log">
        <div className="py-8 text-center text-qa-muted-light">No UAT data loaded</div>
      </QaPageShell>
    );
  }

  const statusMax = Math.max(1, ...uat.byStatus.map((s) => s.count));
  const areaMax = Math.max(1, ...uat.byArea.map((a) => a.count));
  const submitterMax = Math.max(1, ...uat.bySubmitter.map((s) => s.count));

  const priorityItems = useMemo(() =>
    uat.byPriority.map((p) => ({
      label: p.priority,
      count: p.count,
      color: PRIORITY_COLORS[p.priority] || QA.muted,
    })),
  [uat.byPriority]);

  return (
    <QaPageShell
      title="UAT Issue Log"
      subtitle={`${fmt(uat.total)} issues · ${uat.open} open`}
      intro="Defects raised during UAT on Travel Studio V2 — auto-detected from the Issue-Log export (TicketID / Status / Priority / Product Area). Filterable by submitted date and search like every other tab."
    >
      <QaKpiGrid cols={4}>
        <QaKpiCard kpiStyle={kpiStyle} label="Total UAT Issues" value={fmt(uat.total)}
          sub="in current scope" color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Open" value={uat.open}
          sub="awaiting resolution" color={QA.BLOCKED} />
        <QaKpiCard kpiStyle={kpiStyle} label="Closed" value={uat.closed}
          sub={`${uat.closureRate}% closure rate`} color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="Urgent Open" value={uat.urgentOpen}
          sub="priority = Urgent" color={QA.FAIL} />
      </QaKpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-[22px] mb-[22px]">
        <QaSection title="Issues by Status" subtitle="Closed vs in-flight UAT defects">
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

      <QaSection title="UAT Defects" noPadding>
        <QaTable>
          <QaThead cols={[
            { label: 'Ticket', className: 'pl-[22px]' },
            { label: 'Subject' },
            { label: 'Area' },
            { label: 'Priority' },
            { label: 'Status' },
            { label: 'By' },
            { label: 'Submitted', align: 'right', className: 'pr-[22px]' },
          ]} />
          <tbody>
            {uat.rows.map((r) => (
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
                <td className="py-2.5 px-3 text-qa-muted whitespace-nowrap">{r.submitter}</td>
                <td className="py-2.5 pr-[22px] text-right font-mono-qa text-[11.5px] text-qa-muted whitespace-nowrap">
                  {r.submittedAt ? r.submittedAt.slice(0, 10) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </QaTable>
      </QaSection>
    </QaPageShell>
  );
}
