import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { batchApi } from '../lib/api';
import type { KpiStyle } from '../theme/qaTheme';
import { AiReportOnePager } from '../components/qa/AiReportOnePager';

const KPI_STYLES: KpiStyle[] = ['editorial', 'framed', 'minimal'];

export function ReportPrintPage() {
  const [params] = useSearchParams();
  const startDate = params.get('startDate') ?? '';
  const endDate = params.get('endDate') ?? '';
  const kpiParam = params.get('kpiStyle') ?? 'editorial';
  const kpiStyle: KpiStyle = KPI_STYLES.includes(kpiParam as KpiStyle)
    ? (kpiParam as KpiStyle)
    : 'editorial';

  const { data: dashboard, isLoading: loadingDashboard, isError: dashboardError } = useQuery({
    queryKey: ['print-dashboard', startDate, endDate],
    queryFn: () => batchApi.getDashboard({ startDate, endDate }),
    enabled: Boolean(startDate && endDate),
    retry: false,
  });

  const { data: reportData, isFetched: reportFetched } = useQuery({
    queryKey: ['print-report'],
    queryFn: batchApi.getReport,
    retry: false,
  });

  useEffect(() => {
    if (startDate && endDate) {
      document.title = `QA Report ${startDate} – ${endDate}`;
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (!dashboard || !startDate || !endDate || !reportFetched) return;

    let cancelled = false;
    async function markReady() {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!cancelled) document.documentElement.classList.add('qa-pdf-ready');
    }
    markReady();
    return () => {
      cancelled = true;
      document.documentElement.classList.remove('qa-pdf-ready');
    };
  }, [dashboard, startDate, endDate, reportFetched]);

  if (!startDate || !endDate) {
    return (
      <div className="qa-print-page p-8 text-sm text-qa-muted">
        Missing startDate or endDate query parameters.
      </div>
    );
  }

  if (loadingDashboard) {
    return <div className="qa-print-page p-8 text-sm text-qa-muted">Loading report data…</div>;
  }

  if (dashboardError || !dashboard) {
    return (
      <div className="qa-print-page p-8 text-sm text-qa-muted">
        No dashboard data for {startDate} → {endDate}. Generate a report first.
      </div>
    );
  }

  return (
    <div className="qa-print-page bg-white">
      <AiReportOnePager
        dashboard={dashboard}
        kpiStyle={kpiStyle}
        narrative={reportData?.markdown ?? ''}
        startDate={startDate}
        endDate={endDate}
        compactNarrative
      />
    </div>
  );
}
