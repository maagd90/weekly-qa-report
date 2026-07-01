import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardPayload, ReportType } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { QA } from '../../theme/qaTheme';
import { AiReportCharts } from './AiReportCharts';

interface ReportPrintContentProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  reportType: ReportType;
  narrative: string;
  startDate: string;
  endDate: string;
}

function ReportPrintHeader({
  reportType,
  startDate,
  endDate,
}: {
  reportType: ReportType;
  startDate: string;
  endDate: string;
}) {
  const label = reportType.charAt(0).toUpperCase() + reportType.slice(1);
  return (
    <div className="px-6 pt-6 pb-5 border-b-2 border-qa-ink">
      <div className="font-mono-qa text-[10px] tracking-widest uppercase mb-2.5" style={{ color: QA.accent }}>
        Weekly QA Report · {label}
      </div>
      <h1 className="font-spectral font-extrabold text-[28px] leading-tight tracking-tight m-0 mb-2.5">
        QA Report
      </h1>
      <div className="font-mono-qa text-[10px] text-qa-muted-light uppercase tracking-wide">
        {startDate} → {endDate} · DLM · Travel Studio
      </div>
    </div>
  );
}

export function ReportPrintContent({
  dashboard,
  kpiStyle,
  reportType,
  narrative,
  startDate,
  endDate,
}: ReportPrintContentProps) {
  return (
    <div className="qa-print-page qa-print-document bg-white">
      <ReportPrintHeader reportType={reportType} startDate={startDate} endDate={endDate} />

      <div className="px-6 py-6 border-b border-qa-border">
        <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-5">
          Metrics & Charts
        </div>
        <AiReportCharts dashboard={dashboard} kpiStyle={kpiStyle} reportType={reportType} />
      </div>

      <div className="px-6 py-6">
        {narrative ? (
          <div className="prose prose-slate max-w-none prose-headings:font-spectral prose-sm">
            <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-4 not-prose">
              AI Summary
            </div>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-[13px] text-qa-muted m-0">No AI summary for this report.</p>
        )}
      </div>
    </div>
  );
}
