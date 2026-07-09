import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { batchApi, apiErrorMessage, getReportBranding, type ReportType } from '../lib/api';
import type { KpiStyle } from '../theme/qaTheme';
import { QA } from '../theme/qaTheme';
import { AiReportCharts } from '../components/qa/AiReportCharts';
import { projectDisplayName } from '../lib/projectDisplay';

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'full', label: 'Full', desc: 'all sections' },
  { value: 'executive', label: 'Executive', desc: 'summary only' },
  { value: 'defects', label: 'Defects', desc: 'defect focus' },
  { value: 'cycles', label: 'Cycles', desc: 'cycle focus' },
];

// Keep this list browser-local. Importing the batch runtime into Vite dev mode can blank the UI
// because that package is compiled for Node/CommonJS. The list mirrors apps/batch/src/ai/datasetTools.ts.
const DATASET_TOOLS = [
  'get_result_mix',
  'get_tester_stats',
  'get_cycle_health',
  'get_story_bug_split',
  'get_defect_backlog',
  'get_traceability',
  'get_uat_summary',
] as const;

type ToolCallMeta = { toolName: string; rowCount: number };
type ReportMeta = { toolCalls?: ToolCallMeta[]; params?: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string } };

interface AiReportPageProps {
  dashboard?: DashboardPayload | null;
  kpiStyle: KpiStyle;
  project: string;
  onGenerated?: () => void;
}

function overlapsDataRange(startDate: string, endDate: string, dashboard?: DashboardPayload | null): boolean {
  const dataMin = dashboard?.meta.dataMin;
  const dataMax = dashboard?.meta.dataMax;
  if (!startDate || !endDate) return false;
  if (!dataMin || !dataMax) return true;
  return !(endDate < dataMin || startDate > dataMax);
}

