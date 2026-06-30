import React from 'react';
import type { DashboardPayload, ReportType } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA, fmt, initials, passRateColor } from '../../theme/qaTheme';
import { QaKpiCard, QaKpiGrid } from './QaKpiCard';
import { ResultDonut } from './ResultDonut';
import { StackedMonthChart } from './StackedMonthChart';
import { HorizBar, SegBar, testerSegSegments } from './SegBar';

interface AiReportChartsProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  reportType: ReportType;
}

export function AiReportCharts({ dashboard, kpiStyle, reportType }: AiReportChartsProps) {
  const { overview, testers, cycles, storyBug, defectBacklog, uat } = dashboard;
  const sbTot = storyBug.story + storyBug.bug || 1;
  const showOverview = reportType === 'full' || reportType === 'executive';
  const showTesters = reportType === 'full' || reportType === 'testers';
  const showCycles = reportType === 'full' || reportType === 'cycles';
  const showTrace = reportType === 'full';
  const topTesters = [...testers].sort((a, b) => b.executed - a.executed).slice(0, 6);
  const atRiskCycles = dashboard.cyclesByPassPctAsc.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {showOverview && (
        <>
          <QaKpiGrid cols={5}>
            <QaKpiCard kpiStyle={kpiStyle} label="Total Test Cases" value={fmt(overview.totalCases)}
              sub={`${cycles.length} cycles in scope`} color={QA.accent} />
            <QaKpiCard kpiStyle={kpiStyle} label="Executed" value={fmt(overview.executed)}
              sub={`${overview.executed && overview.totalCases ? Math.round((overview.executed / overview.totalCases) * 100) : 0}% coverage`} color={QA.PASS} />
            <QaKpiCard kpiStyle={kpiStyle} label="Pass Rate" value={`${overview.passRate}%`}
              sub="of executed cases" color="#2F7D5A" />
            <QaKpiCard kpiStyle={kpiStyle} label="Failed" value={overview.failed}
              sub={overview.executed ? `${Math.round((overview.failed / overview.executed) * 100)}% of executed` : '—'} color={QA.FAIL} />
            <QaKpiCard kpiStyle={kpiStyle} label="Blocked" value={overview.blocked}
              sub="need unblocking" color={QA.BLOCKED} />
          </QaKpiGrid>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pdf-avoid-break">
            <div className="border border-qa-border p-5 bg-[#faf8f2] min-w-0">
              <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Execution Result Mix</div>
              <ResultDonut
                items={overview.resultMix.map((r) => ({ code: r.code, label: r.label, count: r.count, pct: r.pct }))}
                total={overview.totalCases}
              />
            </div>
            <div className="border border-qa-border p-5 bg-white min-w-0">
              <StackedMonthChart data={overview.byMonth} />
            </div>
          </div>
        </>
      )}

      {showTesters && topTesters.length > 0 && (
        <div className="border border-qa-border p-5 bg-white pdf-avoid-break">
          <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Top Testers by Volume</div>
          <div className="flex flex-col gap-3">
            {topTesters.map((t) => (
              <div key={t.name}>
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-qa-ink text-[#F5F3ED] flex items-center justify-center font-spectral text-[11px] shrink-0">
                    {initials(t.name)}
                  </div>
                  <div className="flex-1 min-w-0 text-[13px] font-semibold truncate">{t.name}</div>
                  <div className="font-spectral font-bold text-lg" style={{ color: passRateColor(t.passPct) }}>{t.passPct}%</div>
                </div>
                <SegBar segments={testerSegSegments(t.pass, t.fail, t.blocked, t.na, t.executed)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showCycles && atRiskCycles.length > 0 && (
        <div className="border border-qa-border p-5 bg-white">
          <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Cycle Health (lowest pass rate first)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="border-b border-qa-border text-left font-mono-qa text-[10px] uppercase text-qa-muted-light">
                  <th className="py-2 pr-3">Cycle</th>
                  <th className="py-2 pr-3">Cases</th>
                  <th className="py-2 pr-3">Pass %</th>
                  <th className="py-2">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {atRiskCycles.map((c) => (
                  <tr key={c.key} className="border-b border-[#f3f0e8] last:border-b-0">
                    <td className="py-2 pr-3 font-semibold">{c.name}</td>
                    <td className="py-2 pr-3 font-mono-qa">{fmt(c.total)}</td>
                    <td className="py-2 pr-3 font-mono-qa" style={{ color: passRateColor(c.passPct) }}>{c.passPct}%</td>
                    <td className="py-2 font-mono-qa">{c.coverage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showTrace && storyBug.story + storyBug.bug > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="border border-qa-border p-5 bg-white">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Story vs Bug Split</div>
            {[
              { label: 'Story / Enhancement', color: QA.accent, count: storyBug.story, open: storyBug.storyOpen },
              { label: 'Bug / Defect', color: QA.FAIL, count: storyBug.bug, open: storyBug.bugOpen },
            ].map((r) => (
              <div key={r.label} className="mb-3 last:mb-0">
                <div className="flex justify-between text-[12.5px] mb-1">
                  <span className="font-semibold">{r.label}</span>
                  <span className="font-mono-qa text-qa-muted">{fmt(r.count)} · {r.open} open</span>
                </div>
                <HorizBar pct={(r.count / sbTot) * 100} color={r.color} />
              </div>
            ))}
          </div>
          <div className="border border-qa-border p-5 bg-[#faf8f2]">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Defect Backlog</div>
            <div className="font-spectral text-[28px] font-bold mb-2">{defectBacklog.openTotal}</div>
            <div className="text-[12px] text-qa-muted mb-3">open bugs in scope</div>
            {defectBacklog.byPriority.slice(0, 4).map((p) => (
              <div key={p.priority} className="flex justify-between py-1 text-[12px] border-t border-[#efece4] first:border-t-0">
                <span>{p.priority}</span>
                <span className="font-mono-qa">{p.open} open</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showOverview && uat && uat.total > 0 && (
        <div className="border border-qa-border p-5 bg-white">
          <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">UAT Summary</div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="font-spectral text-2xl font-bold">{fmt(uat.total)}</div>
              <div className="text-[11px] text-qa-muted">Total</div>
            </div>
            <div>
              <div className="font-spectral text-2xl font-bold" style={{ color: QA.PASS }}>{fmt(uat.closed)}</div>
              <div className="text-[11px] text-qa-muted">Closed</div>
            </div>
            <div>
              <div className="font-spectral text-2xl font-bold" style={{ color: QA.FAIL }}>{fmt(uat.open)}</div>
              <div className="text-[11px] text-qa-muted">Open</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
