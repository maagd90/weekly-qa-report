import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { KpiStyle } from '../theme/qaTheme';
import { QaPageShell } from '../components/layout/QaPageShell';
import { TestersPerformanceSection } from '../components/qa/TestersPerformanceSection';
import { batchApi } from '../lib/api';

interface TestersPageProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  filterParams: FilterParams;
}

export function TestersPage({ dashboard, kpiStyle, filterParams }: TestersPageProps) {
  const [scopedDashboard, setScopedDashboard] = useState<DashboardPayload | null>(null);
  const activeDashboard = scopedDashboard ?? dashboard;
  const { testers } = activeDashboard;

  const applyPeriod = useMutation({
    mutationFn: () => batchApi.getDashboard(filterParams),
    onSuccess: (freshDashboard) => setScopedDashboard(freshDashboard),
  });

  const periodLabel = `${filterParams.startDate || 'any'} → ${filterParams.endDate || 'any'}`;
  const projectLabel = filterParams.project || 'all projects';

  return (
    <QaPageShell
      title="Tester Performance"
      subtitle={`by Executed By · ${testers.length} testers`}
      intro="Date edits do not call JIRA/QMetry. Click Apply period to refilter the cached dataset only."
    >
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono-qa text-[10.5px] text-qa-muted-light">
          Cached scope: {projectLabel} · {periodLabel}
          {applyPeriod.isError && <span className="text-[#a13d2c]"> · {(applyPeriod.error as Error).message}</span>}
        </div>
        <button
          type="button"
          onClick={() => applyPeriod.mutate()}
          disabled={applyPeriod.isPending}
          className="font-mono-qa text-[10.5px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50"
        >
          {applyPeriod.isPending ? 'Applying...' : 'Apply period'}
        </button>
      </div>
      <TestersPerformanceSection dashboard={activeDashboard} kpiStyle={kpiStyle} />
    </QaPageShell>
  );
}
