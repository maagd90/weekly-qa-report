import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QA, fmt } from '../theme/qaTheme';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QaKpiCard, QaKpiGrid } from '../components/qa/QaKpiCard';
import { ResultDonut } from '../components/qa/ResultDonut';
import { StackedMonthChart } from '../components/qa/StackedMonthChart';
import { HorizBar } from '../components/qa/SegBar';
import { projectDisplayName } from '../lib/projectDisplay';

interface OverviewPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
}

type OverviewSlice = Pick<DashboardPayload, 'overview' | 'storyBug' | 'defectBacklog'>;

function ProjectOverviewBlock({ slice, kpiStyle }: { slice: OverviewSlice; kpiStyle: KpiStyle }) {
  const { overview, storyBug, defectBacklog } = slice;
  const sbTot = storyBug.story + storyBug.bug || 1;

  const flagMsg = storyBug.bugOpen > 0
    ? `${storyBug.bugOpen} open bugs in scope — review defect backlog on Traceability tab.`
    : 'Issue Type column detected and mapped → work_item_type.';
  const flagColor = storyBug.bugOpen > 0 ? QA.FAIL : '#2f6a48';

  return (
    <>
      <QaKpiGrid cols={5}>
        <QaKpiCard kpiStyle={kpiStyle} label="Total Test Cases" value={fmt(overview.totalCases)}
          sub="in current scope" color={QA.accent} />
        <QaKpiCard kpiStyle={kpiStyle} label="Executed" value={fmt(overview.executed)}
          sub={`${overview.executed && overview.totalCases ? Math.round((overview.executed / overview.totalCases) * 100) : 0}% coverage`} color={QA.PASS} />
        <QaKpiCard kpiStyle={kpiStyle} label="Pass Rate" value={`${overview.passRate}%`}
          sub="of executed cases" color="#2F7D5A" />
        <QaKpiCard kpiStyle={kpiStyle} label="Failed" value={overview.failed}
          sub={overview.executed ? `${Math.round((overview.failed / overview.executed) * 100)}% of executed` : '—'} color={QA.FAIL} />
        <QaKpiCard kpiStyle={kpiStyle} label="Blocked" value={overview.blocked}
          sub="need unblocking" color={QA.BLOCKED} />
      </QaKpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-[22px] mb-[22px]">
        <QaSection title="Execution Result Mix" subtitle={`All ${fmt(overview.totalCases)} test cases by latest result`}>
          <ResultDonut
            items={overview.resultMix.map((r) => ({ code: r.code, label: r.label, count: r.count, pct: r.pct }))}
            total={overview.totalCases}
          />
        </QaSection>
        <QaSection>
          <StackedMonthChart data={overview.byMonth} />
        </QaSection>
      </div>

      <QaSection>
        <div className="flex flex-wrap gap-6">
          <div className="max-w-[430px] flex-1 min-w-[240px]">
            <h3 className="font-spectral font-semibold text-base m-0 mb-1">Work-Item Type — Story vs Bug</h3>
            <p className="m-0 mb-3.5 text-[11.5px] text-qa-muted-light">
              Issue Type column · JIRA ({fmt(storyBug.story + storyBug.bug)} issues in scope).
            </p>
            {storyBug.story + storyBug.bug === 0 ? (
              <div className="py-5 text-[12.5px] text-qa-muted-light">No work items match the current filters.</div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {[
                  { label: 'Story / Enhancement', color: QA.accent, count: storyBug.story, done: storyBug.storyDone, open: storyBug.storyOpen, closedLabel: 'done' },
                  { label: 'Bug / Defect', color: QA.FAIL, count: storyBug.bug, done: storyBug.bugDone, open: storyBug.bugOpen, closedLabel: 'closed' },
                ].map((r) => (
                  <div key={r.label}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="flex items-center gap-2 text-[13px] font-semibold">
                        <span className="w-[11px] h-[11px]" style={{ background: r.color }} />
                        {r.label}
                      </span>
                      <span className="font-mono-qa text-xs text-qa-muted">
                        {fmt(r.count)} cases · {r.done} {r.closedLabel} · {r.open} open · {Math.round((r.count / sbTot) * 100)}%
                      </span>
                    </div>
                    <HorizBar pct={(r.count / sbTot) * 100} color={r.color} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[240px] border-l border-[#efece4] pl-6">
            <div className="font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light mb-3.5">Delivery status</div>
            <div className="flex flex-col gap-4">
              {[
                { label: 'Stories', done: storyBug.storyDone, open: storyBug.storyOpen, total: storyBug.story || 1, doneColor: QA.accent, openColor: '#cbb89a' },
                { label: 'Bugs', done: storyBug.bugDone, open: storyBug.bugOpen, total: storyBug.bug || 1, doneColor: QA.FAIL, openColor: '#e0b6ab' },
              ].map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-[12.5px] font-semibold" style={{ color: b.doneColor }}>{b.label}</span>
                    <span className="font-mono-qa text-[11px] text-qa-muted">{b.done} done · {b.open} open</span>
                  </div>
                  <div className="flex h-3.5 bg-qa-track">
                    <div style={{ width: `${(b.done / b.total) * 100}%`, background: b.doneColor, height: '100%' }} />
                    <div style={{ width: `${(b.open / b.total) * 100}%`, background: b.openColor, height: '100%' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-3.5 pt-3 border-t border-[#efece4] text-[10.5px] text-qa-muted">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#15605E]" />Done / Closed</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#cbb89a]" />Open</span>
            </div>
            <div className="flex items-center gap-1.5 mt-3.5 text-[11px]" style={{ color: flagColor }}>
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: flagColor }} />
              <span>{flagMsg}</span>
            </div>
            {defectBacklog.openTotal > 0 && (
              <p className="text-[11px] text-qa-muted mt-2 m-0">{defectBacklog.openTotal} open bugs · {defectBacklog.byPriority.find((p) => p.priority === 'Highest')?.open ?? 0} at Highest priority</p>
            )}
          </div>
        </div>
      </QaSection>
    </>
  );
}

export function OverviewPage({ dashboard, kpiStyle }: OverviewPageProps) {
  const periodNote = dashboard.meta.dataMax
    ? `all cycles · through ${dashboard.meta.dataMax.slice(0, 7)}`
    : 'all cycles';

  const isAllProjects = dashboard.scope.project === 'all';
  const byProject = dashboard.byProject;

  if (isAllProjects && byProject && byProject.length > 1) {
    return (
      <QaPageShell
        title="Execution Overview"
        subtitle={`${periodNote} · ${byProject.length} projects, shown separately`}
      >
        <div className="flex flex-col gap-9">
          {byProject.map((p) => (
            <div key={p.project}>
              <div className="flex items-baseline gap-2.5 mb-3.5 pb-2 border-b-2 border-qa-ink">
                <h3 className="font-spectral font-extrabold text-[20px] m-0 tracking-tight">{projectDisplayName(p.project)}</h3>
                <span className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light">
                  {p.overview.totalCases ? `${fmt(p.overview.totalCases)} test cases` : p.storyBug.bug ? `${fmt(p.storyBug.bug)} defects` : 'no metrics in scope'}
                </span>
              </div>
              <ProjectOverviewBlock slice={p} kpiStyle={kpiStyle} />
            </div>
          ))}
        </div>
      </QaPageShell>
    );
  }

  return (
    <QaPageShell title="Execution Overview" subtitle={periodNote}>
      <ProjectOverviewBlock slice={dashboard} kpiStyle={kpiStyle} />
    </QaPageShell>
  );
}
