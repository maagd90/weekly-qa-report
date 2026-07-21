import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { batchApi } from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

interface ProjectDefinition {
  key: string;
  name: string;
  active: boolean;
  createdAt: string;
}

interface StagedFile {
  name: string;
  originalName?: string;
  size: number;
  modifiedAt: string;
  project?: string;
  assignedAt?: string;
}

interface ProjectBreakdown {
  project: string;
  projectName: string;
  executions: number;
  issues: number;
  bugs: number;
  stories: number;
  vendorBugs: number;
}

interface ImportSummary {
  ok: boolean;
  rowCounts: { executions: number; issues: number; uat: number };
  projectBreakdown: ProjectBreakdown[];
  files: Array<{
    name: string;
    ext: string;
    project: string;
    projectName: string;
    assignedProject: string;
    rows: number;
    status: string;
    detectedType?: string;
  }>;
  warnings?: string[];
  parsedAt?: string;
}

interface SyncResult extends ImportSummary {
  rebuilt?: boolean;
}

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed: HTTP ${response.status}`);
  return payload as T;
}

async function listProjects(): Promise<ProjectDefinition[]> {
  return fetchJson<ProjectDefinition[]>('/api/projects');
}

async function createProject(input: { key: string; name: string }): Promise<ProjectDefinition> {
  const result = await fetchJson<{ ok: boolean; project: ProjectDefinition }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return result.project;
}

async function listProjectFiles(): Promise<StagedFile[]> {
  return fetchJson<StagedFile[]>('/api/project-import/files');
}

async function uploadAgainstProject(input: { file: File; project: string }): Promise<unknown> {
  if (!input.project) throw new Error('Select a project before uploading a file.');
  const form = new FormData();
  form.append('file', input.file);
  form.append('project', input.project);
  return fetchJson('/api/project-upload', { method: 'POST', body: form });
}

async function getImportSummary(): Promise<ImportSummary> {
  return fetchJson<ImportSummary>('/api/project-import/summary');
}

async function syncImports(): Promise<SyncResult> {
  await batchApi.syncInputFiles();
  return getImportSummary();
}

export function ImportStatusPage() {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<ProjectDefinition[]>({
    queryKey: ['project-registry'],
    queryFn: listProjects,
  });

  const { data: files = [], isLoading } = useQuery<StagedFile[]>({
    queryKey: ['project-input-files'],
    queryFn: listProjectFiles,
    refetchInterval: 15_000,
  });

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      setSelectedProject(project.key);
      setProjectKey('');
      setProjectName('');
      await queryClient.invalidateQueries({ queryKey: ['project-registry'] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadAgainstProject,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['input-files'] }),
      ]);
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncImports,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['settings-dashboard-projects'] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: batchApi.deleteInputFile,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['input-files'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['settings-dashboard-projects'] }),
      ]);
    },
  });

  const handleFile = useCallback((file: File) => {
    uploadMutation.mutate({ file, project: selectedProject });
  }, [selectedProject, uploadMutation]);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleCreateProject = () => {
    createProjectMutation.mutate({ key: projectKey.trim(), name: projectName.trim() });
  };

  return (
    <QaPageShell
      title="Import Data"
      intro="Create or select a project first, then upload Excel files against that project. Sync shows exactly what was parsed for every project instead of only aggregate totals."
    >
      <QaSection title="1. Select project" subtitle="Every uploaded file is explicitly assigned to one project before parsing." className="mb-[22px]">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted block mb-1">Existing project</span>
            <select
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              className="w-full border border-qa-border-mid px-3 py-2 bg-white text-[13px]"
              disabled={projectsLoading}
            >
              <option value="">Select project…</option>
              {projects.filter((project) => project.active !== false).map((project) => (
                <option key={project.key} value={project.key}>{project.name} ({project.key})</option>
              ))}
            </select>
          </label>
          <div className="hidden lg:block text-qa-muted-light pb-2">or</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted block mb-1">New project key</span>
              <input value={projectKey} onChange={(event) => setProjectKey(event.target.value)} placeholder="e.g. DP" className="w-full border border-qa-border-mid px-3 py-2 text-[13px]" />
            </label>
            <label className="block">
              <span className="font-mono-qa text-[10px] uppercase tracking-wider text-qa-muted block mb-1">Project name</span>
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. WonderMiles" className="w-full border border-qa-border-mid px-3 py-2 text-[13px]" />
            </label>
          </div>
          <button
            type="button"
            onClick={handleCreateProject}
            disabled={createProjectMutation.isPending || !projectKey.trim() || !projectName.trim()}
            className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-white text-qa-ink disabled:opacity-50"
          >
            {createProjectMutation.isPending ? 'Creating…' : 'Create project'}
          </button>
        </div>
        {createProjectMutation.isError && <div className="mt-3 p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">{(createProjectMutation.error as Error).message}</div>}
      </QaSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px] items-start">
        <div>
          <QaSection title="2. Upload file" subtitle={selectedProject ? `Files will be assigned to ${projects.find((project) => project.key === selectedProject)?.name || selectedProject}.` : 'Select a project before uploading.'}>
            <div
              onDragOver={(event) => { event.preventDefault(); if (selectedProject) setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => { if (selectedProject) fileInputRef.current?.click(); }}
              className={clsx('border-2 border-dashed p-10 text-center transition mb-5', selectedProject ? 'cursor-pointer' : 'cursor-not-allowed opacity-50', isDragging ? 'border-qa-ink bg-[#faf8f2]' : 'border-qa-border-mid hover:border-qa-ink hover:bg-[#faf8f2]')}
            >
              <div className="text-3xl text-qa-muted-pale mb-3">↓</div>
              <p className="text-qa-ink font-semibold m-0">Drop Excel file here or click to browse</p>
              <p className="text-xs text-qa-muted-light mt-1 m-0">Max 20 MB · .xlsx / .xls</p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFile(file); event.target.value = ''; }} />
            </div>

            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || files.length === 0}
                className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-4 py-2 border border-qa-ink bg-qa-ink text-[#F5F3ED] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncMutation.isPending ? 'Syncing…' : 'Sync imported data'}
              </button>
              <span className="text-[11.5px] text-qa-muted-light">{files.length ? 'Parses all staged files using their assigned projects.' : 'Upload at least one file to sync.'}</span>
            </div>

            {uploadMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(uploadMutation.error as Error).message}</div>}
            {uploadMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">File staged successfully against {selectedProject}. Click Sync imported data to update the dashboard.</div>}
            {syncMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">{(syncMutation.error as Error).message}</div>}
            {deleteMutation.isError && <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm mb-4">Remove failed</div>}
            {deleteMutation.isSuccess && <div className="p-3 border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48] text-sm mb-4">File removed and dashboard data refreshed</div>}
          </QaSection>

          {syncMutation.data && (
            <QaSection title="Latest import reconciliation" subtitle={syncMutation.data.parsedAt ? `Parsed ${new Date(syncMutation.data.parsedAt).toLocaleString()}` : undefined} className="mt-[22px]" noPadding>
              <div className="grid grid-cols-3 border-b border-[#eeeae1]">
                <div className="p-4"><div className="font-mono-qa text-[10px] uppercase text-qa-muted">Executions</div><div className="text-2xl font-semibold">{syncMutation.data.rowCounts.executions}</div></div>
                <div className="p-4 border-l border-[#eeeae1]"><div className="font-mono-qa text-[10px] uppercase text-qa-muted">Issues</div><div className="text-2xl font-semibold">{syncMutation.data.rowCounts.issues}</div></div>
                <div className="p-4 border-l border-[#eeeae1]"><div className="font-mono-qa text-[10px] uppercase text-qa-muted">Vendor bugs</div><div className="text-2xl font-semibold">{syncMutation.data.rowCounts.uat}</div></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead><tr className="text-left bg-[#faf8f2]"><th className="p-3">Project</th><th className="p-3 text-right">Executions</th><th className="p-3 text-right">Issues</th><th className="p-3 text-right">Bugs</th><th className="p-3 text-right">Stories</th><th className="p-3 text-right">Vendor bugs</th></tr></thead>
                  <tbody>{syncMutation.data.projectBreakdown.map((row) => <tr key={row.project} className="border-t border-[#eeeae1]"><td className="p-3 font-semibold">{row.projectName} <span className="font-mono-qa text-[10px] text-qa-muted">({row.project})</span></td><td className="p-3 text-right">{row.executions}</td><td className="p-3 text-right">{row.issues}</td><td className="p-3 text-right">{row.bugs}</td><td className="p-3 text-right">{row.stories}</td><td className="p-3 text-right">{row.vendorBugs}</td></tr>)}</tbody>
                </table>
              </div>
              {syncMutation.data.warnings?.length ? <div className="p-4 border-t border-[#eeeae1] text-[11.5px] text-[#8a6428]">{syncMutation.data.warnings.join(' · ')}</div> : null}
            </QaSection>
          )}

          <QaSection title="Expected file types" className="mt-[22px]">
            <ul className="m-0 p-0 list-none space-y-2">
              {EXPECTED.map((file) => <li key={file.label} className="flex items-start gap-2 text-[13px]"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-0.5 shrink-0" style={{ background: extColor(file.ext) }}>{file.ext}</span><span><strong>{file.label}</strong> — {file.map}</span></li>)}
            </ul>
          </QaSection>
        </div>

        <div>
          <QaSection title={`Staged files (${files.length})`} subtitle={isLoading ? 'Loading…' : files.length ? `${files.length} project-assigned file(s)` : 'No files yet'} noPadding>
            {files.length === 0 ? <div className="py-10 text-center text-[13px] text-qa-muted-light">No files staged yet</div> : <div>{files.map((file) => <div key={file.name} className="flex items-center gap-3 px-[22px] py-3 border-t border-[#f0ede5] first:border-t-0"><span className="font-mono-qa text-[10px] font-semibold text-white px-1.5 py-1 shrink-0" style={{ background: extColor('XLSX') }}>XLSX</span><div className="flex-1 min-w-0"><p className="text-[13px] font-semibold m-0 truncate">{file.originalName || file.name}</p><p className="font-mono-qa text-[10px] text-qa-muted-light m-0 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {new Date(file.modifiedAt).toLocaleString()} · Project: {projects.find((project) => project.key === file.project)?.name || file.project || 'Unassigned'}</p></div><button type="button" onClick={() => deleteMutation.mutate(file.name)} disabled={deleteMutation.isPending} className="font-mono-qa text-[10px] text-qa-muted-light hover:text-[#C24533] border-none bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-wait">{deleteMutation.isPending ? 'Removing…' : 'Remove'}</button></div>)}</div>}
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
