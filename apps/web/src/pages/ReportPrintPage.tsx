import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReportType } from 'qa-dashboard-batch';
import { batchApi } from '../lib/api';
import { waitForChartPaint } from '../lib/printReadiness';
import type { KpiStyle } from '../theme/qaTheme';
import { ReportPrintContent } from '../components/qa/ReportPrintContent';

const KPI_STYLES: KpiStyle[] = ['editorial', 'framed', 'minimal'];
const REPORT_TYPES: ReportType[] = ['executive', 'full', 'testers', 'cycles'];

function clearPdfSignals() {
  document.documentElement.classList.remove('qa-pdf-ready', 'qa-pdf-error');
}

function markPdfError() {
  clearPdfSignals();
  document.documentElement.classList.add('qa-pdf-error');
}

function markPdfReady() {
  clearPdfSignals();
  document.documentElement.classList.add('qa-pdf-ready');
}

export function ReportPrintPage() {
  const [params] = useSearchParams();
  const startDate = params.get('startDate') ?? '';
  const endDate = params.get('endDate') ?? '';
  const kpiParam = params.get('kpiStyle') ?? 'editorial';
  const typeParam = params.get('reportType') ?? 'executive';
  const kpiStyle: KpiStyle = KPI_STYLES.includes(kpiParam as KpiStyle)
    ? (kpiParam as KpiStyle)
    : 'editorial';
  const reportType: ReportType = REPORT_TYPES.includes(typeParam as ReportType)
    ? (typeParam as ReportType)
    : 'executive';

  const dashboardQuery = useQuery({
    queryKey: ['print-dashboard', startDate, endDate],
    queryFn: () => batchApi.getDashboard({ startDate, endDate }),
    enabled: Boolean(startDate && endDate),
    retry: false,
  });

  const reportQuery = useQuery({
    queryKey: ['print-report'],
    queryFn: batchApi.getReport,
    retry: false,
  });

  const dashboard = dashboardQuery.data;
  const dashboardSettled = !dashboardQuery.isLoading && (dashboardQuery.isSuccess || dashboardQuery.isError);
  const reportSettled = reportQuery.isSuccess || reportQuery.isError;

  useEffect(() => {
    if (startDate && endDate) {
      document.title = `QA Report ${startDate} – ${endDate}`;
    }
  }, [startDate, endDate]);

  useEffect(() => {
    clearPdfSignals();

    if (!startDate || !endDate) {
      markPdfError();
      return undefined;
    }

    if (!dashboardSettled || !reportSettled) {
      return undefined;
    }

    if (dashboardQuery.isError || !dashboard) {
      markPdfError();
      return undefined;
    }

    let cancelled = false;
    async function signalReady() {
      if (document.fonts?.ready) await document.fonts.ready;
      await waitForChartPaint(reportType);
      if (!cancelled) markPdfReady();
    }
    signalReady();

    return () => {
      cancelled = true;
      clearPdfSignals();
    };
  }, [
    startDate,
    endDate,
    dashboard,
    dashboardSettled,
    reportSettled,
    dashboardQuery.isError,
    reportType,
  ]);

  if (!startDate || !endDate) {
    return (
      <div className="qa-print-page qa-pdf-error p-8 text-sm text-qa-muted">
        Missing startDate or endDate query parameters.
      </div>
    );
  }

  if (dashboardQuery.isLoading || !reportSettled) {
    return <div className="qa-print-page p-8 text-sm text-qa-muted">Loading report data…</div>;
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <div className="qa-print-page qa-pdf-error p-8 text-sm text-qa-muted">
        No dashboard data for {startDate} → {endDate}. Generate a report first.
      </div>
    );
  }

  return (
    <ReportPrintContent
      dashboard={dashboard}
      kpiStyle={kpiStyle}
      reportType={reportType}
      narrative={reportQuery.data?.markdown ?? ''}
      startDate={startDate}
      endDate={endDate}
    />
  );
}
