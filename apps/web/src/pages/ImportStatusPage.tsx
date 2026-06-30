import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, FileText, Trash2, FolderOpen } from 'lucide-react';
import clsx from 'clsx';
import { batchApi } from '../lib/api';

interface StagedFile {
  name: string;
  size: number;
  modifiedAt: string;
}

const EXPECTED_FILES = [
  'Zephyr export (.xlsx) — test cycle executions',
  'JIRA export (.xlsx) — Stories and Bugs',
  'ODL UAT export (.xlsx) — optional',
];

export function ImportStatusPage() {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
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
          Upload Zephyr, JIRA, or ODL Excel exports to <code className="bg-slate-100 px-1 rounded">input/</code>.
          Or enable JIRA/QMetry in <code className="bg-slate-100 px-1 rounded">config/integrations.json</code>.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-2">Expected file types</p>
        <ul className="list-disc list-inside space-y-1 text-blue-700">
          {EXPECTED_FILES.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition',
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
        )}
      >
        <Upload size={32} className="mx-auto text-slate-400 mb-3" />
        <p className="text-slate-600 font-medium">Drop Excel file here or click to browse</p>
        <p className="text-xs text-slate-400 mt-1">Max 20 MB · .xlsx only</p>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      </div>

      {uploadMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} /> Upload failed
        </div>
      )}
      {uploadMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle size={16} /> File staged successfully
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen size={18} className="text-slate-500" />
          <h3 className="font-semibold text-slate-700">Staged files ({files.length})</h3>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-6 text-center">No files staged yet</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {files.map((f) => (
              <div key={f.name} className="flex items-center gap-3 px-4 py-3">
                <FileText size={16} className="text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{f.name}</p>
                  <p className="text-xs text-slate-400">{(f.size / 1024).toFixed(1)} KB · {new Date(f.modifiedAt).toLocaleString()}</p>
                </div>
                <button onClick={() => deleteMutation.mutate(f.name)} className="text-slate-400 hover:text-red-500 p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
