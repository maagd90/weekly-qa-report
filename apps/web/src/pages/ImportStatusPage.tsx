import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { batchApi } from '../lib/api';
import type { DashboardPayload, ImportRecordCounts, ProjectRecord, ProjectSyncReport, SyncInputResult } from '../lib/api';
import { projectDisplayName } from '../lib/projectDisplay';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

interface ImportStatusPageProps {
  selectedProject: string;
  projects: ProjectRecord[];
  onProjectChange: (projectKey: string) => void;
  onImportedDataChanged?: (dashboard: DashboardPayload | null) => void;
}

const STANDARD_EXPECTED = [
  { ext: 'XLSX', label: 'Test execution export', map: 'result, tester, cycle' },
  { ext: 'XLSX', label: 'JIRA issues export', map: 'Issue Type → Story/Bug' },
];

function expectedFileTypes(projectKey?: string) {
  if (projectKey === 'DLM') return [...STANDARD_EXPECTED, { ext: 'XLSX', label: 'Vendor Portal Bug logs', map: 'daily ODL + production files → merged and phase-separated' }];
  if (projectKey === 'DTTRV') return [STANDARD_EXPECTED[0], { ext: 'XLSX', label: 'Wonder Miles Story/Bug export', map: 'uploaded Jira-style rows → Wonder Miles Export Data tab' }];
  return STANDARD_EXPECTED;
}

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

function totalRecords(counts: ImportRecordCounts): number {
  return counts.executions + counts.stories + counts.bugs + counts.vendorBugs;
}

function projectLabel(project: Pick<ProjectRecord, 'key' | 'name'>): string {
  return project.name === project.key ? projectDisplayName(project.key) : project.name;
}

function statusClass(status: ProjectSyncReport['status']): string {
  if (status === 'Successful') return 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]';
  if (status === 'Partially Successful') return 'border-[#e8d6a8] bg-[#f8f1de] text-[#8f6312]';
  return 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]';
}

