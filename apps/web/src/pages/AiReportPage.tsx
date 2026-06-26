import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Brain, Play, StopCircle, Download, ChevronDown, ChevronUp,
  CheckCircle, Database, AlertCircle, Loader2, History,
} from 'lucide-react';
import clsx from 'clsx';
import { settingsApi, aiApi } from '../lib/api';

type ReportType = 'full' | 'executive' | 'resources' | 'projects';

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'full',      label: 'Full Report',      desc: 'All sections: executive summary, resources, projects, bugs, risks' },
  { value: 'executive', label: 'Executive Summary', desc: 'High-level 1-page summary for leadership' },
  { value: 'resources', label: 'Resources Only',    desc: 'Focus on individual resource performance and CR assignments' },
  { value: 'projects',  label: 'Projects Only',     desc: 'Focus on project health, risks, and blockers' },
];

interface ToolCallNotif {
  toolName: string;
  rowCount: number;
}

interface PastReport {
  id: number;
  created_at: string;
  start_date: string;
  end_date: string;
  report_type: string;
  reportLength: number;
}

export function AiReportPage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [reportType, setReportType] = useState<ReportType>('full');
  const [projectId, setProjectId] = useState('');

  const [streaming, setStreaming] = useState(false);
  const [reportText, setReportText] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallNotif[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reportAreaRef = useRef<HTMLDivElement>(null);

  const { data: aiSettings } = useQuery({ queryKey: ['settings-ai'], queryFn: settingsApi.getAi });
  const { data: pastReports = [], refetch: refetchHistory } = useQuery({
    queryKey: ['ai-reports'],
    queryFn: aiApi.listReports,
    enabled: showHistory,
  });

  // Auto-scroll as text streams in
  useEffect(() => {
    if (reportAreaRef.current && streaming) {
      reportAreaRef.current.scrollTop = reportAreaRef.current.scrollHeight;
    }
  }, [reportText, streaming]);

  const stopStream = () => {
    eventSourceRef.current?.close();
    setStreaming(false);
  };

  const generateReport = async () => {
    if (!aiSettings?.keyConfigured) {
      setError('Claude API key is not configured. Go to Settings to add your key.');
      return;
    }

    setError(null);
    setReportText('');
    setToolCalls([]);
    setStreaming(true);
    setShowSources(false);

    const body = JSON.stringify({ startDate, endDate, reportType, projectId: projectId || undefined });

    // Use fetch + ReadableStream for SSE (EventSource doesn't support POST)
    try {
      const response = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'delta') {
              setReportText((prev) => prev + event.text);
            } else if (event.type === 'tool_call') {
              setToolCalls((prev) => [...prev, { toolName: event.toolName, rowCount: event.rowCount }]);
            } else if (event.type === 'done') {
              if (event.toolCalls) {
                setToolCalls(event.toolCalls.map((tc: { toolName: string; rowCount: number }) => ({
                  toolName: tc.toolName,
                  rowCount: tc.rowCount,
                })));
              }
            } else if (event.type === 'error') {
              setError(event.message);
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStreaming(false);
      refetchHistory();
    }
  };

  const exportPDF = () => {
    window.print();
  };

  const loadPastReport = async (id: number) => {
    const data = await aiApi.getReport(id);
    setReportText(data.report_markdown || '');
    setToolCalls(data.toolCalls || []);
    setShowHistory(false);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 print:hidden">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-violet-50 rounded-xl p-2">
              <Brain size={20} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">AI Report Generator</h2>
              <p className="text-xs text-slate-500">Zero-hallucination: Claude queries the database via tools and reports only real data.</p>
            </div>
            {!aiSettings?.keyConfigured && (
              <span className="ml-auto text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                Claude API key not configured — go to Settings
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>

            {/* Report type */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">Type</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
                {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Actions */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => { setShowHistory(!showHistory); }}
                className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-lg transition"
              >
                <History size={14} /> History
              </button>
              {reportText && (
                <button onClick={exportPDF}
                  className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-lg transition">
                  <Download size={14} /> Export PDF
                </button>
              )}
              {streaming ? (
                <button onClick={stopStream}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm px-5 py-2 rounded-lg transition">
                  <StopCircle size={14} /> Stop
                </button>
              ) : (
                <button
                  onClick={generateReport}
                  disabled={!aiSettings?.keyConfigured}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-5 py-2 rounded-lg transition disabled:opacity-50"
                >
                  <Play size={14} /> Generate Report
                </button>
              )}
            </div>
          </div>

          {/* Report type description */}
          <p className="text-xs text-slate-400">{REPORT_TYPES.find((t) => t.value === reportType)?.desc}</p>
        </div>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <div className="bg-white border-b border-slate-200 px-6 py-3 print:hidden max-h-52 overflow-y-auto">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Past Reports</h4>
          {(pastReports as PastReport[]).length === 0 ? (
            <p className="text-sm text-slate-400">No reports generated yet.</p>
          ) : (
            <div className="space-y-1">
              {(pastReports as PastReport[]).map((r: PastReport) => (
                <button key={r.id} onClick={() => loadPastReport(r.id)}
                  className="w-full text-left text-sm hover:bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="text-violet-600 font-medium">{r.report_type}</span>
                  <span className="text-slate-600">{r.start_date} → {r.end_date}</span>
                  <span className="text-slate-400 ml-auto">{new Date(r.created_at).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live tool call feed */}
      {(streaming || toolCalls.length > 0) && (
        <div className="bg-slate-900 text-slate-300 px-6 py-3 text-xs font-mono flex items-center gap-3 print:hidden overflow-x-auto">
          {streaming && <Loader2 size={12} className="text-violet-400 animate-spin shrink-0" />}
          <span className="text-slate-500 shrink-0">Tools queried:</span>
          {toolCalls.map((tc, i) => (
            <span key={i} className="flex items-center gap-1 bg-slate-800 rounded px-2 py-0.5 shrink-0">
              <Database size={10} className="text-violet-400" />
              {tc.toolName}
              <span className="text-slate-500">({tc.rowCount} rows)</span>
            </span>
          ))}
          {streaming && <span className="text-violet-400 animate-pulse ml-1">generating…</span>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2 print:hidden">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Report output */}
      <div className="flex-1 overflow-y-auto" ref={reportAreaRef}>
        {!reportText && !streaming && !error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-12 text-slate-400">
            <Brain size={48} className="mb-4 text-slate-300" />
            <p className="text-base font-medium text-slate-500">Ready to generate a report</p>
            <p className="text-sm mt-1">Select a date range and click Generate Report.</p>
            <p className="text-xs mt-3 max-w-md text-slate-400">
              Claude will call SQL tools to fetch real data from the database — no numbers are invented or estimated.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-8">
            {/* Print header */}
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold">QA Metrics Report</h1>
              <p className="text-sm text-slate-500">{startDate} — {endDate} · Generated {new Date().toLocaleString()}</p>
            </div>

            <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-h2:text-xl prose-h3:text-base prose-table:text-sm prose-code:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportText}</ReactMarkdown>
            </div>

            {streaming && (
              <div className="flex items-center gap-2 mt-4 text-sm text-violet-600">
                <Loader2 size={14} className="animate-spin" />
                Writing report…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Data sources footer */}
      {toolCalls.length > 0 && !streaming && (
        <div className="border-t border-slate-200 bg-white print:hidden">
          <button
            onClick={() => setShowSources(!showSources)}
            className="w-full flex items-center gap-2 px-6 py-3 text-xs text-slate-500 hover:bg-slate-50 transition"
          >
            <Database size={12} />
            Data Sources ({toolCalls.length} tool calls)
            {showSources ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
          </button>
          {showSources && (
            <div className="px-6 pb-4 space-y-1.5 max-h-40 overflow-y-auto">
              {toolCalls.map((tc, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                  <CheckCircle size={10} className="text-green-500" />
                  <span className="font-mono text-violet-700">{tc.toolName}</span>
                  <span className="text-slate-400">returned {tc.rowCount} row{tc.rowCount !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
