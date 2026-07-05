import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { batchApi } from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

interface StagedFile {
  name: string;
  size: number;
  modifiedAt: string;
}

const EXPECTED = [
  { ext: 'XLSX', label: 'Test execution export', map: 'result, tester, cycle' },
  { ext: 'XLSX', label: 'JIRA issues export', map: 'Issue Type → Story/Bug' },
  { ext: 'XLSX', label: 'ODL UAT issue log', map: 'auto-detected → UAT tab' },
];

const MAPPING_ROWS = [
  { source: 'Issue Type', target: 'work_item_type (Story / Bug)' },
  { source: 'Status', target: 'issue_status' },
  { source: 'Priority', target: 'severity' },
  { source: 'Testcase Execution Result', target: 'result' },
  { source: 'Executed By', target: 'tester' },
  { source: 'Test Cycle Summary', target: 'cycle' },
  { source: 'Assignee', target: 'defect_owner' },
];

function extColor(ext: string): string {
  return ({ XLSX: QA.PASS, CSV: QA.NA, PDF: QA.FAIL, JSON: QA.BLOCKED } as Record<string, string>)[ext] || QA.muted;
}

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
    <QaPageShell
      title="Import Data"
      intro="No JIRA API needed — drop one Excel export per project. Each file is detected by format and parsed when you generate a report or refresh the dashboard."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px] items-start">
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={clsx('border-2 border-dashed p-10 text-center cursor-pointer transition mb-5', isDragging ? 'border-qa-ink bg-[#faf8f2]' : 'border-qa-border-mid hover:border-qa-ink hover:bg-[#faf8f2]')}
          >
            <div className="text-3xl text-qa-muted-pale mb-3">↓</div>
            <p className="text-qa-ink font-semibold m-0">Drop Excel file here or click to browse</p>
            <p className="text-xs text-qa-muted-light mt-1 m-0">Max 20 MB · .xlsx / .xls</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </div>
          {uploadMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">Upload failed</div>}
          {uploadMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">File staged successfully</div>}
          <QaSection title="Expected file types">
            <ul className="m-0 p-0 list-none space-y-2">
              {EXPECTED.map((f) => <li key={f.label} className="flex items-start gap-2 text-[13px]"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-0.5 shrink-0" style={{ background: extColor(f.ext) }}>{f.ext}</span><span><strong>{f.label}</strong> — {f.map}</span></li>)}
            </ul>
          </QaSection>
        </div>
        <div>
          <QaSection title={`Staged files (${files.length})`} subtitle={isLoading ? 'Loading…' : files.length ? `${files.length} file(s) in input/` : 'No files yet'} noPadding>
            {files.length === 0 ? <div className="py-10 text-center text-[13px] text-qa-muted-light">No files staged yet</div> : <div>{files.map((f) => <div key={f.name} className="flex items-center gap-3 px-[22px] py-3 border-t border-[#f0ede5] first:border-t-0"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-1 shrink-0" style={{ background: extColor('XLSX') }}>XLSX</span><div className="flex-1 min-w-0"><p className="text-[13px] font-semibold m-0 truncate">{f.name}</p><p className="font-mono-qa text-[10px] text-qa-muted-light m-0 mt-0.5">{(f.size / 1024).toFixed(1)} KB · {new Date(f.modifiedAt).toLocaleString()} · staged</p></div><button type="button" onClick={() => deleteMutation.mutate(f.name)} className="font-mono-qa text-[10px] text-qa-muted-light hover:text-[#C24533] border-none bg-transparent cursor-pointer">Remove</button></div>)}</div>}
          </QaSection>
          <QaSection title="Column mapping" className="mt-[22px]">
            <p className="text-[11.5px] text-qa-muted-light m-0 mb-3">{MAPPING_ROWS.length} fields auto-mapped on parse</p>
            <div className="space-y-1.5">{MAPPING_ROWS.map((m) => <div key={m.source} className="flex justify-between text-[12.5px] py-1 border-b border-[#f3f0e8] last:border-0"><span className="font-mono-qa text-qa-muted">{m.source}</span><span className="text-qa-ink">{m.target}</span></div>)}</div>
          </QaSection>
        </div>
      </div>
    </QaPageShell>
  );
}
