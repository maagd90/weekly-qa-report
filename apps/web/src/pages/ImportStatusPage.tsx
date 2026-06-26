import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, FileText, ArrowRight, Trash2, FolderOpen } from 'lucide-react';
import clsx from 'clsx';
import { batchApi } from '../lib/api';

const TEMPLATE_COLUMNS = [
  'ResourceID', 'ResourceName', 'Team', 'Role',
  'ProjectID', 'ProjectName', 'CR_ID', 'CR_Title',
  'Year', 'WeekNumber', 'WeekStart', 'WeekEnd',
  'TestCasesPlanned', 'TestCasesExecuted', 'TestCasesPassed', 'TestCasesFailed',
  'BugsReported', 'BugsClosed', 'Hours_Spent', 'Notes',
  'Status', 'Priority', 'PercentComplete', 'KeyAccomplishments', 'Risks', 'Blockers',
];

interface StagedFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export function ImportStatusPage() {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [pattern, setPattern] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [weekYear, setWeekYear] = useState(new Date().getFullYear());
  const [weekNumber, setWeekNumber] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: files = [], isLoading } = useQuery<StagedFile[]>({
    queryKey: ['input-files'],
    queryFn: batchApi.listInputFiles,
    refetchInterval: 15_000,
  });

  const uploadMutation = useMutation({
    mutationFn: batchApi.upload,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['input-files'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: batchApi.deleteInputFile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['input-files'] }),
  });

  const saveMappingMutation = useMutation({
    mutationFn: batchApi.saveMapping,
    onSuccess: () => {
      setMappingOpen(false);
      setMapping({});
      setHeaders([]);
    },
  });

  const handleFile = useCallback((file: File) => {
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Stage Input Files</h2>
        <p className="text-sm text-slate-500 mt-1">
          Upload exports to the <code className="bg-slate-100 px-1 rounded">input/</code> folder. Files are stored only — go to AI Report to generate the dashboard and report.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
        )}
      >
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.json,.pdf,.xml" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        <Upload size={36} className={clsx('mx-auto mb-3', isDragging ? 'text-blue-500' : 'text-slate-400')} />
        <p className="text-base font-medium text-slate-700">
          {uploadMutation.isPending ? 'Uploading…' : 'Drop file here or click to browse'}
        </p>
        <p className="text-sm text-slate-400 mt-1">XLSX, CSV, TSV, JSON, PDF, XML (max 20 MB)</p>
      </div>

      {uploadMutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {(uploadMutation.error as Error).message}
        </div>
      )}

      {uploadMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle size={16} /> File staged. Run Generate Report on the AI Report tab.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <FolderOpen size={18} className="text-blue-500" />
          <h3 className="font-semibold text-slate-800">Staged files ({files.length})</h3>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-slate-400">No files in input/ yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 py-3 text-sm">
                <FileText size={16} className="text-slate-400 shrink-0" />
                <span className="font-medium text-slate-700 flex-1 truncate">{f.name}</span>
                <span className="text-slate-400 text-xs">{(f.size / 1024).toFixed(1)} KB</span>
                <button onClick={() => deleteMutation.mutate(f.name)} className="text-red-500 hover:text-red-700 p-1" title="Remove">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">JIRA column mapping</h3>
          <button onClick={() => setMappingOpen(!mappingOpen)} className="text-sm text-blue-600 hover:underline">
            {mappingOpen ? 'Hide' : 'Configure mapping'}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Save column maps for JIRA or custom exports. Use a filename pattern (e.g. <code className="bg-slate-100 px-1 rounded">*jira*.csv</code>).
        </p>

        {mappingOpen && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="flex gap-3 flex-wrap">
              <input type="text" placeholder="Filename pattern" value={pattern} onChange={(e) => setPattern(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
              <input type="number" value={weekYear} onChange={(e) => setWeekYear(Number(e.target.value))} className="w-24 border rounded-lg px-2 py-2 text-sm" placeholder="Year" />
              <input type="number" min={1} max={53} value={weekNumber} onChange={(e) => setWeekNumber(Number(e.target.value))} className="w-20 border rounded-lg px-2 py-2 text-sm" placeholder="Week" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setHeaders(['Issue key', 'Summary', 'Assignee', 'Status', 'Priority', 'Created'])}
                className="text-xs text-slate-500 underline">Load JIRA sample columns</button>
            </div>
            {headers.map((srcCol) => (
              <div key={srcCol} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                <span className="text-sm font-medium text-slate-700 flex-1 truncate">{srcCol}</span>
                <ArrowRight size={14} className="text-slate-400 shrink-0" />
                <select value={mapping[srcCol] || ''} onChange={(e) => setMapping((m) => ({ ...m, [srcCol]: e.target.value }))}
                  className="text-sm border border-slate-300 rounded-lg px-2 py-1">
                  <option value="">— Skip —</option>
                  {TEMPLATE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            ))}
            <button
              onClick={() => saveMappingMutation.mutate({ pattern, mapping, weekYear, weekNumber })}
              disabled={!pattern.trim() || saveMappingMutation.isPending}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              <CheckCircle size={14} /> Save mapping
            </button>
          </div>
        )}
      </div>

      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Supported formats</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600">
          <p><strong className="text-blue-600">XLSX</strong> — Template with Resources, Projects, CRs, Weekly_Log, Project_Status_Weekly sheets.</p>
          <p><strong className="text-blue-600">CSV / TSV</strong> — JIRA exports or custom; use column mapping if needed.</p>
          <p><strong className="text-blue-600">JSON</strong> — JIRA REST export or template JSON.</p>
          <p><strong className="text-blue-600">PDF / XML</strong> — Text/table extraction with optional mapping.</p>
        </div>
      </div>
    </div>
  );
}
