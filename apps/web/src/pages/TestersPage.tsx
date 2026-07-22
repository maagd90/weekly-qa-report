import React, { useMemo, useState } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QaPageShell } from '../components/layout/QaPageShell';
import { TestersPerformanceSection } from '../components/qa/TestersPerformanceSection';
import { QaSection } from '../components/layout/QaPageShell';
import { QaTable, QaThead } from '../components/qa/QaBadge';
import { projectDisplayName } from '../lib/projectDisplay';

interface TestersPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

export function TestersPage({ dashboard, kpiStyle, searchQuery }: TestersPageProps) {
  const [portfolioView, setPortfolioView] = useState<'overall' | 'project'>('overall');
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleTesters = useMemo(() => {
    if (!normalizedSearch) return dashboard.testers;
    const searchByTester = new Map((dashboard.qualityAssuranceSearch || []).map((item) => [item.tester, item.searchText.toLowerCase()]));
    return dashboard.testers.filter((tester) =>
      tester.name.toLowerCase().includes(normalizedSearch)
      || searchByTester.get(tester.name)?.includes(normalizedSearch));
  }, [dashboard.qualityAssuranceSearch, dashboard.testers, normalizedSearch]);
  const projectRows = useMemo(() => (dashboard.scope.project === 'all' ? (dashboard.byProject || []) : []).flatMap((slice) => {
    const searchByTester = new Map((slice.qualityAssuranceSearch || []).map((item) => [item.tester, item.searchText.toLowerCase()]));
    return slice.testers
      .filter((tester) => !normalizedSearch || tester.name.toLowerCase().includes(normalizedSearch) || searchByTester.get(tester.name)?.includes(normalizedSearch))
      .map((tester) => ({ project: slice.project, ...tester }));
  }), [dashboard.byProject, dashboard.scope.project, normalizedSearch]);
  const isPortfolio = dashboard.scope.project === 'all' && Boolean(dashboard.byProject?.length);

  return (
    <QaPageShell
      title="Quality Assurance Performance"
      subtitle={`by Executed By · ${visibleTesters.length}${normalizedSearch ? ` of ${dashboard.testers.length}` : ''} named Quality Assurance member${visibleTesters.length === 1 ? '' : 's'}`}
      intro="Search updates this page instantly by Quality Assurance name, test cycle, or case key. Apply dates only when you change the reporting period. Rankings use QMetry Executed By values returned for that period."
    >
      {isPortfolio && <div className="mb-4 flex gap-2" role="tablist" aria-label="Quality Assurance portfolio view"><button type="button" role="tab" aria-selected={portfolioView === 'overall'} onClick={() => setPortfolioView('overall')} className={`border px-3 py-2 font-mono-qa text-[10px] uppercase ${portfolioView === 'overall' ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white'}`}>Overall</button><button type="button" role="tab" aria-selected={portfolioView === 'project'} onClick={() => setPortfolioView('project')} className={`border px-3 py-2 font-mono-qa text-[10px] uppercase ${portfolioView === 'project' ? 'border-qa-ink bg-qa-ink text-white' : 'border-qa-border bg-white'}`}>By Project</button></div>}
      {(!isPortfolio || portfolioView === 'overall') && <TestersPerformanceSection dashboard={dashboard} kpiStyle={kpiStyle} visibleTesters={visibleTesters} searchActive={Boolean(normalizedSearch)} />}
      {isPortfolio && portfolioView === 'project' && <QaSection title="Quality Assurance Performance by Project" subtitle={`${projectRows.length} project-member contributions`} noPadding><QaTable><QaThead cols={[{ label: 'Project', className: 'pl-[22px]' }, { label: 'Quality Assurance' }, { label: 'Executed', align: 'right' }, { label: 'Passed', align: 'right' }, { label: 'Failed', align: 'right' }, { label: 'Blocked', align: 'right' }, { label: 'Pass %', align: 'right', className: 'pr-[22px]' }]} /><tbody>{projectRows.map((row) => <tr key={`${row.project}:${row.name}`} className="border-t border-[#f0ede5]"><td className="py-3 pl-[22px] font-semibold">{projectDisplayName(row.project)}</td><td className="py-3 px-3">{row.name}</td><td className="py-3 px-3 text-right font-mono-qa">{row.executed}</td><td className="py-3 px-3 text-right font-mono-qa text-[#2f6a48]">{row.pass}</td><td className="py-3 px-3 text-right font-mono-qa text-[#a13d2c]">{row.fail}</td><td className="py-3 px-3 text-right font-mono-qa text-[#9a6a12]">{row.blocked}</td><td className="py-3 pr-[22px] text-right font-mono-qa">{row.passPct}%</td></tr>)}</tbody></QaTable>{!projectRows.length && <div className="py-8 text-center text-[13px] text-qa-muted-light">No Quality Assurance activity matches the current filters.</div>}</QaSection>}
    </QaPageShell>
  );
}
