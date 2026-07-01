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
    <QaPageShell title="Tester Performance" subtitle={`by Executed By · ${testers.length} testers`}>
      <TestersPerformanceSection dashboard={dashboard} kpiStyle={kpiStyle} />
    </QaPageShell>
  );
}
