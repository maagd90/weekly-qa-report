import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { batchApi, apiErrorMessage, getReportBranding, type GeneratedReportData, type ReportType } from '../lib/api';
import type { KpiStyle } from '../theme/qaTheme';
import { QA } from '../theme/qaTheme';
import { AiReportCharts } from '../components/qa/AiReportCharts';
import { projectDisplayName } from '../lib/projectDisplay';
import { defaultReportingPeriod } from '../lib/reportingPeriod';
import { userFacingWarnings } from '../lib/userFacingWarnings';

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'full', label: 'Full', desc: 'all sections' },
  { value: 'executive', label: 'Executive', desc: 'summary only' },
  { value: 'defects', label: 'Defects', desc: 'defect focus' },
  { value: 'cycles', label: 'Cycles', desc: 'cycle focus' },
  { value: 'testers', label: 'Quality Assurance', desc: 'people performance' },
];

type ReportMeta = { params?: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string } };

interface AiReportPageProps {
  dashboard?: DashboardPayload | null;
  kpiStyle: KpiStyle;
  project: string;
}

function overlapsDataRange(startDate: string, endDate: string, dashboard?: DashboardPayload | null): boolean {
  const dataMin = dashboard?.meta.dataMin;
  const dataMax = dashboard?.meta.dataMax;
  if (!startDate || !endDate) return false;
  if (!dataMin || !dataMax) return true;
  return !(endDate < dataMin || startDate > dataMax);
}

function dashboardRange(dashboard?: DashboardPayload | null): { startDate: string; endDate: string } {
  const fallback = defaultReportingPeriod();
  return {
    startDate: dashboard?.scope.startDate || fallback.startDate,
    endDate: dashboard?.scope.endDate || fallback.endDate,
  };
}

function hasMetrics(dashboard?: DashboardPayload | null): boolean {
  if (!dashboard) return false;
  return Boolean(
    dashboard.overview.totalCases ||
    dashboard.storyBug.story ||
    dashboard.storyBug.bug ||
    dashboard.defectBacklog.openTotal ||
    dashboard.cycles.length ||
    dashboard.testers.length ||
    dashboard.uat?.total
  );
}

function formatSourceNote(note: string): string {
  return note
    .replace('JIRA API date search applied from selected dates.', 'JIRA search used the selected date range.')
    .replace('QMetry testcase execution rows were unavailable for one or more cycles, so cycle-level execution progress was used for report charts.', 'QMetry testcase execution rows were unavailable for one or more cycles, so cycle-level execution progress was used for report charts.');
}

function sourceNotes(warning: string | null): string[] {
  return warning ? warning.split(';').map((item) => formatSourceNote(item.trim())).filter(Boolean) : [];
}

function reportMatchesSelection(
  dashboard: DashboardPayload | null,
  meta: ReportMeta | null,
  selection: { startDate: string; endDate: string; reportType: ReportType; project?: string },
): boolean {
  if (!dashboard) return false;
  const actualProject = dashboard.scope.project && dashboard.scope.project !== 'all' ? dashboard.scope.project : undefined;
  return dashboard.scope.startDate === selection.startDate
    && dashboard.scope.endDate === selection.endDate
    && actualProject === selection.project
    && meta?.params?.reportType === selection.reportType;
}

