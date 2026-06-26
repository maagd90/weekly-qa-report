import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, FileText, X, ArrowRight, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { uploadApi, importApi } from '../lib/api';

interface UploadResponse {
  format: string;
  needsMapping: boolean;
  headers?: string[];
  sampleRows?: string[][];
  filePath?: string;
  importResult?: ImportResult;
  text?: string;
}

interface ImportResult {
  rowsAdded: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errors: string[];
  importedAt: string;
}

const TEMPLATE_COLUMNS = [
  'ResourceID', 'CR_ID', 'Year', 'WeekNumber', 'WeekStart', 'WeekEnd',
  'TC_Planned', 'TC_Executed', 'TC_Passed', 'TC_Failed',
  'Bugs_Reported', 'Bugs_Closed', 'Hours_Spent', 'Notes',
];

export function ImportStatusPage() {
  const queryClient = useQueryClient();

  const { data: importStatus } = useQuery({
    queryKey: ['import-status'],
    queryFn: importApi.status,
    refetchInterval: 10_000,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [weekYear, setWeekYear] = useState<number>(new Date().getFullYear());
  const [weekNumber, setWeekNumber] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadApi.upload,
    onSuccess: (data: UploadResponse) => {
      setUploadResponse(data);
      if (!data.needsMapping && data.importResult) {
        queryClient.invalidateQueries();
      }
    },
  });

  const applyMappingMutation = useMutation({
    mutationFn: uploadApi.applyMapping,
    onSuccess: () => {
      setUploadResponse(null);
      setMapping({});
      queryClient.invalidateQueries();
    },
  });

  const handleFile = useCallback((file: File) => {
    setUploadResponse(null);
    setMapping({});
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleApplyMapping = () => {
    if (!uploadResponse?.filePath) return;
    applyMappingMutation.mutate({
      filePath: uploadResponse.filePath,
      mapping,
      weekYear,
      weekNumber,
    });
  };

  const lastResult: ImportResult | null = importStatus || null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Data Import</h2>
        <p className="text-sm text-slate-500 mt-1">Upload an Excel, CSV, or PDF file to populate the dashboard with fresh data.</p>
      </div>

      {/* Drop Zone */}
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
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFileInput} />
        <Upload size={36} className={clsx('mx-auto mb-3', isDragging ? 'text-blue-500' : 'text-slate-400')} />
        <p className="text-base font-medium text-slate-700">
          {uploadMutation.isPending ? 'Uploading…' : 'Drop file here or click to browse'}
        </p>
        <p className="text-sm text-slate-400 mt-1">Supports XLSX, CSV, PDF (max 20 MB)</p>
      </div>

      {/* Upload error */}
      {uploadMutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {(uploadMutation.error as Error).message}
        </div>
      )}

      {/* Success — no mapping needed */}
      {uploadResponse && !uploadResponse.needsMapping && uploadResponse.importResult && (
        <ImportResultCard result={uploadResponse.importResult} onDismiss={() => setUploadResponse(null)} />
      )}

      {/* Mapping panel */}
      {uploadResponse && uploadResponse.needsMapping && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <FileText size={16} className="text-blue-500" />
              Column Mapping Required
            </h3>
            <button onClick={() => setUploadResponse(null)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>

          <p className="text-sm text-slate-600">
            This file uses different column names. Map each source column to the corresponding template column.
            Columns left as "— Skip —" will be ignored.
          </p>

          {/* Sample preview */}
          {uploadResponse.sampleRows && uploadResponse.sampleRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    {uploadResponse.headers?.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadResponse.sampleRows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 text-slate-600">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mapping grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {uploadResponse.headers?.map((srcCol) => (
              <div key={srcCol} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                <span className="text-sm font-medium text-slate-700 flex-1 truncate">{srcCol}</span>
                <ArrowRight size={14} className="text-slate-400 shrink-0" />
                <select
                  value={mapping[srcCol] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [srcCol]: e.target.value }))}
                  className="text-sm border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— Skip —</option>
                  {TEMPLATE_COLUMNS.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Week context for JIRA imports */}
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 font-medium">Year</label>
              <input type="number" value={weekYear} onChange={(e) => setWeekYear(Number(e.target.value))}
                className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 font-medium">Week #</label>
              <input type="number" min={1} max={53} value={weekNumber} onChange={(e) => setWeekNumber(Number(e.target.value))}
                className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleApplyMapping}
              disabled={applyMappingMutation.isPending}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-xl transition disabled:opacity-60"
            >
              {applyMappingMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Apply Mapping & Import
            </button>
            <button onClick={() => setUploadResponse(null)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
              Cancel
            </button>
          </div>

          {applyMappingMutation.error && (
            <p className="text-sm text-red-600">{(applyMappingMutation.error as Error).message}</p>
          )}
          {applyMappingMutation.isSuccess && (
            <p className="text-sm text-green-600 flex items-center gap-1"><CheckCircle size={14} /> Import successful!</p>
          )}
        </div>
      )}

      {/* Last import status */}
      {lastResult && !uploadResponse && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-700 mb-4">Last Import Status</h3>
          <LastImportStatus result={lastResult} />
        </div>
      )}

      {/* Supported formats card */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Supported Formats</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-600">
          <FormatCard ext="XLSX / XLS" desc="Template format with 5 sheets (Resources, Projects, CRs, Weekly_Log, Project_Status_Weekly). Data is imported directly." />
          <FormatCard ext="CSV" desc="Single-sheet CSV. Use the column mapper if your CSV is a JIRA export or other custom format." />
          <FormatCard ext="PDF" desc="Text extracted and shown for review. Column mapping panel will appear so you can align PDF table columns to the schema." />
        </div>
      </div>
    </div>
  );
}

function ImportResultCard({ result, onDismiss }: { result: ImportResult; onDismiss: () => void }) {
  const hasErrors = result.errors?.length > 0;
  return (
    <div className={clsx('rounded-2xl border p-5', hasErrors ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200')}>
      <div className="flex items-start justify-between">
        <h4 className={clsx('font-semibold mb-3', hasErrors ? 'text-yellow-800' : 'text-green-800')}>
          {hasErrors ? 'Import completed with warnings' : 'Import successful'}
        </h4>
        <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>
      <LastImportStatus result={result} />
    </div>
  );
}

function LastImportStatus({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-6 text-sm">
        <span className="flex items-center gap-1 text-green-700"><CheckCircle size={14} /> {result.rowsAdded ?? 0} added</span>
        <span className="flex items-center gap-1 text-blue-700"><RefreshCw size={14} /> {result.rowsUpdated ?? 0} updated</span>
        <span className="text-slate-500">{result.rowsSkipped ?? 0} skipped</span>
        {result.importedAt && <span className="text-slate-400 ml-auto">{new Date(result.importedAt).toLocaleString()}</span>}
      </div>
      {result.errors?.length > 0 && (
        <div className="bg-yellow-100 rounded-lg p-3 max-h-40 overflow-y-auto">
          {result.errors.map((e, i) => (
            <p key={i} className="text-xs text-yellow-800 font-mono">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function FormatCard({ ext, desc }: { ext: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <p className="font-semibold text-blue-600 text-xs mb-1">{ext}</p>
      <p className="text-xs text-slate-500">{desc}</p>
    </div>
  );
}
