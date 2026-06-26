import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Brain, Play, Download, ChevronDown, ChevronUp,
  CheckCircle, Database, AlertCircle, Loader2,
} from 'lucide-react';
import { batchApi, type ReportType } from '../lib/api';

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'full', label: 'Full Report', desc: 'All sections: executive summary, resources, projects, bugs, risks' },
  { value: 'executive', label: 'Executive Summary', desc: 'High-level 1-page summary for leadership' },
  { value: 'resources', label: 'Resources Only', desc: 'Focus on individual resource performance and CR assignments' },
  { value: 'projects', label: 'Projects Only', desc: 'Focus on project health, risks, and blockers' },
];

interface ToolCallNotif {
  toolName: string;
  rowCount: number;
}

interface AiReportPageProps {
  onGenerated?: () => void;
}

export function AiReportPage({ onGenerated }: AiReportPageProps) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [reportType, setReportType] = useState<ReportType>('full');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  const { data: status } = useQuery({ queryKey: ['api-status'], queryFn: batchApi.getStatus });
  const { data: reportData, isLoading: loadingReport } = useQuery({
    queryKey: ['report'],
    queryFn: batchApi.getReport,
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () => batchApi.generate({
      startDate,
      endDate,
      reportType,
      projectId: projectId || undefined,
    }),
    onSuccess: (result) => {
      if (!result.ok && result.error) setError(result.error);
      else setError(null);
      queryClient.invalidateQueries({ queryKey: ['report'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onGenerated?.();
    },
    onError: (err: Error) => setError(err.message),
  });

  const reportText = reportData?.markdown ?? '';
  const toolCalls: ToolCallNotif[] = reportData?.meta?.toolCalls ?? [];
  const generating = generateMutation.isPending;

  useEffect(() => {
    if (reportData?.meta?.params) {
      const p = reportData.meta.params;
      if (p.startDate) setStartDate(p.startDate);
      if (p.endDate) setEndDate(p.endDate);
      if (p.reportType) setReportType(p.reportType);
    }
  }, [reportData]);

  const exportPDF = () => window.print();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="bg-white border-b border-slate-200 px-6 py-4 print:hidden">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-violet-50 rounded-xl p-2">
              <Brain size={20} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Generate Report</h2>
              <p className="text-xs text-slate-500">Parses staged input files, writes dashboard JSON, and runs Claude with in-memory dataset tools.</p>
            </div>
            {!status?.apiKeyConfigured && (
              <span className="ml-auto text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                Set ANTHROPIC_API_KEY in .env
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">Type</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
                {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">Project ID</label>
              <input type="text" placeholder="optional" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32" />
            </div>
            <div className="flex gap-2 ml-auto">
              {reportText && (
                <button onClick={exportPDF} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg">
                  <Download size={14} /> Export PDF
                </button>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={!status?.apiKeyConfigured || generating}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-5 py-2 rounded-lg disabled:opacity-50"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {generating ? 'Generating…' : 'Generate Report'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">{REPORT_TYPES.find((t) => t.value === reportType)?.desc}</p>
          {generating && (
            <p className="text-xs text-violet-600">Parsing input files and calling Claude — this may take 1–3 minutes.</p>
          )}
        </div>
      </div>

      {(generating || toolCalls.length > 0) && (
        <div className="bg-slate-900 text-slate-300 px-6 py-3 text-xs font-mono flex items-center gap-3 print:hidden overflow-x-auto">
          {generating && <Loader2 size={12} className="text-violet-400 animate-spin shrink-0" />}
          <span className="text-slate-500 shrink-0">Dataset tools:</span>
          {toolCalls.map((tc, i) => (
            <span key={i} className="flex items-center gap-1 bg-slate-800 rounded px-2 py-0.5 shrink-0">
              <Database size={10} className="text-violet-400" />
              {tc.toolName}
              <span className="text-slate-500">({tc.rowCount} rows)</span>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2 print:hidden">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loadingReport && !reportText ? (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading last report…</div>
        ) : !reportText && !generating && !error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-12 text-slate-400">
            <Brain size={48} className="mb-4 text-slate-300" />
            <p className="text-base font-medium text-slate-500">No report yet</p>
            <p className="text-sm mt-1">Stage files in Import, then generate with a date range.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-8">
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold">QA Metrics Report</h1>
              <p className="text-sm text-slate-500">{startDate} — {endDate}</p>
            </div>
            <div className="prose prose-slate max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportText}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {toolCalls.length > 0 && !generating && (
        <div className="border-t border-slate-200 bg-white print:hidden">
          <button onClick={() => setShowSources(!showSources)}
            className="w-full flex items-center gap-2 px-6 py-3 text-xs text-slate-500 hover:bg-slate-50">
            <Database size={12} />
            Data sources ({toolCalls.length} tool calls)
            {showSources ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
          </button>
          {showSources && (
            <div className="px-6 pb-4 space-y-1.5 max-h-40 overflow-y-auto">
              {toolCalls.map((tc, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                  <CheckCircle size={10} className="text-green-500" />
                  <span className="font-mono text-violet-700">{tc.toolName}</span>
                  <span className="text-slate-400">{tc.rowCount} rows</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
