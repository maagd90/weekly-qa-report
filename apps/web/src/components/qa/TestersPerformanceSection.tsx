import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA, fmt, initials, passRateColor } from '../../theme/qaTheme';
import { QaSection } from '../layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from './QaKpiCard';
import { SegBar, testerSegSegments } from './SegBar';
import { QaTable, QaThead } from './QaBadge';

const LEGEND = [
  { label: 'Pass', color: QA.PASS },
  { label: 'Blocked', color: QA.BLOCKED },
  { label: 'Fail', color: QA.FAIL },
  { label: 'N/A', color: QA.NA },
];

interface TestersPerformanceSectionProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  embedded?: boolean;
  visibleTesters?: DashboardPayload['testers'];
  searchActive?: boolean;
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

function NotExecutedDetails({ dashboard, neCount }: { dashboard: DashboardPayload; neCount: number }) {
  const cases = dashboard.notExecutedCases || [];
  if (neCount === 0) return null;
  const detailsReconcile = cases.length === neCount;

  return (
    <div className="pt-3.5 text-xs text-qa-muted-light">
      <div className="flex items-start gap-2.5">
        <span className="w-2.5 h-2.5 bg-[#B3AEA3] shrink-0 mt-0.5" />
        <span>
          {fmt(neCount)} case{neCount === 1 ? ' is' : 's are'} marked <strong>Not Executed</strong> in QMetry. A Not Executed case has no completed execution result, so it is included in total test-case scope but excluded from Total Executions, pass rate, and Quality Assurance rankings. Set the correct execution result in QMetry when the case has been run.
        </span>
      </div>
      {cases.length > 0 && (
        <details className="mt-3 border border-qa-border bg-[#faf8f2]">
          <summary className="cursor-pointer px-3 py-2 font-mono-qa text-[10.5px] font-semibold uppercase tracking-wide text-qa-ink">
            {detailsReconcile ? 'Show' : 'Review'} {cases.length} Not Executed test case{cases.length === 1 ? '' : 's'} from cycle details
          </summary>
          {!detailsReconcile && (
            <p className="mx-3 mb-2 mt-0 text-[11px] text-[#8a5a00]">
              QMetry's aggregate summary reports {neCount}, while the available cycle-detail response contains {cases.length}. The rows below are diagnostic candidates and are not presented as a one-to-one reconciliation of the aggregate count.
            </p>
          )}
          <div className="max-h-[360px] overflow-auto border-t border-qa-border bg-white">
            <QaTable>
              <QaThead cols={[{ label: 'Test case', className: 'pl-3' }, { label: 'Test cycle' }, { label: 'Cycle key' }, { label: 'Last updated', className: 'pr-3' }]} />
              <tbody>
                {cases.map((item) => (
                  <tr key={`${item.cycleKey}:${item.caseKey}`} className="border-t border-[#f0ede5]">
                    <td className="py-2 pl-3 font-mono-qa text-[11px]" style={{ color: QA.accent }}>{item.caseKey}</td>
                    <td className="max-w-[360px] px-3 py-2"><div className="whitespace-normal break-words">{item.cycleName}</div></td>
                    <td className="px-3 py-2 font-mono-qa text-[10.5px] text-qa-muted whitespace-nowrap">{item.cycleKey}</td>
                    <td className="py-2 pr-3 font-mono-qa text-[10.5px] text-qa-muted whitespace-nowrap">{item.updatedAt ? item.updatedAt.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </QaTable>
          </div>
        </details>
      )}
      {cases.length === 0 && (
        <p className="ml-5 mt-2 mb-0 text-[11px] text-[#8a5a00]">
          The current QMetry response supplied only an aggregate Not Executed count, so individual case keys are not available in this scope.
        </p>
      )}
    </div>
  );
}

function TesterList({ dashboard, testers, neCount, unattributedCount, showNotExecutedDetails }: { dashboard: DashboardPayload; testers: DashboardPayload['testers']; neCount: number; unattributedCount: number; showNotExecutedDetails: boolean }) {
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
                {t.executed} executed · {t.pass} pass · {t.fail} fail · {t.blocked} blocked · {t.na} N/A
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
      {unattributedCount > 0 && (
        <div className="flex items-start gap-2.5 pt-3.5 text-xs text-[#8a5a00]">
          <span className="w-2.5 h-2.5 bg-[#B9861A] shrink-0 mt-0.5" />
          <span>{fmt(unattributedCount)} executed cases were returned without an <strong>Executed By</strong> value. They are included in total execution metrics but excluded from Quality Assurance rankings.</span>
        </div>
      )}
      {showNotExecutedDetails && <NotExecutedDetails dashboard={dashboard} neCount={neCount} />}
      {!testers.length && (
        <div className="py-6 text-center text-[13px] text-qa-muted-light">
          No named Quality Assurance executions match the current filters. Check the QMetry Executed By data and selected period.
        </div>
      )}
    </div>
  );
}

export function TestersPerformanceSection({ dashboard, kpiStyle, embedded = false, visibleTesters, searchActive = false }: TestersPerformanceSectionProps) {
  const { testers, overview } = dashboard;
  const displayedTesters = visibleTesters ?? testers;

  const stats = useMemo(() => {
    const attributedExec = testers.reduce((a, b) => a + b.executed, 0);
    const totalPass = testers.reduce((a, b) => a + b.pass, 0);
    const wAvg = attributedExec ? Math.round((totalPass / attributedExec) * 100) : 0;
    const unattributedExec = Math.max(overview.executed - attributedExec, 0);
    const topPerf = [...testers].filter((t) => t.executed >= 20).sort((a, b) => b.passPct - a.passPct)[0]
      || testers[0]
      || { passPct: 0, name: '—', executed: 0 };
    return { attributedExec, unattributedExec, wAvg, topPerf };
  }, [testers, overview.executed]);

  const neCount = overview.resultMix.find((r) => r.code === 'NE')?.count ?? 0;
  const list = <TesterList dashboard={dashboard} testers={displayedTesters} neCount={neCount} unattributedCount={stats.unattributedExec} showNotExecutedDetails={!embedded} />;

  return (
    <div className="flex flex-col gap-6">
      <QaKpiGrid cols={5}>
        <QaKpiCard kpiStyle={kpiStyle} label="Named QA Members" value={testers.length}
          sub={stats.topPerf.executed ? `top: ${stats.topPerf.name}` : 'no attributed executions'} color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Total Executions" value={fmt(overview.executed)}
          sub="PASS + FAIL + BLOCKED + N/A" color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="Attributed" value={fmt(stats.attributedExec)}
          sub="with Executed By" color={QA.PASS} />
        <QaKpiCard kpiStyle={kpiStyle} label="Unassigned" value={fmt(stats.unattributedExec)}
          sub="missing Executed By" color={QA.BLOCKED} />
        <QaKpiCard kpiStyle={kpiStyle} label="Avg Pass Rate" value={`${stats.wAvg}%`}
          sub="named QA members only" color={QA.NA} />
      </QaKpiGrid>

      {embedded ? (
        <div className="pdf-section border border-qa-border bg-white">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-qa-border flex-wrap">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">
              Execution by Quality Assurance · {displayedTesters.length}{searchActive ? ` of ${testers.length}` : ''} named QA members
            </div>
            <TesterLegend />
          </div>
          {list}
        </div>
      ) : (
        <QaSection title="Execution by Quality Assurance" subtitle={searchActive ? 'List filtered instantly; KPI cards remain scoped to the full selected period.' : undefined} noPadding headerRight={<TesterLegend />}>
          {list}
        </QaSection>
      )}
    </div>
  );
}
