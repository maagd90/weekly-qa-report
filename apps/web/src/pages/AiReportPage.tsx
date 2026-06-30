import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { batchApi, apiErrorMessage, type ReportType } from '../lib/api';
import { summaryBodyOnly } from '../lib/reportSummary';
import type { KpiStyle } from '../theme/qaTheme';
import { QA } from '../theme/qaTheme';
import { AiReportCharts } from '../components/qa/AiReportCharts';
import { AiReportOnePager } from '../components/qa/AiReportOnePager';

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'executive', label: 'One-Page Summary', desc: 'recommended' },
  { value: 'full', label: 'Full', desc: 'detailed on screen' },
  { value: 'testers', label: 'Testers', desc: 'tester focus' },
  { value: 'cycles', label: 'Cycles', desc: 'cycle focus' },
];

const AI_TOOLS = [
  'get_result_mix',
  'get_tester_stats',
  'get_cycle_health',
  'get_story_bug_split',
  'get_defect_backlog',
  'get_traceability',
  'get_uat_summary',
];

interface AiReportPageProps {
  dashboard?: DashboardPayload | null;
  kpiStyle: KpiStyle;
  onGenerated?: () => void;
}

export function AiReportPage({ dashboard, kpiStyle, onGenerated }: AiReportPageProps) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [reportType, setReportType] = useState<ReportType>('executive');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [reportDashboard, setReportDashboard] = useState<DashboardPayload | null>(null);
  const [toolCalls, setToolCalls] = useState<{ toolName: string; rowCount: number }[]>([]);
  const [downloading, setDownloading] = useState(false);

  const { data: status } = useQuery({ queryKey: ['api-status'], queryFn: batchApi.getStatus });
  const { data: reportData } = useQuery({
    queryKey: ['report'],
    queryFn: batchApi.getReport,
    retry: false,
  });

  useEffect(() => {
    if (reportData?.markdown) setReportMarkdown(reportData.markdown);
    if (reportData?.meta?.toolCalls) setToolCalls(reportData.meta.toolCalls);
    if (reportData?.meta?.params) {
      const p = reportData.meta.params;
      if (p.startDate) setStartDate(p.startDate);
      if (p.endDate) setEndDate(p.endDate);
      if (p.reportType) setReportType(p.reportType);
    }
  }, [reportData]);

  const generateMutation = useMutation({
    mutationFn: () => batchApi.generate({ startDate, endDate, reportType }),
    onSuccess: (result) => {
      const aiSkipped = result.warnings?.find((w: string) => w.includes('ANTHROPIC_API_KEY'));
      const aiFailed = result.warnings?.find((w: string) => w.startsWith('AI narrative failed'));

      if (!result.ok) {
        setError(result.error || 'Generation failed');
      } else {
        setError(null);
      }

      setWarning(aiSkipped || aiFailed || null);

      if (result.payload) setReportDashboard(result.payload);
      if (result.report?.markdown) {
        setReportMarkdown(result.report.markdown);
        setToolCalls(result.report.meta?.toolCalls ?? []);
      } else if (!aiSkipped) {
        queryClient.invalidateQueries({ queryKey: ['report'] });
      }

      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-init'] });
      onGenerated?.();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Report generation failed')),
  });

  const chartData = reportDashboard ?? dashboard ?? null;
  const reportText = reportMarkdown;
  const generating = generateMutation.isPending;
  const hasCharts = !!chartData;
  const hasNarrative = !!reportText;
  const isDone = !generating && (hasCharts || hasNarrative);
  const isIdle = !generating && !isDone && !error;

  const datePresets = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];

  const isOnePageView = reportType === 'executive';

  async function handleDownloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      await batchApi.downloadReportPdf({ startDate, endDate, reportType, kpiStyle });
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
              <div className="font-mono-qa text-[10px] tracking-widest uppercase text-qa-muted-light mb-3.5">Generate AI Report</div>
              <label className="block text-[11px] text-[#b3aea3] mb-1.5">Report type</label>
              <div className="flex flex-col gap-1.5 mb-4">
                {REPORT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setReportType(t.value)}
                    className={clsx(
                      'flex items-baseline gap-2 px-2.5 py-2 border cursor-pointer text-left text-[12.5px] font-semibold',
                      reportType === t.value ? 'border-qa-accent bg-[#2a2825]' : 'border-[#3a3833] bg-transparent'
                    )}
                    style={{ color: '#F5F3ED', fontFamily: 'Public Sans, sans-serif' }}
                  >
                    {t.label}
                    <span className="font-mono-qa text-[9.5px] text-qa-muted-light font-normal ml-auto">{t.desc}</span>
                  </button>
                ))}
              </div>
              <label className="block text-[11px] text-[#b3aea3] mb-1.5">Date range</label>
              <div className="flex items-center gap-1.5 mb-2">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 min-w-0 font-mono-qa text-[11px] py-[7px] px-1.5 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]" />
                <span className="text-qa-muted-light text-[11px]">→</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 min-w-0 font-mono-qa text-[11px] py-[7px] px-1.5 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED]" />
              </div>
              <div className="flex flex-wrap gap-1 mb-4">
                {datePresets.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => {
                      setEndDate(today);
                      setStartDate(new Date(Date.now() - d.days * 86400000).toISOString().slice(0, 10));
                    }}
                    className="font-mono-qa text-[10px] px-2 py-1 border border-[#44423d] bg-[#2a2825] text-[#F5F3ED] cursor-pointer"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="font-mono-qa text-[10px] text-qa-muted-light mb-1.5">Scope</div>
              <div className="font-mono-qa text-[11.5px] text-[#F5F3ED] bg-[#2a2825] px-2.5 py-2 mb-4">
                {startDate} → {endDate}
              </div>
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generating}
                className="w-full py-3 border-none cursor-pointer text-white font-mono-qa text-xs font-semibold tracking-wider uppercase disabled:cursor-wait"
                style={{ background: generating ? '#44423d' : QA.accent }}
              >
                {generating ? 'Generating…' : isDone ? 'Regenerate AI Report' : 'Generate AI Report'}
              </button>
              <div className="flex items-center gap-1.5 mt-3.5">
                <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: status?.apiKeyConfigured ? QA.PASS : QA.BLOCKED }} />
                <span className="text-[10.5px] text-qa-muted-light">
                  {status?.apiKeyConfigured ? 'Claude API key configured' : 'No API key — charts only'}
                </span>
              </div>
            </div>
            <div className="bg-white border border-qa-border p-4 mt-3.5">
              <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-2.5">Dataset tools</div>
              {AI_TOOLS.map((name) => {
                const called = toolCalls.some((t) => t.toolName === name);
                return (
                  <div key={name} className="flex items-center gap-2 py-1.5 border-t border-[#f3f0e8] first:border-t-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: called ? QA.PASS : '#d8d3c7' }} />
                    <span className="font-mono-qa text-[10.5px] text-[#3a3833] flex-1">{name}</span>
                    <span className="font-mono-qa text-[10px] text-qa-muted-pale">{called ? '×1' : 'idle'}</span>
                  </div>
                );
              })}
            </div>
          </aside>

          <article className="bg-white border border-qa-border min-h-[520px]">
            {error && (
              <div className="m-6 p-4 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">{error}</div>
            )}
            {warning && !error && (
              <div className="m-6 p-4 border border-[#e8dcc2] bg-[#faf6ee] text-[#6a5a2c] text-sm">{warning}</div>
            )}
            {isIdle && (
              <div className="flex flex-col items-center justify-center h-[520px] text-center px-10">
                <div className="font-spectral text-[64px] leading-none text-qa-border">¶</div>
                <h3 className="font-spectral font-semibold text-[22px] mt-3.5 mb-2">No report generated yet</h3>
                <p className="text-[13.5px] text-qa-muted max-w-[380px] m-0">
                  Use <strong>One-Page Summary</strong> for a scannable report your manager can read in a minute. Charts populate from your dataset; Claude writes the brief when an API key is configured.
                </p>
              </div>
            )}
            {generating && (
              <div className="p-10">
                <div className="font-mono-qa text-[11px] tracking-wider uppercase mb-6" style={{ color: QA.accent }}>
                  • Generating — querying dataset
                </div>
                {['Reading staged exports', 'Parsing executions & issues', 'Building in-memory dataset', 'Querying dataset tools', 'Writing narrative with Claude'].map((label, i) => (
                  <div key={label} className="flex items-center gap-3 py-2.5 border-b border-[#f3f0e8]">
                    <span className="w-2 h-2 rounded-full qa-pulse" style={{ background: i === 0 ? QA.accent : '#e2ded4' }} />
                    <span className="font-mono-qa text-xs flex-1">{label}</span>
                    <span className="font-mono-qa text-[11px] text-qa-muted-pale">{i === 0 ? 'running' : 'queued'}</span>
                  </div>
                ))}
              </div>
            )}
            {isDone && (
              <div className="p-0 relative">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloading || !chartData}
                  className="absolute top-7 right-8 z-10 inline-flex items-center gap-2 px-4 py-2.5 border border-qa-ink bg-white text-qa-ink font-mono-qa text-[11px] font-semibold tracking-wide uppercase cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  <Download size={14} />
                  {downloading ? 'Exporting…' : 'Download PDF'}
                </button>

                {isOnePageView && chartData ? (
                  <div className="bg-white">
                    <AiReportOnePager
                      dashboard={chartData}
                      kpiStyle={kpiStyle}
                      narrative={reportText}
                      startDate={startDate}
                      endDate={endDate}
                    />
                    {!hasNarrative && (
                      <p className="px-5 pb-5 text-[13px] text-qa-muted m-0">
                        Add <code className="font-mono-qa text-xs">ANTHROPIC_API_KEY</code> to generate the AI summary bullets.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="bg-white">
                    <div className="px-6 sm:px-8 pt-7 pb-5 border-b-2 border-qa-ink">
                      <div className="font-mono-qa text-[10px] tracking-widest uppercase mb-2.5" style={{ color: QA.accent }}>
                        Weekly QA Narrative · {reportType.charAt(0).toUpperCase() + reportType.slice(1)}
                      </div>
                      <h1 className="font-spectral font-extrabold text-[32px] leading-tight tracking-tight m-0 mb-3 pr-36">
                        QA Report
                      </h1>
                      <div className="flex gap-4 font-mono-qa text-[10.5px] text-qa-muted-light uppercase tracking-wide flex-wrap">
                        <span>{startDate} → {endDate}</span>
                        <span>·</span>
                        <span>DLM · Travel Studio</span>
                      </div>
                    </div>

                    {chartData && (
                      <div className="px-6 sm:px-8 py-7 border-b border-qa-border">
                        <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-5">Metrics & Charts</div>
                        <AiReportCharts dashboard={chartData} kpiStyle={kpiStyle} reportType={reportType} />
                      </div>
                    )}

                    <div className="px-6 sm:px-8 py-7">
                      {hasNarrative ? (
                        <div className="prose prose-slate max-w-none prose-headings:font-spectral qa-report-summary-prose">
                          <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-5">Executive Summary</div>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryBodyOnly(reportText)}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-[13.5px] text-qa-muted m-0">
                          Dashboard metrics refreshed for this date range. Add <code className="font-mono-qa text-xs">ANTHROPIC_API_KEY</code> to generate the AI narrative.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
