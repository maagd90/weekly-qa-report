import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { batchApi } from '../lib/api';
import type {
  DashboardPayload,
  ImportRecordCounts,
  ProjectColumnConfig,
  ProjectColumnType,
  ProjectFileRecord,
  ProjectRecord,
  ProjectSyncReport,
  SyncInputResult,
} from '../lib/api';
import { projectDisplayName } from '../lib/projectDisplay';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

interface ImportStatusPageProps {
  selectedProject: string;
  projects: ProjectRecord[];
  onImportedDataChanged?: (dashboard: DashboardPayload | null) => void;
}

const STANDARD_EXPECTED = [
  { ext: 'XLSX', label: 'Test execution export', map: 'result, tester, cycle' },
  { ext: 'XLSX', label: 'JIRA issues export', map: 'Issue Type → Story/Bug' },
];

function expectedFileTypes(project?: ProjectRecord | null) {
  if (project?.capabilities.vendorPortal) return [...STANDARD_EXPECTED, { ext: 'XLSX', label: 'Vendor Portal Bug logs', map: 'daily ODL + production files → merged and phase-separated' }];
  if (project?.capabilities.wonderMilesExport) return [STANDARD_EXPECTED[0], { ext: 'XLSX', label: 'Wonder Miles Story/Bug export', map: 'uploaded Jira-style rows → Wonder Miles Export Data tab' }];
  return STANDARD_EXPECTED;
}

type MappingDraft = ProjectColumnConfig & { included: boolean };

function extColor(ext: string): string {
  return ({ XLSX: QA.PASS, CSV: QA.NA, PDF: QA.FAIL, JSON: QA.BLOCKED } as Record<string, string>)[ext] || QA.muted;
}

function totalRecords(counts: ImportRecordCounts): number {
  return counts.executions + counts.stories + counts.bugs + counts.vendorBugs + (counts.customRows || 0);
}

