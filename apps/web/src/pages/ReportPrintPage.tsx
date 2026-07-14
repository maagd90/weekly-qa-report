import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReportType } from 'qa-dashboard-batch';
import { batchApi } from '../lib/api';
import { waitForChartPaint } from '../lib/printReadiness';
import type { KpiStyle } from '../theme/qaTheme';
import { ReportPrintContent } from '../components/qa/ReportPrintContent';

const KPI_STYLES: KpiStyle[] = ['editorial', 'framed', 'minimal'];
const REPORT_TYPES: ReportType[] = ['executive', 'full', 'testers', 'defects', 'cycles'];

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
  const project = params.get('project') || undefined;
  const reportId = params.get('reportId') || '';
  const logoUrl = params.get('logoUrl') || '';
  const logoAlt = params.get('logoAlt') || 'Report logo';
  const reportTitle = params.get('title') || '';
  const reportSubtitle = params.get('subtitle') || '';
  const kpiParam = params.get('kpiStyle') ?? 'editorial';
  const typeParam = params.get('reportType') ?? 'executive';
  const kpiStyle: KpiStyle = KPI_STYLES.includes(kpiParam as KpiStyle)
    ? (kpiParam as KpiStyle)
    : 'editorial';
  const reportType: ReportType = REPORT_TYPES.includes(typeParam as ReportType)
    ? (typeParam as ReportType)
    : 'executive';

  const reportQuery = useQuery({
    queryKey: ['print-report', reportId],
    queryFn: batchApi.getReport,
    retry: false,
  });

  const dashboard = reportQuery.data?.dashboard;
  const reportMeta = reportQuery.data?.meta;
  const reportSettled = reportQuery.isSuccess || reportQuery.isError;
  const actualProject = dashboard?.scope.project && dashboard.scope.project !== 'all' ? dashboard.scope.project : undefined;
  const snapshotMatches = Boolean(
    dashboard
    && dashboard.scope.startDate === startDate
    && dashboard.scope.endDate === endDate
    && actualProject === project
    && reportMeta?.params?.reportType === reportType
    && (!reportId || reportMeta?.generatedAt === reportId),
  );

  useEffect(() => {
    if (startDate && endDate) {
      document.title = `QA Report ${project ? `${project} ` : ''}${startDate} – ${endDate}`;
    }
  }, [startDate, endDate, project]);

  useEffect(() => {
    clearPdfSignals();

    if (!startDate || !endDate) {
      markPdfError();
      return undefined;
    }

    if (!reportSettled) {
      return undefined;
    }

    if (reportQuery.isError || !snapshotMatches) {
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
    project,
    dashboard,
    reportSettled,
    reportQuery.isError,
    snapshotMatches,
    reportType,
  ]);

  if (!startDate || !endDate) {
    return (
      <div className="qa-print-page qa-pdf-error p-8 text-sm text-qa-muted">
        Missing startDate or endDate query parameters.
      </div>
    );
  }

  if (reportQuery.isLoading || !reportSettled) {
    return <div className="qa-print-page p-8 text-sm text-qa-muted">Loading report data…</div>;
  }

  if (reportQuery.isError || !dashboard || !snapshotMatches) {
    return (
      <div className="qa-print-page qa-pdf-error p-8 text-sm text-qa-muted">
        The saved report snapshot does not match {project ? `${project} · ` : ''}{startDate} → {endDate}. Generate the report again.
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
      title={reportTitle}
      subtitle={reportSubtitle}
      logoUrl={logoUrl}
      logoAlt={logoAlt}
    />
  );
}
