import React from 'react';
import type { DashboardPayload, ReportType } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA, fmt, initials, passRateColor } from '../../theme/qaTheme';
import { QaKpiCard, QaKpiGrid } from './QaKpiCard';
import { ResultDonut } from './ResultDonut';
import { StackedMonthChart } from './StackedMonthChart';
import { HorizBar, SegBar, testerSegSegments } from './SegBar';
import { AiReportUatSection } from './AiReportUatSection';
import { TestersPerformanceSection } from './TestersPerformanceSection';

interface AiReportChartsProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  reportType: ReportType;
}

function isDefectReport(reportType: ReportType): boolean {
  return reportType === 'defects' || reportType === 'testers';
}

export function AiReportCharts({ dashboard, kpiStyle, reportType }: AiReportChartsProps) {
  const { overview, testers, cycles, storyBug, defectBacklog, uat } = dashboard;
  const sbTot = storyBug.story + storyBug.bug || 1;
  const defectReport = isDefectReport(reportType);
  const showOverview = reportType === 'full' || reportType === 'executive';
  const showTestersCompact = reportType === 'full';
  const showTestersFull = false;
  const showCycles = reportType === 'full' || reportType === 'cycles';
  const showDefects = reportType === 'full' || defectReport;
  const showUat = reportType === 'full' || reportType === 'executive' || defectReport;
  const topTesters = [...testers].sort((a, b) => b.executed - a.executed).slice(0, 6);
  const atRiskCycles = dashboard.cyclesByPassPctAsc.slice(0, 5);

  if (showTestersFull) {
    return (
      <TestersPerformanceSection dashboard={dashboard} kpiStyle={kpiStyle} embedded />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {showOverview && (
        <div className="pdf-section flex flex-col gap-5">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
        </div>
      )}

      {showTestersCompact && topTesters.length > 0 && (
        <div className="pdf-section border border-qa-border p-5 bg-white">
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
        <div className="pdf-section border border-qa-border p-5 bg-white">
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

      {showDefects && storyBug.story + storyBug.bug > 0 && (
        <div className="pdf-section grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="border border-qa-border p-5 bg-white">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Story vs Bug Split</div>
            {[
              { label: 'Story / Enhancement', color: QA.accent, count: storyBug.story, open: storyBug.storyOpen },
              { label: 'Bug / Defect', color: QA.FAIL, count: storyBug.bug, open: storyBug.bugOpen },
            ].map((r) => (
              <div key={r.label} className="mb-3 last:mb-0">
                <div className="flex justify-between text-[12.5px] mb-1">
                  <span className="font-semibold">{r.label}</span>
                  <span className="font-mono-qa text-qa-muted">{fmt(r.count)} · {r.open} open in period</span>
                </div>
                <HorizBar pct={(r.count / sbTot) * 100} color={r.color} />
              </div>
            ))}
          </div>
          <div className="border border-qa-border p-5 bg-[#faf8f2]">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-3">Defects Active in Period</div>
            <div className="font-spectral text-[28px] font-bold mb-2">{defectBacklog.openTotal}</div>
            <div className="text-[12px] text-qa-muted mb-3">open bugs active in period</div>
            {defectBacklog.byPriority.slice(0, 4).map((p) => (
              <div key={p.priority} className="flex justify-between py-1 text-[12px] border-t border-[#efece4] first:border-t-0">
                <span>{p.priority}</span>
                <span className="font-mono-qa">{p.open} open in period</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showUat && uat && uat.total > 0 && (
        <AiReportUatSection uat={uat} />
      )}

      {showUat && !uat?.total && (
        <div className="pdf-section border border-qa-border p-5 bg-[#faf8f2] text-[13px] text-qa-muted">
          No UAT issues in the selected date range. Widen the date range or check that an ODL UAT export is staged under Import Data.
        </div>
      )}
    </div>
  );
}