function columnKey(header: string, used: Set<string>): string {
  const base = header
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 56) || 'column';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function inferredColumnType(values: string[]): ProjectColumnType {
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  if (!nonEmpty.length) return 'text';
  if (nonEmpty.every((value) => /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value))) return 'date';
  if (nonEmpty.every((value) => Number.isFinite(Number(value.replace(/,/g, ''))))) return 'number';
  if (nonEmpty.every((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value))) return 'boolean';
  return 'text';
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
    ['Custom rows', report.newTotals.customRows || 0, report.previousTotals.customRows || 0],
  ] as const;
  return (
    <QaSection
      title="Import reconciliation"
      subtitle={`${projectLabel(report.project)} (${report.project.key}) · job ${report.id}`}
      className="mt-[22px]"
      headerRight={<button type="button" onClick={onDownload} className="min-h-11 w-full border border-qa-ink bg-white px-3 py-2 font-mono-qa text-[10px] uppercase tracking-wider sm:min-h-0 sm:w-auto">Download CSV</button>}
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {summary.map(([label, current, previous]) => <div key={label} className="border border-qa-border p-3"><div className="font-mono-qa text-[10px] uppercase text-qa-muted-light">{label}</div><div className="font-spectral text-xl font-semibold mt-1">{current.toLocaleString()}</div><div className="text-[10px] text-qa-muted-light">Previous {previous.toLocaleString()} · Change {current - previous >= 0 ? '+' : ''}{(current - previous).toLocaleString()}</div></div>)}
      </div>
      <div className="space-y-3 md:hidden">
        {report.files.map((file) => (
          <article key={file.fileId} className="border border-qa-border bg-white p-4">
            <h4 className="m-0 break-all text-[13px] font-semibold">{file.filename}</h4>
            <p className="mt-1 text-[11px] text-qa-muted">{file.detectedType} · {file.sheet || 'Sheet not detected'}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
              {[
                ['Found', file.totalRowsFound],
                ['Imported', file.successfullyImportedRows],
                ['Created', file.createdRecords],
                ['Updated', file.updatedRecords],
                ['Unchanged', file.unchangedRecords],
                ['Duplicate / skipped', file.duplicateOrSkippedRows],
                ['Rejected', file.rejectedRows],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="font-mono-qa text-[9px] uppercase text-qa-muted-light">{label}</dt>
                  <dd className="m-0 mt-0.5 font-mono-qa text-[12px]">{Number(value).toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 border-t border-qa-border pt-3 text-[11px]">
              {file.errors.length === 0 && file.warnings.length === 0 && file.rejections.length === 0
                ? <span className="text-[#2f6a48]">No validation issues</span>
                : <ul className="m-0 space-y-1 pl-4">{file.errors.map((message) => <li key={`mobile-e-${message}`} className="text-[#a13d2c]">{message}</li>)}{file.warnings.map((message) => <li key={`mobile-w-${message}`} className="text-[#8f6312]">{message}</li>)}{file.rejections.slice(0, 3).map((rejection) => <li key={`mobile-r-${rejection.rowNumber}-${rejection.reference}`} className="text-[#a13d2c]">Row {rejection.rowNumber} · {rejection.reference}: {rejection.reason}</li>)}{file.rejections.length > 3 && <li className="text-qa-muted">+{file.rejections.length - 3} more in the CSV report</li>}</ul>}
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto border border-qa-border md:block">
        <table className="w-full min-w-[1120px] text-left text-[11px] border-collapse">
          <caption className="sr-only">Import reconciliation results by file</caption>
          <thead className="bg-[#f7f5ef] font-mono-qa uppercase tracking-wide"><tr>{['File', 'Type / sheet', 'Found', 'Imported', 'Created', 'Updated', 'Unchanged', 'Duplicate / skipped', 'Rejected', 'Validation'].map((header) => <th key={header} className="px-3 py-2 border-b border-qa-border">{header}</th>)}</tr></thead>
          <tbody>{report.files.map((file) => <tr key={file.fileId} className="align-top border-t border-qa-border first:border-t-0">
            <td className="px-3 py-2 font-semibold max-w-[220px] break-all">{file.filename}</td>
            <td className="px-3 py-2">{file.detectedType}<div className="text-qa-muted-light">{file.sheet || 'Not detected'}</div></td>
            <td className="px-3 py-2">{file.totalRowsFound.toLocaleString()}</td><td className="px-3 py-2">{file.successfullyImportedRows.toLocaleString()}</td><td className="px-3 py-2">{file.createdRecords.toLocaleString()}</td><td className="px-3 py-2">{file.updatedRecords.toLocaleString()}</td><td className="px-3 py-2">{file.unchangedRecords.toLocaleString()}</td><td className="px-3 py-2">{file.duplicateOrSkippedRows.toLocaleString()}</td><td className="px-3 py-2">{file.rejectedRows.toLocaleString()}</td>
            <td className="px-3 py-2 max-w-[330px]">{file.errors.length === 0 && file.warnings.length === 0 && file.rejections.length === 0 ? <span className="text-[#2f6a48]">No issues</span> : <ul className="m-0 pl-4 space-y-1">{file.errors.map((message) => <li key={`e-${message}`} className="text-[#a13d2c]">{message}</li>)}{file.warnings.map((message) => <li key={`w-${message}`} className="text-[#8f6312]">{message}</li>)}{file.rejections.slice(0, 5).map((rejection) => <li key={`r-${rejection.rowNumber}-${rejection.reference}`} className="text-[#a13d2c]">Row {rejection.rowNumber} · {rejection.reference}: {rejection.reason}</li>)}{file.rejections.length > 5 && <li className="text-qa-muted">+{file.rejections.length - 5} more in the CSV report</li>}</ul>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </QaSection>
  );
}

export function ImportStatusPage({ selectedProject, projects, onImportedDataChanged }: ImportStatusPageProps) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [lastReconciliation, setLastReconciliation] = useState<ProjectSyncReport | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [mappingFileId, setMappingFileId] = useState('');
  const [mappingColumns, setMappingColumns] = useState<MappingDraft[]>([]);
  const [uniqueKey, setUniqueKey] = useState('');
  const [mappingDirty, setMappingDirty] = useState(false);
  const [mappingSavedFileId, setMappingSavedFileId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProjectKey, setImportProjectKey] = useState(() => selectedProject === 'all' ? localStorage.getItem('qa-import-project') || '' : selectedProject);
  const effectiveProjectKey = selectedProject === 'all' ? importProjectKey : selectedProject;
  const selected = useMemo(() => projects.find((project) => project.key === effectiveProjectKey) || null, [projects, effectiveProjectKey]);
  const selectedProjectIdRef = useRef<string | undefined>(selected?.id);
  selectedProjectIdRef.current = selected?.id;
  const expectedFiles = useMemo(() => expectedFileTypes(selected), [selected]);

  useEffect(() => {
    if (selectedProject !== 'all') {
      setImportProjectKey(selectedProject);
      return;
    }
    if (!projects.some((project) => project.key === importProjectKey)) setImportProjectKey(projects[0]?.key || '');
  }, [selectedProject, projects, importProjectKey]);

  useEffect(() => {
    if (selectedProject === 'all' && importProjectKey) localStorage.setItem('qa-import-project', importProjectKey);
  }, [selectedProject, importProjectKey]);

  useEffect(() => {
    setLastReconciliation(null);
    setDownloadError('');
    setMappingFileId('');
    setMappingColumns([]);
    setUniqueKey('');
    setMappingDirty(false);
    setMappingSavedFileId('');
  }, [selected?.id]);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['input-files', selected?.id || 'none'],
    queryFn: () => selected ? batchApi.listInputFiles(selected.id) : Promise.resolve([]),
    enabled: Boolean(selected),
    refetchInterval: selected ? 15_000 : false,
  });
  const mappingFile = files.find((file) => file.id === mappingFileId) || null;
  const { data: mappingInspection, isLoading: mappingInspectionLoading, error: mappingInspectionError } = useQuery({
    queryKey: ['input-file-inspection', selected?.id || 'none', mappingFile?.id || 'none'],
    queryFn: () => selected && mappingFile
      ? batchApi.inspectInputFile(selected.id, mappingFile.id)
      : Promise.reject(new Error('Select a file to inspect.')),
    enabled: Boolean(selected && mappingFile),
    retry: false,
  });

  useEffect(() => {
    if (!mappingInspection) return;
    const used = new Set<string>();
    const savedMapping = selected?.tabs
      .find((tab) => tab.id === mappingFile?.tabId)
      ?.mappings.find((mapping) =>
        mapping.version === mappingFile?.mappingVersion
        && mapping.headerSignature === mappingInspection.headerSignature);
    const savedByHeader = new Map(savedMapping?.columns.map((column) => [column.sourceHeader.toLocaleLowerCase(), column]));
    const drafts = mappingInspection.headers.map((header) => {
      const saved = savedByHeader.get(header.toLocaleLowerCase());
      if (saved) {
        used.add(saved.fieldKey);
        return { ...saved, included: true } satisfies MappingDraft;
      }
      return {
        fieldKey: columnKey(header, used),
        sourceHeader: header,
        label: header,
        type: inferredColumnType(mappingInspection.sampleRows.map((row) => row[header] || '')),
        visible: true,
        filterable: true,
        searchable: true,
        required: false,
        included: true,
      } satisfies MappingDraft;
    });
    setMappingColumns(drafts);
    setUniqueKey(savedMapping?.uniqueKey || drafts[0]?.fieldKey || '');
    setMappingDirty(!savedMapping);
    setMappingSavedFileId('');
  }, [mappingFile?.id, mappingFile?.mappingVersion, mappingFile?.tabId, mappingInspection?.headerSignature, selected?.tabs]);

  const invalidateData = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['input-files', selected?.id] }),
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
    queryClient.invalidateQueries({ queryKey: ['wonder-miles-imports'] }),
    queryClient.invalidateQueries({ queryKey: ['report'] }),
  ]);

  const publishImportedData = async (result: SyncInputResult, requestProjectId: string) => {
    if (selectedProjectIdRef.current !== requestProjectId) {
      await invalidateData();
      return;
    }
    setLastReconciliation(result.reconciliation);
    onImportedDataChanged?.(result.dashboard ?? null);
    await invalidateData();
  };

  const uploadMutation = useMutation({
    mutationFn: async (selectedFiles: File[]) => {
      if (!selected) throw new Error('Select one project before uploading files.');
      const uploads = await Promise.all(selectedFiles.map((file) => batchApi.upload(selected.id, file))) as Array<{ file: ProjectFileRecord }>;
      const requiresMapping = uploads.find((upload) => upload.file.mappingStatus === 'required');
      const sync = requiresMapping ? null : await batchApi.syncInputFiles(selected.id, { project: selected.key });
      return { uploads, sync, projectId: selected.id };
    },
    onSuccess: async ({ uploads, sync, projectId }) => {
      if (sync) {
        await publishImportedData(sync, projectId);
      } else {
        const firstRequired = uploads.find((upload) => upload.file.mappingStatus === 'required');
        setMappingFileId(firstRequired?.file.id || '');
        await invalidateData();
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['input-files', selected?.id] }),
  });

  const mappingMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !mappingFile) throw new Error('Select a project file to map.');
      const tab = selected.tabs.find((candidate) => candidate.enabled);
      if (!tab) throw new Error('Enable a dedicated imported-data tab for this project in Settings first.');
      const columns = mappingColumns
        .filter((column) => column.included)
        .map(({ included: _included, ...column }) => column);
      if (!columns.some((column) => column.fieldKey === uniqueKey)) throw new Error('Choose a unique record column from the included mappings.');
      return batchApi.saveInputMapping(selected.id, mappingFile.id, { tabId: tab.id, columns, uniqueKey });
    },
    onSuccess: async (result) => {
      setMappingDirty(false);
      setMappingSavedFileId(result.file.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['input-files', result.project.id] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('All Projects cannot run an imported-data sync. Select one project first.');
      return batchApi.syncInputFiles(selected.id, { project: selected.key }).then((result) => ({ result, projectId: selected.id }));
    },
    onSuccess: async ({ result, projectId }) => {
      await publishImportedData(result, projectId);
      setMappingFileId('');
      setMappingColumns([]);
      setUniqueKey('');
      setMappingDirty(false);
      setMappingSavedFileId('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => {
      if (!selected) throw new Error('Select one project before removing an imported file.');
      return batchApi.deleteInputFile(selected.id, fileId).then((result) => ({ result, projectId: selected.id }));
    },
    onSuccess: ({ result, projectId }) => publishImportedData(result, projectId),
  });

  useEffect(() => {
    uploadMutation.reset();
    syncMutation.reset();
    deleteMutation.reset();
    mappingMutation.reset();
  // Mutation reset functions are stable; project ownership is the reset boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const handleFiles = useCallback((selectedFiles: FileList | File[]) => {
    const next = Array.from(selectedFiles);
    if (selected && next.length && !uploadMutation.isPending) uploadMutation.mutate(next);
  }, [selected, uploadMutation]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (selected) handleFiles(e.dataTransfer.files);
  };

  const pendingMappingCount = files.filter((file) => file.mappingStatus === 'required').length;
  const currentMappingIsSaved = Boolean(
    mappingFile
    && !mappingDirty
    && (mappingFile.mappingStatus === 'mapped' || mappingSavedFileId === mappingFile.id),
  );

  const openFilePicker = () => {
    if (selected && !uploadMutation.isPending) fileInputRef.current?.click();
  };

  const handleUploadKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFilePicker();
  };

  const downloadReconciliation = async () => {
    if (!lastReconciliation || !selected) return;
    setDownloadError('');
    try { await batchApi.downloadImportReconciliation(selected.id, lastReconciliation.id); }
    catch { setDownloadError('Could not download the reconciliation report.'); }
  };

  return (
    <QaPageShell title="Import Data" intro="Files always belong to one project. When the masthead is All Projects, the file-project selector below changes only this page and keeps the portfolio scope unchanged.">
      <QaSection title="File project" subtitle={selectedProject === 'all' ? 'Choose which project files to manage; the masthead remains All Projects' : 'Inherited from the masthead project'} className="mb-[22px]">
        <div className="max-w-xl">
          <label className="text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">Project<select value={selected?.key || ''} disabled={selectedProject !== 'all'} onChange={(event) => { setLastReconciliation(null); setImportProjectKey(event.target.value); }} className="block w-full mt-1.5 border border-qa-ink bg-white px-3 py-2.5 text-[13px] normal-case font-sans disabled:bg-[#f3f0e8]"><option value="">Select project…</option>{projects.map((project) => <option key={project.id} value={project.key}>{projectLabel(project)} ({project.key})</option>)}</select></label>
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
          <div
            role="button"
            tabIndex={selected && !uploadMutation.isPending ? 0 : -1}
            aria-disabled={!selected || uploadMutation.isPending}
            aria-label={selected ? `Upload Excel files for ${projectLabel(selected)}` : 'Select a project before uploading files'}
            onDragOver={(event) => { event.preventDefault(); if (selected && !uploadMutation.isPending) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={openFilePicker}
            onKeyDown={handleUploadKeyDown}
            className={clsx('border-2 border-dashed p-6 text-center transition mb-5 sm:p-10', selected && !uploadMutation.isPending ? 'cursor-pointer hover:border-qa-ink hover:bg-[#faf8f2]' : 'cursor-not-allowed opacity-60', isDragging ? 'border-qa-ink bg-[#faf8f2]' : 'border-qa-border-mid')}
          >
            <div className="text-3xl text-qa-muted-pale mb-3">↓</div><p className="text-qa-ink font-semibold m-0">{uploadMutation.isPending ? 'Uploading and inspecting spreadsheet columns…' : selected ? `Drop files for ${projectLabel(selected)} here or click to browse` : 'Select a project before uploading'}</p><p className="text-xs text-qa-muted-light mt-1 m-0">Max 20 MB each · .xlsx / .xls · recognised layouts import automatically; custom layouts pause for mapping</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ''; }} />
          </div>
          <div className="mb-4 flex items-center gap-2"><button type="button" onClick={() => syncMutation.mutate()} disabled={!selected || uploadMutation.isPending || syncMutation.isPending || files.length === 0 || pendingMappingCount > 0} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{syncMutation.isPending ? 'Importing…' : 'Import Data'}</button><span className="text-[11.5px] text-qa-muted-light">{pendingMappingCount > 0 ? `Map ${pendingMappingCount} staged file${pendingMappingCount === 1 ? '' : 's'} before importing.` : selected ? `Import or rebuild ${projectLabel(selected)} from its staged project files.` : 'Select a project to continue.'}</span></div>
          {uploadMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(uploadMutation.error as Error).message}</div>}
          {uploadMutation.isSuccess && uploadMutation.data.sync && uploadMutation.data.sync.reconciliation.status !== 'Failed' && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">{uploadMutation.data.uploads.length} file{uploadMutation.data.uploads.length === 1 ? '' : 's'} uploaded and synchronized for {selected ? projectLabel(selected) : 'the selected project'}. Dashboard tabs have been refreshed.</div>}
          {uploadMutation.isSuccess && uploadMutation.data.sync?.reconciliation.status === 'Failed' && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">The file upload completed, but no rows could be imported. Review the reconciliation details below for header, sheet, date, or row-validation errors.</div>}
          {uploadMutation.isSuccess && !uploadMutation.data.sync && <div className="p-3 border border-[#e8d6a8] bg-[#f8f1de] text-[#8f6312] text-sm mb-4">The file is staged but not published. Map its sheet columns below, select <strong>Save Mapping</strong>, and then confirm with <strong>Import Data</strong>.</div>}
          {syncMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(syncMutation.error as Error).message}</div>}
          {deleteMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(deleteMutation.error as Error).message}</div>}
          {downloadError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{downloadError}</div>}
          <QaSection title="Expected file types"><ul className="m-0 p-0 list-none space-y-2">{expectedFiles.map((file) => <li key={file.label} className="flex items-start gap-2 text-[13px]"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-0.5 shrink-0" style={{ background: extColor(file.ext) }}>{file.ext}</span><span><strong>{file.label}</strong> — {file.map}</span></li>)}</ul></QaSection>
        </div>
        <div>
          <QaSection title={`Project files (${files.length})`} subtitle={!selected ? 'No project selected' : isLoading ? 'Loading selected project…' : files.length ? `${projectLabel(selected)} files only` : `No files in ${projectLabel(selected)}`} noPadding>
            {files.length === 0 ? <div className="py-10 text-center text-[13px] text-qa-muted-light">{selected ? 'No files staged for this project' : 'Choose a project to view its files'}</div> : <div>{files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 px-[22px] py-3 border-t border-[#f0ede5] first:border-t-0">
                <span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-1 shrink-0" style={{ background: extColor('XLSX') }}>XLSX</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold m-0 truncate">{file.originalName}</p>
                  <p className="font-mono-qa text-[10px] text-qa-muted-light m-0 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {new Date(file.uploadedAt).toLocaleString()} · {file.status}{typeof file.rows === 'number' ? ` · ${file.rows} rows` : ''}</p>
                  {file.mappingStatus === 'required' && <p className="m-0 mt-1 text-[10.5px] text-[#8f6312]">Column mapping required before publication</p>}
                  {file.mappingStatus === 'mapped' && <p className="m-0 mt-1 text-[10.5px] text-[#2f6a48]">Mapped to project tab · profile v{file.mappingVersion}{file.status === 'staged' ? ' · ready to import' : ''}</p>}
                </div>
                {selected.tabs.some((tab) => tab.enabled) && <button type="button" onClick={() => { setMappingFileId(file.id); setMappingDirty(false); setMappingSavedFileId(''); mappingMutation.reset(); }} disabled={mappingMutation.isPending} className="font-mono-qa text-[10px] text-qa-muted hover:text-qa-ink border-none bg-transparent cursor-pointer disabled:opacity-50">{file.mappingStatus === 'mapped' ? 'Remap' : 'Map columns'}</button>}
                <button type="button" onClick={() => deleteMutation.mutate(file.id)} disabled={deleteMutation.isPending} className="font-mono-qa text-[10px] text-qa-muted-light hover:text-[#C24533] border-none bg-transparent cursor-pointer disabled:opacity-50">Remove</button>
              </div>
            ))}</div>}
          </QaSection>
        </div>
      </div>
      <QaSection
        title="Project column mapping"
        subtitle="Map the selected sheet headers, save the reusable project schema, review it, and then explicitly import the staged data."
        className="mt-[22px]"
      >
        {!selected.tabs.some((tab) => tab.enabled) && <div className="border border-[#e6d6b8] bg-[#fff8e8] p-3 text-[13px] text-[#7a5612]">This project has no enabled imported-data tab. Open Settings, enable <strong>Dedicated imported-data tab</strong>, and then return here to create its column mapping.</div>}
        {selected.tabs.some((tab) => tab.enabled) && !mappingFile && <div className="text-[13px] text-qa-muted">Choose <strong>Map columns</strong> beside a staged file. Recognised Jira/QMetry-style files can continue using automatic parsing; custom files must be mapped before they are published.</div>}
        {mappingFile && mappingInspectionLoading && <div role="status" className="py-5 text-[13px] text-qa-muted">Inspecting {mappingFile.originalName}…</div>}
        {mappingFile && mappingInspectionError && <div role="alert" className="border border-[#ecccc2] bg-[#f8ece8] p-3 text-[13px] text-[#a13d2c]">{(mappingInspectionError as Error).message}</div>}
        {mappingFile && mappingInspection && <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-qa-border bg-[#faf8f2] p-3 text-[12px]">
            <div><strong>{mappingFile.originalName}</strong><div className="mt-1 text-qa-muted">{mappingInspection.sheetName} · header row {mappingInspection.headerRow} · {mappingInspection.rowCount.toLocaleString()} data row(s) · {mappingInspection.headers.length} source column(s)</div></div>
            <button type="button" onClick={() => { setMappingFileId(''); setMappingDirty(false); setMappingSavedFileId(''); mappingMutation.reset(); }} className="border border-qa-border bg-white px-3 py-2 font-mono-qa text-[10px] uppercase tracking-wider">Close mapping</button>
          </div>
          <div className="overflow-x-auto border border-qa-border">
            <table className="w-full min-w-[1050px] border-collapse text-left text-[11px]">
              <caption className="sr-only">Project column mapping for {mappingFile.originalName}</caption>
              <thead className="bg-[#f7f5ef] font-mono-qa uppercase tracking-wide">
                <tr>{['Use', 'Source column', 'Project column label', 'Stable field key', 'Type', 'Visible', 'Filter', 'Search', 'Required', 'Sample'].map((header) => <th key={header} className="border-b border-qa-border px-2 py-2">{header}</th>)}</tr>
              </thead>
              <tbody>{mappingColumns.map((column, index) => {
                const update = (patch: Partial<MappingDraft>) => {
                  setMappingDirty(true);
                  setMappingSavedFileId('');
                  mappingMutation.reset();
                  setMappingColumns((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate));
                };
                return <tr key={column.sourceHeader} className="border-t border-qa-border align-middle first:border-t-0">
                  <td className="px-2 py-2"><input aria-label={`Use ${column.sourceHeader}`} type="checkbox" checked={column.included} onChange={(event) => update({ included: event.target.checked })} /></td>
                  <td className="max-w-[180px] break-words px-2 py-2 font-semibold">{column.sourceHeader}</td>
                  <td className="px-2 py-2"><input aria-label={`Project label for ${column.sourceHeader}`} disabled={!column.included} value={column.label} onChange={(event) => update({ label: event.target.value })} className="w-full min-w-[150px] border border-qa-border bg-white px-2 py-1.5 disabled:opacity-50" /></td>
                  <td className="px-2 py-2"><input aria-label={`Field key for ${column.sourceHeader}`} disabled={!column.included} value={column.fieldKey} onChange={(event) => update({ fieldKey: event.target.value.toLocaleLowerCase().replace(/\s+/g, '_') })} className="w-full min-w-[130px] border border-qa-border bg-white px-2 py-1.5 font-mono-qa disabled:opacity-50" /></td>
                  <td className="px-2 py-2"><select aria-label={`Type for ${column.sourceHeader}`} disabled={!column.included} value={column.type} onChange={(event) => update({ type: event.target.value as ProjectColumnType })} className="border border-qa-border bg-white px-2 py-1.5 disabled:opacity-50"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / No</option></select></td>
                  {(['visible', 'filterable', 'searchable', 'required'] as const).map((property) => <td key={property} className="px-2 py-2 text-center"><input aria-label={`${property} ${column.sourceHeader}`} type="checkbox" disabled={!column.included} checked={Boolean(column[property])} onChange={(event) => update({ [property]: event.target.checked })} /></td>)}
                  <td className="max-w-[220px] truncate px-2 py-2 text-qa-muted">{mappingInspection.sampleRows.map((row) => row[column.sourceHeader]).filter(Boolean).slice(0, 2).join(' · ') || '—'}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-end">
            <label className="w-full max-w-sm text-[11px] font-mono-qa uppercase tracking-wide text-qa-muted">Unique record column
              <select value={uniqueKey} onChange={(event) => { setUniqueKey(event.target.value); setMappingDirty(true); setMappingSavedFileId(''); mappingMutation.reset(); }} className="mt-1.5 block w-full border border-qa-ink bg-white px-3 py-2.5 text-[13px] normal-case font-sans">
                <option value="">Select unique column…</option>
                {mappingColumns.filter((column) => column.included).map((column) => <option key={column.fieldKey} value={column.fieldKey}>{column.label} ({column.fieldKey})</option>)}
              </select>
            </label>
            <button type="button" onClick={() => mappingMutation.mutate()} disabled={mappingMutation.isPending || syncMutation.isPending || !mappingDirty || !uniqueKey || !mappingColumns.some((column) => column.included)} className="min-h-11 border border-qa-ink bg-white px-4 py-2 font-mono-qa text-[10px] font-semibold uppercase tracking-wider text-qa-ink disabled:opacity-50">{mappingMutation.isPending ? 'Saving…' : 'Save Mapping'}</button>
            <button type="button" onClick={() => syncMutation.mutate()} disabled={!currentMappingIsSaved || pendingMappingCount > 0 || mappingMutation.isPending || syncMutation.isPending} className="min-h-11 border border-qa-ink bg-qa-ink px-4 py-2 font-mono-qa text-[10px] font-semibold uppercase tracking-wider text-[#F5F3ED] disabled:opacity-50">{syncMutation.isPending ? 'Importing…' : 'Import Data'}</button>
          </div>
          {mappingMutation.isSuccess && currentMappingIsSaved && <div role="status" className="mt-3 border border-[#cfe0d4] bg-[#eef4ef] p-3 text-[13px] text-[#2f6a48]">Mapping profile v{mappingMutation.data.mapping.version} is saved. Review the configuration above, then select <strong>Import Data</strong> to validate and publish the staged rows.</div>}
          {!mappingDirty && mappingFile.mappingStatus === 'mapped' && pendingMappingCount > 0 && <div className="mt-3 border border-[#e8d6a8] bg-[#f8f1de] p-3 text-[13px] text-[#8f6312]">This mapping is ready, but {pendingMappingCount} other staged file{pendingMappingCount === 1 ? ' still requires' : 's still require'} mapping before the project import can run.</div>}
          <p className="mb-0 mt-2 text-[11.5px] text-qa-muted">The unique record column prevents yesterday’s rows from appearing again when today’s file contains the same records. The newest matching row wins inside this project and tab.</p>
          {mappingMutation.isError && <div role="alert" className="mt-3 border border-[#ecccc2] bg-[#f8ece8] p-3 text-[13px] text-[#a13d2c]">{(mappingMutation.error as Error).message}</div>}
        </>}
      </QaSection>
      {lastReconciliation && <ReconciliationPanel report={lastReconciliation} onDownload={downloadReconciliation} />}
      </>}
    </QaPageShell>
  );
}
