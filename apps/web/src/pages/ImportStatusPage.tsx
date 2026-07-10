import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { batchApi, getJiraConnections, getQmetryConnections } from '../lib/api';
import { legacyMigrationApi } from '../lib/legacyMigrationApi';
import { listWorkspaces, workspaceDisplayName } from '../lib/workspace';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

interface StagedFile { name: string; size: number; modifiedAt: string; project?: string }
interface SyncResult { ok: boolean; rebuilt: boolean; rowCounts: { executions: number; issues: number; uat: number }; projects?: string[]; warnings?: string[]; error?: string }
interface ImportStatusPageProps { project?: string }

const EXPECTED = [
  { ext: 'XLSX', label: 'Test execution export', map: 'result, tester, cycle' },
  { ext: 'XLSX', label: 'JIRA issues export', map: 'Issue Type → Story/Bug' },
  { ext: 'XLSX', label: 'Vendor Portal Bug log', map: 'auto-detected → Vendor Portal Bugs tab' },
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

function rowCountText(result?: { rowCounts: { executions: number; issues: number; uat: number } }): string {
  if (!result) return '';
  const counts = result.rowCounts;
  return `${counts.executions} executions · ${counts.issues} issues · ${counts.uat} vendor bugs`;
}

export function ImportStatusPage({ project }: ImportStatusPageProps) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedProject = project && project !== 'all' ? project : undefined;
  const workspaces = useMemo(() => listWorkspaces({ jira: getJiraConnections(), qmetry: getQmetryConnections() }), []);
  const projectLabel = workspaceDisplayName(selectedProject, workspaces);
  const projectRequired = !selectedProject;

  const { data: files = [], isLoading } = useQuery<StagedFile[]>({
    queryKey: ['input-files', selectedProject || 'none'],
    queryFn: () => batchApi.listInputFiles(selectedProject),
    refetchInterval: 15_000,
    enabled: Boolean(selectedProject),
  });

  const legacyQuery = useQuery({
    queryKey: ['legacy-input-files'],
    queryFn: legacyMigrationApi.list,
    refetchInterval: 15_000,
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => batchApi.upload(file, selectedProject),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['input-files', selectedProject || 'none'] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => batchApi.syncInputFiles({ project: selectedProject }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['input-files', selectedProject || 'none'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['settings-dashboard-projects'] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => batchApi.deleteInputFile(filename, selectedProject),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['input-files', selectedProject || 'none'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['settings-dashboard-projects'] }),
      ]);
    },
  });

  const migrateMutation = useMutation({
    mutationFn: () => {
      if (!selectedProject) throw new Error('Select a specific workspace first.');
      return legacyMigrationApi.migrate(selectedProject);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['legacy-input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['input-files', selectedProject || 'none'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['settings-dashboard-projects'] }),
      ]);
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!selectedProject) return;
    uploadMutation.mutate(file);
  }, [uploadMutation, selectedProject]);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const legacy = legacyQuery.data;
  const hasLegacyFiles = Boolean(legacy?.count);

  function confirmLegacyMigration(): void {
    if (!selectedProject) return;
    const confirmed = window.confirm(`Move ${legacy?.count || 0} legacy file(s) from data/input into ${projectLabel}? The selected workspace will be rebuilt and stale legacy output will be removed after a successful migration.`);
    if (confirmed) migrateMutation.mutate();
  }

  return (
    <QaPageShell title="Import Data" intro="Upload Excel files into the selected project workspace only. Workspace files and sync cache are isolated.">
      <div className="mb-5 border border-qa-border bg-[#faf8f2] p-3 text-[13px] text-qa-ink">
        <strong>Selected workspace:</strong> {projectRequired ? 'All projects' : projectLabel}
        <div className="text-[11.5px] text-qa-muted-light mt-1">
          {selectedProject ? `Upload target: data/projects/${selectedProject}/input/` : 'Select one specific workspace from the top project dropdown before importing files.'}
        </div>
      </div>

      {(hasLegacyFiles || legacy?.hasLegacyOutput) && (
        <div className="mb-5 border border-[#d9b978] bg-[#fff8e8] p-4 text-[13px] text-qa-ink">
          <div className="font-semibold">Legacy data detected</div>
          <div className="mt-1 text-[12px] text-qa-muted">
            {legacy?.count || 0} file(s) remain in <code>data/input</code>. Existing legacy output contains {rowCountText(legacy)}.
          </div>
          {hasLegacyFiles ? (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={confirmLegacyMigration}
                disabled={projectRequired || migrateMutation.isPending}
                className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {migrateMutation.isPending ? 'Migrating…' : 'Move legacy files to selected workspace'}
              </button>
              <span className="text-[11.5px] text-qa-muted-light">
                {projectRequired ? 'Select the correct workspace before migration.' : `Target: ${projectLabel}. Files move only after confirmation.`}
              </span>
            </div>
          ) : (
            <div className="mt-2 text-[11.5px] text-qa-muted-light">Legacy output exists without legacy input files. It remains available under All projects and is not modified automatically.</div>
          )}
        </div>
      )}

      {migrateMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">Migration failed: {(migrateMutation.error as Error).message}</div>}
      {migrateMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">Migration completed · {migrateMutation.data.migrated.length} file(s) moved to {projectLabel} · {rowCountText(migrateMutation.data)}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px] items-start">
        <div>
          <div
            onDragOver={(event) => { event.preventDefault(); if (!projectRequired) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={projectRequired ? undefined : handleDrop}
            onClick={() => { if (!projectRequired) fileInputRef.current?.click(); }}
            className={clsx('border-2 border-dashed p-10 text-center transition mb-5', projectRequired ? 'border-qa-border-mid bg-[#f6f3eb] opacity-60 cursor-not-allowed' : isDragging ? 'border-qa-ink bg-[#faf8f2] cursor-pointer' : 'border-qa-border-mid hover:border-qa-ink hover:bg-[#faf8f2] cursor-pointer')}
          >
            <div className="text-3xl text-qa-muted-pale mb-3">↓</div>
            <p className="text-qa-ink font-semibold m-0">{projectRequired ? 'Select a workspace before upload' : 'Drop Excel file here or click to browse'}</p>
            <p className="text-xs text-qa-muted-light mt-1 m-0">Max 20 MB · .xlsx / .xls</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={projectRequired} onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFile(file); event.target.value = ''; }} />
          </div>

          <div className="mb-4 flex items-center gap-2">
            <button type="button" onClick={() => syncMutation.mutate()} disabled={projectRequired || syncMutation.isPending || files.length === 0} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{syncMutation.isPending ? 'Syncing…' : 'Sync imported data'}</button>
            <span className="text-[11.5px] text-qa-muted-light">{projectRequired ? 'Select one workspace first.' : files.length ? `Runs parser/batch sync for ${projectLabel} only.` : 'Upload at least one file to sync.'}</span>
          </div>

          {uploadMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">Upload failed: {(uploadMutation.error as Error).message}</div>}
          {uploadMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">File staged for {projectLabel}. Click Sync imported data to update dashboard.</div>}
          {syncMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(syncMutation.error as Error).message}</div>}
          {syncMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">Sync completed · {rowCountText(syncMutation.data)}</div>}
          {deleteMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">Remove failed: {(deleteMutation.error as Error).message}</div>}
          {deleteMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">File removed and {projectLabel} dashboard data refreshed</div>}

          <QaSection title="Expected file types">
            <ul className="m-0 p-0 list-none space-y-2">
              {EXPECTED.map((file) => <li key={file.label} className="flex items-start gap-2 text-[13px]"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-0.5 shrink-0" style={{ background: extColor(file.ext) }}>{file.ext}</span><span><strong>{file.label}</strong> — {file.map}</span></li>)}
            </ul>
          </QaSection>
        </div>

        <div>
          <QaSection title={`Staged files (${files.length})`} subtitle={projectRequired ? 'Select a workspace to view staged files' : isLoading ? 'Loading…' : files.length ? `${files.length} ${projectLabel} file(s)` : `No ${projectLabel} files yet`} noPadding>
            {files.length === 0 ? <div className="py-10 text-center text-[13px] text-qa-muted-light">{projectRequired ? 'No workspace selected' : 'No files staged for this workspace'}</div> : <div>{files.map((file) => <div key={file.name} className="flex items-center gap-3 px-[22px] py-3 border-t border-[#f0ede5] first:border-t-0"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-1 shrink-0" style={{ background: extColor('XLSX') }}>XLSX</span><div className="flex-1 min-w-0"><p className="text-[13px] font-semibold m-0 truncate">{file.name}</p><p className="font-mono-qa text-[10px] text-qa-muted-light m-0 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {new Date(file.modifiedAt).toLocaleString()} · {projectLabel}</p></div><button type="button" onClick={() => deleteMutation.mutate(file.name)} disabled={deleteMutation.isPending} className="font-mono-qa text-[10px] text-qa-muted-light hover:text-[#C24533] border-none bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-wait">{deleteMutation.isPending ? 'Removing…' : 'Remove'}</button></div>)}</div>}
          </QaSection>

          <QaSection title="Column mapping" className="mt-[22px]">
            <p className="text-[11.5px] text-qa-muted-light m-0 mb-3">{MAPPING_ROWS.length} fields auto-mapped on parse</p>
            <div className="space-y-1.5">{MAPPING_ROWS.map((mapping) => <div key={mapping.source} className="flex justify-between text-[12.5px] py-1 border-b border-[#f3f0e8] last:border-0"><span className="font-mono-qa text-qa-muted">{mapping.source}</span><span className="text-qa-ink">{mapping.target}</span></div>)}</div>
          </QaSection>
        </div>
      </div>
    </QaPageShell>
  );
}