export function AiReportPage({ dashboard, kpiStyle, project }: AiReportPageProps) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const seededRange = dashboardRange(dashboard);
  const [startDate, setStartDate] = useState(seededRange.startDate);
  const [endDate, setEndDate] = useState(seededRange.endDate);
  const [reportType, setReportType] = useState<ReportType>('executive');
  const [reportProject, setReportProject] = useState(project || 'all');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [reportDashboard, setReportDashboard] = useState<DashboardPayload | null>(null);
  const [reportMeta, setReportMeta] = useState<ReportMeta | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data: reportData } = useQuery({ queryKey: ['report'], queryFn: () => batchApi.getReport(), retry: false });

  const projectOptions = useMemo(() => {
    const values = new Set<string>(['all']);
    for (const p of dashboard?.scope.projects || []) if (p) values.add(p);
    for (const p of reportDashboard?.scope.projects || []) if (p) values.add(p);
    if (project) values.add(project);
    if (reportProject) values.add(reportProject);
    return [...values];
  }, [dashboard?.scope.projects, reportDashboard?.scope.projects, project, reportProject]);

  const selectedProject = reportProject && reportProject !== 'all' ? reportProject : undefined;
  const selectedProjectLabel = selectedProject ? projectDisplayName(selectedProject) : 'All projects';
  const notes = sourceNotes(warning);

  useEffect(() => {
    if (project && project !== reportProject) setReportProject(project);
  }, [project]);

  useEffect(() => {
    if (!dashboard) return;
    if (!overlapsDataRange(startDate, endDate, dashboard)) {
      const next = dashboardRange(dashboard);
      setStartDate(next.startDate);
      setEndDate(next.endDate);
    }
  }, [dashboard?.meta.dataMin, dashboard?.meta.dataMax, dashboard?.scope.startDate, dashboard?.scope.endDate, reportProject]);

  useEffect(() => {
    if (!reportData) return;
    const meta = reportData.meta as ReportMeta | undefined;
    if (reportData.dashboard) {
      setReportDashboard(reportData.dashboard);
      const visibleWarnings = userFacingWarnings(reportData.dashboard.meta.warnings);
      setWarning(visibleWarnings.length ? visibleWarnings.join('; ') : null);
    }
    setReportMeta(meta || null);
    setReportMarkdown(reportData.markdown || '');
    const params = meta?.params;
    if (params?.startDate) setStartDate(params.startDate);
    if (params?.endDate) setEndDate(params.endDate);
    if (params?.reportType) setReportType(params.reportType);
    if (params) setReportProject(params.project || 'all');
  }, [reportData]);

  const generateMutation = useMutation({
    mutationFn: () => batchApi.generate({ startDate, endDate, reportType, project: selectedProject }),
    onMutate: () => {
      setError(null);
      setWarning(null);
      setReportDashboard(null);
      setReportMeta(null);
      setReportMarkdown('');
    },
    onSuccess: (result) => {
      if (result.payload) setReportDashboard(result.payload);
      const nextMeta = result.report?.meta as ReportMeta | undefined;
      setReportMeta(nextMeta || null);
      const emptyResult = result.payload && !hasMetrics(result.payload);
      if (!result.ok || emptyResult) {
        queryClient.removeQueries({ queryKey: ['report'] });
        setReportDashboard(null);
        setReportMeta(null);
        setReportMarkdown('');
        setError(result.error || 'No metrics found for the selected report scope. Narrative was not generated.');
        setWarning(null);
        return;
      }
      setError(null);
      const visibleWarnings = userFacingWarnings(result.warnings);
      setWarning(visibleWarnings.length ? visibleWarnings.join('; ') : null);
      if (result.payload && nextMeta) {
        queryClient.setQueryData<GeneratedReportData>(['report'], {
          dashboard: result.payload,
          markdown: result.report?.markdown || '',
          meta: nextMeta,
        });
      }
      if (result.report?.markdown) {
        setReportMarkdown(result.report.markdown);
      } else {
        setReportMarkdown('');
      }
    },
    onError: (err: unknown) => {
      setReportDashboard(null);
      setReportMeta(null);
      setReportMarkdown('');
      setError(apiErrorMessage(err, 'Report generation failed'));
    },
  });

  const chartData = reportMatchesSelection(reportDashboard, reportMeta, { startDate, endDate, reportType, project: selectedProject })
    ? reportDashboard
    : null;
  const generating = generateMutation.isPending;
  const hasNarrative = Boolean(chartData && reportMarkdown);
  const hasReport = !generating && (Boolean(chartData) || hasNarrative);

  const datePresets = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 3600 * 1000);
    setEndDate(end.toISOString().slice(0, 10));
    setStartDate(start.toISOString().slice(0, 10));
  };

  const downloadPdf = async () => {
    setDownloading(true);
    setError(null);
    try {
      await batchApi.downloadReportPdf({ startDate, endDate, reportType, kpiStyle, project: selectedProject, branding: getReportBranding() });
    } catch (err) {
      setError(apiErrorMessage(err, 'PDF export failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="h-full min-w-0 flex flex-col overflow-hidden">
      <div className="px-4 py-4 border-b border-qa-border sm:px-6 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full min-w-0 sm:w-auto"><label className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light block mb-1">Start</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full min-w-0 max-w-full border border-qa-ink px-2 py-1 text-sm bg-white sm:w-auto" /></div>
          <div className="w-full min-w-0 sm:w-auto"><label className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light block mb-1">End</label><input type="date" value={endDate} max={today} onChange={(e) => setEndDate(e.target.value)} className="w-full min-w-0 max-w-full border border-qa-ink px-2 py-1 text-sm bg-white sm:w-auto" /></div>
          <div className="w-full min-w-0 sm:w-auto"><label className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light block mb-1">Report type</label><select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)} className="w-full min-w-0 max-w-full border border-qa-ink px-2 py-1 text-sm bg-white sm:w-auto">{REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}</select></div>
          <div className="w-full min-w-0 sm:w-auto"><label className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light block mb-1">Project</label><select value={reportProject} onChange={(e) => setReportProject(e.target.value)} className="w-full min-w-0 max-w-full border border-qa-ink px-2 py-1 text-sm bg-white sm:w-auto">{projectOptions.map((p) => <option key={p} value={p}>{p === 'all' ? 'All projects' : projectDisplayName(p)}</option>)}</select></div>
          <div className="flex gap-1">{datePresets.map((p) => <button type="button" key={p.label} onClick={() => setPreset(p.days)} className="px-2 py-1 text-xs border border-qa-border bg-white">{p.label}</button>)}</div>
          <button type="button" onClick={() => generateMutation.mutate()} disabled={generating} className={clsx('w-full px-4 py-2 text-xs font-mono-qa uppercase tracking-wider text-white border-0 sm:w-auto', generating ? 'opacity-60 cursor-wait' : 'cursor-pointer')} style={{ background: QA.accent }}>{generating ? 'Generating...' : 'Generate Report'}</button>
          <button type="button" onClick={downloadPdf} disabled={downloading || !chartData} className="w-full justify-center px-4 py-2 text-xs font-mono-qa uppercase tracking-wider border border-qa-ink bg-white disabled:opacity-50 inline-flex items-center gap-2 sm:w-auto"><Download size={14} />{downloading ? 'Exporting...' : 'Download PDF'}</button>
        </div>
        <div className="mt-2 text-[12px] text-qa-muted-light">Selected scope: {selectedProjectLabel} · {startDate || 'any'} → {endDate || 'any'}</div>
        {error && <div className="mt-3 p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">{error}</div>}
        {notes.length > 0 && <div className="mt-3 p-3 border border-[#d8e3f1] bg-[#edf4fb] text-[#28527a] text-sm"><strong>Data source notes:</strong><ul className="mt-1 mb-0 pl-4">{notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
      </div>

      <main className="flex-1 min-w-0 overflow-auto p-4 bg-[#f5f3ed] sm:p-6 lg:p-8">
        <div className="max-w-qa mx-auto min-w-0 bg-white border border-qa-border shadow-sm min-h-[600px] print:border-0 print:shadow-none">
          <div className="p-4 border-b border-qa-border sm:p-6 lg:p-8">
            <div className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted-light mb-2">AI report canvas</div>
            <h1 className="font-spectral text-2xl sm:text-3xl font-bold m-0 break-words">{REPORT_TYPES.find((t) => t.value === reportType)?.label} QA Report</h1>
            <p className="text-qa-muted mt-1 mb-0">{selectedProjectLabel} · {startDate} to {endDate}</p>
          </div>
          {hasReport ? (
            <div className="p-4 space-y-6 sm:p-6 sm:space-y-8 lg:p-8">
              {chartData && <AiReportCharts dashboard={chartData} kpiStyle={kpiStyle} reportType={reportType} />}
              {hasNarrative ? <article className="prose prose-sm max-w-none prose-headings:font-spectral prose-table:text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reportMarkdown}</ReactMarkdown></article> : <div className="border border-qa-border bg-[#faf8f2] p-6 text-qa-muted">Charts are ready. Configure an LLM key and generate to add narrative.</div>}
            </div>
          ) : (
            <div className="p-6 text-center text-qa-muted sm:p-12">
              <div className="font-spectral text-2xl font-bold text-qa-ink mb-2">No report yet</div>
              <p>Choose dates and click Generate Report.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
