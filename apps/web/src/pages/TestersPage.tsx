import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QaPageShell } from '../components/layout/QaPageShell';
import { TestersPerformanceSection } from '../components/qa/TestersPerformanceSection';

interface TestersPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
}

export function TestersPage({ dashboard, kpiStyle }: TestersPageProps) {
  const { testers } = dashboard;

  return (
    <QaPageShell
      title="Quality Assurance Performance"
      subtitle={`by Executed By · ${testers.length} named Quality Assurance member${testers.length === 1 ? '' : 's'}`}
      intro="Set this tab's date range, search text, and result filter, then click Search. Quality Assurance rankings use QMetry Executed By values returned for the selected period."
    >
      <TestersPerformanceSection dashboard={dashboard} kpiStyle={kpiStyle} />
    </QaPageShell>
  );
}