function dashboardRange(dashboard?: DashboardPayload | null): { startDate: string; endDate: string } {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    startDate: dashboard?.scope.startDate || dashboard?.meta.dataMin || weekAgo,
    endDate: dashboard?.scope.endDate || dashboard?.meta.dataMax || today,
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

export function AiReportPage({ dashboard, kpiStyle, project, onGenerated }: AiReportPageProps) {
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
  const [toolCalls, setToolCalls] = useState<ToolCallMeta[]>([]);
  const [downloading, setDownloading] = useState(false);

  const { data: reportData } = useQuery({ queryKey: ['report'], queryFn: batchApi.getReport, retry: false });

  const projectOptions = useMemo(() => {
    const values = new Set<string>(['all']);
    for (const p of dashboard?.scope.projects || []) if (p) values.add(p);
    if (project) values.add(project);
    return [...values];
  }, [dashboard?.scope.projects, project]);

  const selectedProject = reportProject && reportProject !== 'all' ? reportProject : undefined;
  const selectedProjectLabel = selectedProject ? projectDisplayName(selectedProject) : 'All projects';

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
    if (reportData.markdown) setReportMarkdown(reportData.markdown);
    if (meta?.toolCalls) setToolCalls(meta.toolCalls);
    const params = meta?.params;
    if (params?.startDate) setStartDate(params.startDate);
    if (params?.endDate) setEndDate(params.endDate);
    if (params?.reportType) setReportType(params.reportType);
    if (params?.project) setReportProject(params.project);
  }, [reportData]);

  const generateMutation = useMutation({
    mutationFn: () => batchApi.generate({ startDate, endDate, reportType, project: selectedProject }),
    onMutate: () => {
      setError(null);
      setWarning(null);
    },
    onSuccess: (result) => {
      if (result.payload) setReportDashboard(result.payload);
      const emptyResult = result.payload && !hasMetrics(result.payload);
      if (!result.ok || emptyResult) {
        setReportMarkdown('');
        setToolCalls([]);
        setError(result.error || 'No metrics found for the selected report scope. Narrative was not generated.');
        setWarning(null);
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] });
        return;
      }
      setError(null);
      setWarning(result.warnings?.length ? result.warnings.join('; ') : null);
      if (result.report?.markdown) {
        const meta = result.report.meta as ReportMeta | undefined;
        setReportMarkdown(result.report.markdown);
        setToolCalls(meta?.toolCalls ?? []);
      } else {
        setReportMarkdown('');
        setToolCalls([]);
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-init'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      onGenerated?.();
    },
    onError: (err: unknown) => {
      setReportMarkdown('');
      setToolCalls([]);
      setError(apiErrorMessage(err, 'Report generation failed'));
    },
  });

  const chartData = reportDashboard ?? dashboard ?? null;
  const generating = generateMutation.isPending;
  const hasNarrative = Boolean(reportMarkdown);
  const hasReport = !generating && (Boolean(chartData) || hasNarrative);
  const datePresets = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }];
  const fullRange = dashboardRange(dashboard);

  async function handleDownloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      await batchApi.downloadReportPdf({ startDate, endDate, reportType, kpiStyle, project: selectedProject, branding: getReportBranding() });
    } catch (err) {
      setError(apiErrorMessage(err, 'PDF export failed'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-qa mx-auto px-8 pt-[26px] pb-[60px]">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-[34px] items-start">
          <aside className="lg:sticky lg:top-[18px]">
            <div className="bg-qa-ink text-[#F5F3ED] p-[22px]">
              <div className="font-mono-qa text-[10px] tracking-widest uppercase text-qa-muted-light mb-3.5">Generate Report</div>
              <label className="block text-[11px] text-[#b3aea3] mb-1.5">Report type</label>
              <div className="flex flex-col gap-1.5 mb-4">
                {REPORT_TYPES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setReportType(t.value)} className={clsx('flex items-baseline gap-2 px-2.5 py-2 border text-left text-[12.5px] font-semibold', reportType === t.value ? 'border-qa-accent bg-[#2a2825]' : 'border-[#3a3833] bg-transparent')}>
                    <span>{t.label}</span><span className="font-mono-qa text-[9.5px] text-qa-muted-light font-normal ml-auto">{t.desc}</span>
                  </button>
                ))}
              </div>
              <label className="block text-[11px] text-[#b3aea3] mb-1.5">Project</label>
              <select value={reportProject} onChange={(e) => setReportProject(e.target.value)} className="w-full font-mono-qa text-[11.5px] py-[8px] px-2.5 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED] mb-4">
                {projectOptions.map((p) => <option key={p} value={p}>{p === 'all' ? 'All projects' : projectDisplayName(p)}</option>)}
              </select>
              <label className="block text-[11px] text-[#b3aea3] mb-1.5">Date range</label>
              <div className="flex items-center gap-1.5 mb-2">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 min-w-0 font-mono-qa text-[11px] py-[7px] px-1.5 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]" />
                <span className="text-qa-muted-light text-[11px]">→</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 min-w-0 font-mono-qa text-[11px] py-[7px] px-1.5 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]" />
              </div>
              <div className="flex flex-wrap gap-1 mb-4">
                {datePresets.map((d) => (
                  <button key={d.label} type="button" onClick={() => { setEndDate(today); setStartDate(new Date(Date.now() - d.days * 86400000).toISOString().slice(0, 10)); }} className="font-mono-qa text-[10px] px-2 py-1 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]">{d.label}</button>
                ))}
                <button type="button" onClick={() => { setStartDate(fullRange.startDate); setEndDate(fullRange.endDate); }} className="font-mono-qa text-[10px] px-2 py-1 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]">Full range</button>
              </div>
              <div className="font-mono-qa text-[10px] text-qa-muted-light mb-1.5">Scope</div>
              <div className="font-mono-qa text-[11.5px] bg-[#2a2825] px-2.5 py-2 mb-4">{selectedProjectLabel} · {startDate} → {endDate}</div>
              <button type="button" onClick={() => generateMutation.mutate()} disabled={generating} className="w-full py-3 border-none text-white font-mono-qa text-xs font-semibold tracking-wider uppercase disabled:cursor-wait" style={{ background: generating ? '#44423d' : QA.accent }}>
                {generating ? 'Generating…' : hasReport ? 'Regenerate Report' : 'Generate Report'}
              </button>
            </div>
            <div className="bg-white border border-qa-border p-4 mt-3.5">
              <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-2.5">Dataset checks</div>
              {DATASET_TOOLS.map((name) => {
                const called = toolCalls.some((t) => t.toolName === name);
                return <div key={name} className="flex items-center gap-2 py-1.5 border-t border-[#f3f0e8] first:border-t-0"><span className="w-1.5 h-1.5 rounded-full" style={{ background: called ? QA.PASS : '#d8d3c7' }} /><span className="font-mono-qa text-[10.5px] text-[#3a3833] flex-1">{name}</span><span className="font-mono-qa text-[10px] text-qa-muted-pale">{called ? 'checked' : 'idle'}</span></div>;
              })}
            </div>
          </aside>
          <article className="bg-white border border-qa-border min-h-[520px]">
            {error && <div className="m-6 p-4 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">{error}</div>}
            {warning && !error && <div className="m-6 p-4 border border-[#e8dcc2] bg-[#faf6ee] text-[#6a5a2c] text-sm">{warning}</div>}
            {!generating && !hasReport && !error && <div className="flex flex-col items-center justify-center h-[520px] text-center px-10"><div className="font-spectral text-[64px] leading-none text-qa-border">¶</div><h3 className="font-spectral font-semibold text-[22px] mt-3.5 mb-2">No report generated yet</h3><p className="text-[13.5px] text-qa-muted max-w-[420px] m-0">Pick a report type, project, and date range, then click <strong>Generate Report</strong>.</p></div>}
            {generating && <div className="p-10"><div className="font-mono-qa text-[11px] tracking-wider uppercase mb-6" style={{ color: QA.accent }}>• Generating — querying dataset</div>{['Reading staged exports', 'Parsing executions & issues', 'Building in-memory dataset', `Filtering project: ${selectedProjectLabel}`, 'Running dataset checks', 'Writing narrative'].map((label, i) => <div key={label} className="flex items-center gap-3 py-2.5 border-b border-[#f3f0e8]"><span className="w-2 h-2 rounded-full qa-pulse" style={{ background: i === 0 ? QA.accent : '#e2ded4' }} /><span className="font-mono-qa text-xs flex-1">{label}</span><span className="font-mono-qa text-[11px] text-qa-muted-pale">{i === 0 ? 'running' : 'queued'}</span></div>)}</div>}
            {hasReport && <div><div className="px-11 pt-7 pb-5 border-b-2 border-qa-ink flex flex-wrap items-start justify-between gap-4"><div><div className="font-mono-qa text-[10px] tracking-widest uppercase mb-2.5" style={{ color: QA.accent }}>Weekly QA Narrative · {reportType === 'testers' || reportType === 'defects' ? 'defects' : reportType}</div><h1 className="font-spectral font-extrabold text-[32px] leading-tight tracking-tight m-0 mb-3">QA Report</h1><div className="flex gap-4 font-mono-qa text-[10.5px] text-qa-muted-light uppercase tracking-wide flex-wrap"><span>{startDate} → {endDate}</span><span>·</span><span>{hasNarrative ? 'Narrative included' : 'Metrics only'}</span><span>·</span><span>{selectedProjectLabel}</span></div></div><button type="button" onClick={handleDownloadPdf} disabled={downloading} className="inline-flex items-center gap-2 px-4 py-2.5 border border-qa-ink bg-white text-qa-ink font-mono-qa text-[11px] font-semibold tracking-wide uppercase disabled:opacity-50"><Download size={14} />{downloading ? 'Exporting…' : 'Download PDF'}</button></div><div className="px-11 py-7 bg-white">{chartData && <div className="mb-10 pb-8 border-b border-qa-border"><div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-5">Metrics & Charts</div><AiReportCharts dashboard={chartData} kpiStyle={kpiStyle} reportType={reportType} /></div>}{hasNarrative && <div className="prose prose-slate max-w-none prose-headings:font-spectral"><div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-5">Narrative Summary</div><ReactMarkdown remarkPlugins={[remarkGfm]}>{reportMarkdown}</ReactMarkdown></div>}</div></div>}
          </article>
        </div>
      </div>
    </div>
  );
}
