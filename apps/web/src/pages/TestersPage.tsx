import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QaPageShell } from '../components/layout/QaPageShell';
import { TestersPerformanceSection } from '../components/qa/TestersPerformanceSection';

interface TestersPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  searchQuery: string;
}

export function TestersPage({ dashboard, kpiStyle, searchQuery }: TestersPageProps) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleTesters = useMemo(() => {
    if (!normalizedSearch) return dashboard.testers;
    const searchByTester = new Map((dashboard.qualityAssuranceSearch || []).map((item) => [item.tester, item.searchText.toLowerCase()]));
    return dashboard.testers.filter((tester) =>
      tester.name.toLowerCase().includes(normalizedSearch)
      || searchByTester.get(tester.name)?.includes(normalizedSearch));
  }, [dashboard.qualityAssuranceSearch, dashboard.testers, normalizedSearch]);

  return (
    <QaPageShell
      title="Quality Assurance Performance"
      subtitle={`by Executed By · ${visibleTesters.length}${normalizedSearch ? ` of ${dashboard.testers.length}` : ''} named Quality Assurance member${visibleTesters.length === 1 ? '' : 's'}`}
      intro="Search updates this page instantly by Quality Assurance name, test cycle, or case key. Apply dates only when you change the reporting period. Rankings use QMetry Executed By values returned for that period."
    >
      <TestersPerformanceSection dashboard={dashboard} kpiStyle={kpiStyle} visibleTesters={visibleTesters} searchActive={Boolean(normalizedSearch)} />
    </QaPageShell>
  );
}
