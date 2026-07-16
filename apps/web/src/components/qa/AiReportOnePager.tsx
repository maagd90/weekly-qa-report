import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA, fmt, initials, passRateColor } from '../../theme/qaTheme';
import { QaKpiCard, QaKpiGrid } from './QaKpiCard';
import { ResultDonut } from './ResultDonut';
import { SegBar, testerSegSegments } from './SegBar';
import { summaryBodyOnly, trimSummaryForPrint } from '../../lib/reportSummary';

interface AiReportOnePagerProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  narrative: string;
  startDate: string;
  endDate: string;
  compactNarrative?: boolean;
}

function topUatCrs(uat: NonNullable<DashboardPayload['uat']>) {
  const grouped = new Map<string, { cr: string; total: number; open: number }>();
  for (const row of uat.rows) {
    const cr = row.cr || 'Unassigned';
    const current = grouped.get(cr) || { cr, total: 0, open: 0 };
    current.total += 1;
    if (!/closed|done|resolved|cancel/i.test(row.status)) current.open += 1;
    grouped.set(cr, current);
  }
  return [...grouped.values()].sort((a, b) => b.open - a.open || b.total - a.total).slice(0, 3);
}

export function AiReportOnePager({
  dashboard,
  kpiStyle,
  narrative,
  startDate,
  endDate,
  compactNarrative = false,
}: AiReportOnePagerProps) {
  const { overview, testers, uat } = dashboard;
  const topTesters = [...testers].sort((a, b) => b.executed - a.executed).slice(0, 3);
  const topCrs = uat ? topUatCrs(uat) : [];
  const projectLabel = dashboard.scope.project && dashboard.scope.project !== 'all' ? dashboard.scope.project : 'All Projects';
  const displayNarrative = compactNarrative ? trimSummaryForPrint(narrative) : summaryBodyOnly(narrative);

  return (
    <div className="qa-one-page-report pdf-section bg-white">
      <div className="px-5 pt-5 pb-3 border-b-2 border-qa-ink">
        <div className="font-mono-qa text-[9px] tracking-widest uppercase mb-1.5" style={{ color: QA.accent }}>
          Weekly QA · One-Page Summary
        </div>
        <h1 className="font-spectral font-extrabold text-[22px] leading-tight tracking-tight m-0 mb-1.5">
          QA Report
        </h1>
        <div className="font-mono-qa text-[9.5px] text-qa-muted-light uppercase tracking-wide">
          {startDate} → {endDate} · {projectLabel}
        </div>
      </div>

      <div className="px-5 py-3 border-b border-qa-border">
        <QaKpiGrid cols={5}>
          <QaKpiCard kpiStyle={kpiStyle} label="Test Cases" value={fmt(overview.totalCases)} color={QA.accent} />
          <QaKpiCard kpiStyle={kpiStyle} label="Executed" value={fmt(overview.executed)} color={QA.PASS} />
          <QaKpiCard kpiStyle={kpiStyle} label="Pass Rate" value={`${overview.passRate}%`} color="#2F7D5A" />
          <QaKpiCard kpiStyle={kpiStyle} label="Failed" value={overview.failed} color={QA.FAIL} />
          <QaKpiCard kpiStyle={kpiStyle} label="Blocked" value={overview.blocked} color={QA.BLOCKED} />
        </QaKpiGrid>
      </div>

      <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-qa-border">
        <div className="border border-qa-border p-3 bg-[#faf8f2] min-w-0">
          <div className="font-mono-qa text-[9px] tracking-wider uppercase text-qa-muted-light mb-2">Result Mix</div>
          <ResultDonut
            items={overview.resultMix.map((r) => ({ code: r.code, label: r.label, count: r.count, pct: r.pct }))}
            total={overview.totalCases}
          />
        </div>

        <div className="border border-qa-border p-3 bg-white min-w-0">
          <div className="font-mono-qa text-[9px] tracking-wider uppercase text-qa-muted-light mb-2">Vendor Portal Bugs</div>
          {uat && uat.total > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <div className="font-spectral font-bold text-xl">{uat.total}</div>
                  <div className="text-[10px] text-qa-muted">Reported</div>
                </div>
                <div>
                  <div className="font-spectral font-bold text-xl" style={{ color: QA.FAIL }}>{uat.open}</div>
                  <div className="text-[10px] text-qa-muted">Open</div>
                </div>
                <div>
                  <div className="font-spectral font-bold text-xl" style={{ color: QA.PASS }}>{uat.closed}</div>
                  <div className="text-[10px] text-qa-muted">Closed</div>
                </div>
                <div>
                  <div className="font-spectral font-bold text-xl" style={{ color: QA.BLOCKED }}>{uat.urgentOpen}</div>
                  <div className="text-[10px] text-qa-muted">Urgent open</div>
                </div>
              </div>
              {topCrs.length > 0 && (
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="border-b border-qa-border text-qa-muted-light">
                      <th className="text-left py-0.5 font-normal">CR</th>
                      <th className="text-right py-0.5 font-normal">Tot</th>
                      <th className="text-right py-0.5 font-normal">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCrs.map((cr) => (
                      <tr key={cr.cr} className="border-b border-[#f3f0e8]">
                        <td className="py-0.5 truncate max-w-[80px]">{cr.cr}</td>
                        <td className="text-right py-0.5">{cr.total}</td>
                        <td className="text-right py-0.5">{cr.open}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="text-[11px] text-qa-muted m-0">No Vendor Portal bugs in this period.</p>
          )}
        </div>
      </div>

      {topTesters.length > 0 && (
        <div className="px-5 py-3 border-b border-qa-border">
          <div className="font-mono-qa text-[9px] tracking-wider uppercase text-qa-muted-light mb-2">Top Quality Assurance Members</div>
          <div className="flex flex-col gap-2">
            {topTesters.map((t) => (
              <div key={t.name} className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-qa-ink text-[#F5F3ED] flex items-center justify-center font-spectral text-[9px] shrink-0">
                  {initials(t.name)}
                </div>
                <div className="flex-1 min-w-0 text-[11px] font-semibold truncate">{t.name}</div>
                <div className="font-spectral font-bold text-sm shrink-0" style={{ color: passRateColor(t.passPct) }}>
                  {t.passPct}%
                </div>
                <div className="w-[100px] shrink-0">
                  <SegBar segments={testerSegSegments(t.pass, t.fail, t.blocked, t.na, t.executed)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayNarrative && (
        <div className="px-5 py-3">
          <div className="font-mono-qa text-[9px] tracking-wider uppercase text-qa-muted-light mb-2">Executive Summary</div>
          <div className="prose prose-slate prose-sm max-w-none qa-report-summary-prose qa-one-page-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayNarrative}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