function ReconciliationPanel({ report, onDownload }: { report: ProjectSyncReport; onDownload: () => void }) {
  const summary = [
    ['Executions', report.newTotals.executions, report.previousTotals.executions],
    ['Stories', report.newTotals.stories, report.previousTotals.stories],
    ['Bugs', report.newTotals.bugs, report.previousTotals.bugs],
    ['Vendor bugs', report.newTotals.vendorBugs, report.previousTotals.vendorBugs],
  ] as const;
  return (
    <QaSection
      title="Import reconciliation"
      subtitle={`${projectLabel(report.project)} (${report.project.key}) · job ${report.id}`}
      className="mt-[22px]"
      headerRight={<button type="button" onClick={onDownload} className="font-mono-qa text-[10px] uppercase tracking-wider border border-qa-ink px-3 py-2 bg-white cursor-pointer">Download CSV</button>}
    >
      <div className={clsx('border p-3 text-sm mb-4', statusClass(report.status))}>
        <strong>{report.status}</strong> · {report.filesProcessed} file{report.filesProcessed === 1 ? '' : 's'} processed · {report.durationMs.toLocaleString()} ms
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 m-0 mb-5 text-[12px]">
        <div><dt className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Started</dt><dd className="m-0 mt-1">{new Date(report.startedAt).toLocaleString()}</dd></div>
        <div><dt className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Completed</dt><dd className="m-0 mt-1">{new Date(report.completedAt).toLocaleString()}</dd></div>
        <div><dt className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Initiated by</dt><dd className="m-0 mt-1">{report.initiatedBy}</dd></div>
        <div><dt className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Total records</dt><dd className="m-0 mt-1">{totalRecords(report.previousTotals).toLocaleString()} → {totalRecords(report.newTotals).toLocaleString()}</dd></div>
      </dl>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {summary.map(([label, current, previous]) => <div key={label} className="border border-qa-border p-3"><div className="font-mono-qa text-[10px] uppercase text-qa-muted-light">{label}</div><div className="font-spectral text-xl font-semibold mt-1">{current.toLocaleString()}</div><div className="text-[10px] text-qa-muted-light">Previous {previous.toLocaleString()} · Change {current - previous >= 0 ? '+' : ''}{(current - previous).toLocaleString()}</div></div>)}
      </div>
      <div className="overflow-x-auto border border-qa-border">
        <table className="w-full min-w-[1120px] text-left text-[11px] border-collapse">
          <thead className="bg-[#f7f5ef] font-mono-qa uppercase tracking-wide"><tr>{['File', 'Type / sheet', 'Found', 'Imported', 'Created', 'Updated', 'Duplicate / skipped', 'Rejected', 'Validation'].map((header) => <th key={header} className="px-3 py-2 border-b border-qa-border">{header}</th>)}</tr></thead>
          <tbody>{report.files.map((file) => <tr key={file.fileId} className="align-top border-t border-qa-border first:border-t-0">
            <td className="px-3 py-2 font-semibold max-w-[220px] break-all">{file.filename}</td>
            <td className="px-3 py-2">{file.detectedType}<div className="text-qa-muted-light">{file.sheet || 'Not detected'}</div></td>
            <td className="px-3 py-2">{file.totalRowsFound.toLocaleString()}</td><td className="px-3 py-2">{file.successfullyImportedRows.toLocaleString()}</td><td className="px-3 py-2">{file.createdRecords.toLocaleString()}</td><td className="px-3 py-2">{file.updatedRecords.toLocaleString()}</td><td className="px-3 py-2">{file.duplicateOrSkippedRows.toLocaleString()}</td><td className="px-3 py-2">{file.rejectedRows.toLocaleString()}</td>
            <td className="px-3 py-2 max-w-[330px]">{file.errors.length === 0 && file.warnings.length === 0 && file.rejections.length === 0 ? <span className="text-[#2f6a48]">No issues</span> : <ul className="m-0 pl-4 space-y-1">{file.errors.map((message) => <li key={`e-${message}`} className="text-[#a13d2c]">{message}</li>)}{file.warnings.map((message) => <li key={`w-${message}`} className="text-[#8f6312]">{message}</li>)}{file.rejections.slice(0, 5).map((rejection) => <li key={`r-${rejection.rowNumber}-${rejection.reference}`} className="text-[#a13d2c]">Row {rejection.rowNumber} · {rejection.reference}: {rejection.reason}</li>)}{file.rejections.length > 5 && <li className="text-qa-muted">+{file.rejections.length - 5} more in the CSV report</li>}</ul>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </QaSection>
  );
}

export function ImportStatusPage({ selectedProject, projects, onProjectChange, onImportedDataChanged }: ImportStatusPageProps) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [lastReconciliation, setLastReconciliation] = useState<ProjectSyncReport | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => projects.find((project) => project.key === selectedProject) || null, [projects, selectedProject]);
  const expectedFiles = useMemo(() => expectedFileTypes(selected?.key), [selected?.key]);

  useEffect(() => {
    setLastReconciliation(null);
    setDownloadError('');
  }, [selected?.id]);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['input-files', selected?.id || 'none'],
    queryFn: () => selected ? batchApi.listInputFiles(selected.id) : Promise.resolve([]),
    enabled: Boolean(selected),
    refetchInterval: selected ? 15_000 : false,
  });

  const invalidateData = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['input-files', selected?.id] }),
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
    queryClient.invalidateQueries({ queryKey: ['wonder-miles-imports'] }),
    queryClient.invalidateQueries({ queryKey: ['report'] }),
  ]);

  const publishImportedData = async (result: SyncInputResult) => {
    setLastReconciliation(result.reconciliation);
    onImportedDataChanged?.(result.dashboard ?? null);
    await invalidateData();
  };

  const uploadMutation = useMutation({
    mutationFn: async (selectedFiles: File[]) => {
      if (!selected) throw new Error('Select one project before uploading files.');
      const uploads = await Promise.all(selectedFiles.map((file) => batchApi.upload(selected.id, file)));
      const sync = await batchApi.syncInputFiles(selected.id, { project: selected.key });
      return { uploads, sync };
    },
    onSuccess: async ({ sync }) => publishImportedData(sync),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['input-files', selected?.id] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('All Projects cannot run an imported-data sync. Select one project first.');
      return batchApi.syncInputFiles(selected.id, { project: selected.key });
    },
    onSuccess: publishImportedData,
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => {
      if (!selected) throw new Error('Select one project before removing an imported file.');
      return batchApi.deleteInputFile(selected.id, fileId);
    },
    onSuccess: publishImportedData,
  });

  const handleFiles = useCallback((selectedFiles: FileList | File[]) => {
    const next = Array.from(selectedFiles);
    if (selected && next.length && !uploadMutation.isPending) uploadMutation.mutate(next);
  }, [selected, uploadMutation]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (selected) handleFiles(e.dataTransfer.files);
  };

  const downloadReconciliation = async () => {
    if (!lastReconciliation || !selected) return;
    setDownloadError('');
    try { await batchApi.downloadImportReconciliation(selected.id, lastReconciliation.id); }
    catch { setDownloadError('Could not download the reconciliation report.'); }
  };

  return (
    <QaPageShell title="Import Data" intro="File upload and imported-data sync are available only for one selected project. All Projects is an aggregate dashboard and live-connection scope only.">
      <QaSection title="Project selection" subtitle="Only the selected project's files are listed and processed" className="mb-[22px]">
        <div className="max-w-xl">
          <label className="text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">Project<select value={selected?.key || 'all'} onChange={(event) => { setLastReconciliation(null); onProjectChange(event.target.value); }} className="block w-full mt-1.5 border border-qa-ink bg-white px-3 py-2.5 text-[13px] normal-case font-sans"><option value="all">All Projects — import disabled</option>{projects.map((project) => <option key={project.id} value={project.key}>{projectLabel(project)} ({project.key})</option>)}</select></label>
          {!projects.length && <div className="mt-3 p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">No projects exist yet. Open Settings to create the first project.</div>}
        </div>
      </QaSection>

      {!selected ? <QaSection title="Select one project to import" subtitle="All Projects cannot own files or run an imported-data sync">
        <div className="border border-[#e6d6b8] bg-[#fff8e8] p-4 text-[13px] text-[#7a5612]">
          <p className="m-0 font-semibold">Import is unavailable while All Projects is selected.</p>
          <p className="mb-0 mt-1.5">Choose a specific project above. Its upload area, owned file list, remove actions, and automatic imported-data synchronization will then become available. Live Jira/QMetry synchronization for all projects remains available in Settings.</p>
        </div>
      </QaSection> : <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px] items-start">
        <div>
          <div onDragOver={(event) => { event.preventDefault(); if (selected && !uploadMutation.isPending) setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} onClick={() => selected && !uploadMutation.isPending && fileInputRef.current?.click()} className={clsx('border-2 border-dashed p-10 text-center transition mb-5', selected && !uploadMutation.isPending ? 'cursor-pointer hover:border-qa-ink hover:bg-[#faf8f2]' : 'cursor-not-allowed opacity-60', isDragging ? 'border-qa-ink bg-[#faf8f2]' : 'border-qa-border-mid')}>
            <div className="text-3xl text-qa-muted-pale mb-3">↓</div><p className="text-qa-ink font-semibold m-0">{uploadMutation.isPending ? 'Uploading, synchronizing, and refreshing tabs…' : selected ? `Drop files for ${projectLabel(selected)} here or click to browse` : 'Select a project before uploading'}</p><p className="text-xs text-qa-muted-light mt-1 m-0">Max 20 MB each · .xlsx / .xls · uploads sync automatically</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ''; }} />
          </div>
          <div className="mb-4 flex items-center gap-2"><button type="button" onClick={() => syncMutation.mutate()} disabled={!selected || uploadMutation.isPending || syncMutation.isPending || files.length === 0} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{syncMutation.isPending ? 'Syncing…' : 'Re-sync imported data'}</button><span className="text-[11.5px] text-qa-muted-light">{selected ? `Uploads sync automatically; use this to rebuild ${projectLabel(selected)} from its existing files.` : 'Select a project to continue.'}</span></div>
          {uploadMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(uploadMutation.error as Error).message}</div>}
          {uploadMutation.isSuccess && uploadMutation.data.sync.reconciliation.status !== 'Failed' && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">{uploadMutation.data.uploads.length} file{uploadMutation.data.uploads.length === 1 ? '' : 's'} uploaded and synchronized for {selected ? projectLabel(selected) : 'the selected project'}. Dashboard tabs have been refreshed.</div>}
          {uploadMutation.isSuccess && uploadMutation.data.sync.reconciliation.status === 'Failed' && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">The file upload completed, but no rows could be imported. Review the reconciliation details below for header, sheet, date, or row-validation errors.</div>}
          {syncMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(syncMutation.error as Error).message}</div>}
          {deleteMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(deleteMutation.error as Error).message}</div>}
          {downloadError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{downloadError}</div>}
          <QaSection title="Expected file types"><ul className="m-0 p-0 list-none space-y-2">{expectedFiles.map((file) => <li key={file.label} className="flex items-start gap-2 text-[13px]"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-0.5 shrink-0" style={{ background: extColor(file.ext) }}>{file.ext}</span><span><strong>{file.label}</strong> — {file.map}</span></li>)}</ul></QaSection>
        </div>
        <div>
          <QaSection title={`Project files (${files.length})`} subtitle={!selected ? 'No project selected' : isLoading ? 'Loading selected project…' : files.length ? `${projectLabel(selected)} files only` : `No files in ${projectLabel(selected)}`} noPadding>
            {files.length === 0 ? <div className="py-10 text-center text-[13px] text-qa-muted-light">{selected ? 'No files staged for this project' : 'Choose a project to view its files'}</div> : <div>{files.map((file) => <div key={file.id} className="flex items-center gap-3 px-[22px] py-3 border-t border-[#f0ede5] first:border-t-0"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-1 shrink-0" style={{ background: extColor('XLSX') }}>XLSX</span><div className="flex-1 min-w-0"><p className="text-[13px] font-semibold m-0 truncate">{file.originalName}</p><p className="font-mono-qa text-[10px] text-qa-muted-light m-0 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {new Date(file.uploadedAt).toLocaleString()} · {file.status}{typeof file.rows === 'number' ? ` · ${file.rows} rows` : ''}</p></div><button type="button" onClick={() => deleteMutation.mutate(file.id)} disabled={deleteMutation.isPending} className="font-mono-qa text-[10px] text-qa-muted-light hover:text-[#C24533] border-none bg-transparent cursor-pointer disabled:opacity-50">Remove</button></div>)}</div>}
          </QaSection>
          <QaSection title="Column mapping" className="mt-[22px]"><p className="text-[11.5px] text-qa-muted-light m-0 mb-3">{MAPPING_ROWS.length} fields auto-mapped on parse</p><div className="space-y-1.5">{MAPPING_ROWS.map((mapping) => <div key={mapping.source} className="flex justify-between text-[12.5px] py-1 border-b border-[#f3f0e8] last:border-0"><span className="font-mono-qa text-qa-muted">{mapping.source}</span><span className="text-qa-ink">{mapping.target}</span></div>)}</div></QaSection>
        </div>
      </div>
      {lastReconciliation && <ReconciliationPanel report={lastReconciliation} onDownload={downloadReconciliation} />}
      </>}
    </QaPageShell>
  );
}
