import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA, fmt, initials, passRateColor } from '../../theme/qaTheme';
import { QaSection } from '../layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from './QaKpiCard';
import { SegBar, testerSegSegments } from './SegBar';

const LEGEND = [
  { label: 'Pass', color: QA.PASS },
  { label: 'Blocked', color: QA.BLOCKED },
  { label: 'Fail', color: QA.FAIL },
  { label: 'N/A', color: QA.NA },
];

interface TestersPerformanceSectionProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  /** When true, use a flat bordered card (AI report) instead of QaSection */
  embedded?: boolean;
}

function TesterLegend() {
  return (
    <div className="flex gap-4 flex-wrap">
      {LEGEND.map((l) => (
        <span key={l.label} className="flex items-center gap-1 text-[10.5px] text-qa-muted">
          <span className="w-2.5 h-2.5" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

function TesterList({
  testers,
  neCount,
}: {
  testers: DashboardPayload['testers'];
  neCount: number;
}) {
  return (
    <div className="px-[22px] pb-[18px] pt-2">
      {testers.map((t) => (
        <div key={t.name} className="py-4 border-b border-[#f0ede5] last:border-b-0">
          <div className="flex items-center gap-3.5 mb-2">
            <div className="w-[34px] h-[34px] rounded-full bg-qa-ink text-[#F5F3ED] flex items-center justify-center font-spectral font-semibold text-[13px] shrink-0">
              {initials(t.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="font-mono-qa text-[10.5px] text-qa-muted-light">
                {t.executed} executed · {t.pass} pass · {t.fail} fail · {t.blocked} blocked
              </div>
            </div>
            <div className="text-right">
              <div className="font-spectral font-bold text-[22px] leading-none" style={{ color: passRateColor(t.passPct) }}>
                {t.passPct}%
              </div>
              <div className="font-mono-qa text-[9.5px] text-qa-muted-light uppercase tracking-wide">pass rate</div>
            </div>
          </div>
          <SegBar segments={testerSegSegments(t.pass, t.fail, t.blocked, t.na, t.executed)} />
        </div>
      ))}
      {neCount > 0 && (
        <div className="flex items-center gap-2.5 pt-3.5 text-xs text-qa-muted-light">
          <span className="w-2.5 h-2.5 bg-[#B3AEA3] shrink-0" />
          <span>{fmt(neCount)} cases Not Executed are excluded from tester totals above.</span>
        </div>
      )}
      {!testers.length && (
        <div className="py-6 text-center text-[13px] text-qa-muted-light">
          No tester executions match the current filters.
        </div>
      )}
    </div>
  );
}

export function TestersPerformanceSection({ dashboard, kpiStyle, embedded = false }: TestersPerformanceSectionProps) {
  const { testers, overview } = dashboard;

  const stats = useMemo(() => {
    const totalExec = testers.reduce((a, b) => a + b.executed, 0) || 1;
    const wAvg = Math.round((testers.reduce((a, b) => a + b.pass, 0) / totalExec) * 100);
    const topPerf = [...testers].filter((t) => t.executed >= 20).sort((a, b) => b.passPct - a.passPct)[0]
      || testers[0]
      || { passPct: 0, name: '—', executed: 0 };
    return { wAvg, topPerf };
  }, [testers]);

  const neCount = overview.resultMix.find((r) => r.code === 'NE')?.count ?? 0;

  const list = <TesterList testers={testers} neCount={neCount} />;

  return (
    <div className="flex flex-col gap-6">
      <QaKpiGrid cols={4}>
        <QaKpiCard kpiStyle={kpiStyle} label="Testers" value={testers.length}
          sub="contributing executions" color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Executions Logged" value={fmt(overview.executed)}
          sub="across all cycles" color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="Avg Pass Rate" value={`${stats.wAvg}%`}
          sub="weighted by volume" color={QA.BLOCKED} />
        <QaKpiCard kpiStyle={kpiStyle} label="Top Performer" value={`${stats.topPerf.passPct}%`}
          sub={`${stats.topPerf.name.split(' ')[0]} · ${stats.topPerf.executed} exec`} color={QA.NA} />
      </QaKpiGrid>

      {embedded ? (
        <div className="pdf-section border border-qa-border bg-white">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-qa-border flex-wrap">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">
              Execution by Tester · {testers.length} testers
            </div>
            <TesterLegend />
          </div>
          {list}
        </div>
      ) : (
        <QaSection title="Execution by Tester" noPadding headerRight={<TesterLegend />}>
          {list}
        </QaSection>
      )}
    </div>
  );
}
