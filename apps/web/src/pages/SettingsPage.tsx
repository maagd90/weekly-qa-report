import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
import type { LlmProvider, LlmSelectionInput, ProjectRecord, ReportBranding, SyncInputResult } from '../lib/api';
import {
  batchApi,
  getJiraConnections,
  setJiraConnections,
  getQmetryConnections,
  setQmetryConnections,
  newConnectionId,
  getUserLlmSelection,
  setUserLlmSelection,
  getUserLlmKey,
  getReportBranding,
  setReportBranding,
  LLM_MODELS,
  LLM_PROVIDER_LABELS,
  LLM_OFFICIAL_BASE_URLS,
} from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';
import { userFacingWarnings } from '../lib/userFacingWarnings';

const fieldClass = 'w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa';
const labelClass = 'block text-[10.5px] font-mono-qa uppercase tracking-wide text-qa-muted-light mb-1';
const MAX_LOGO_BYTES = 1_500_000;

function projectSourceKeys(project: ProjectRecord): string[] {
  return [...new Set([project.key, ...(project.sourceKeys || [])].map((key) => key.trim().toUpperCase()).filter(Boolean))];
}

function jiraProjectJql(projectKeys: string[]): string {
  const scope = projectKeys.length === 1 ? `project = ${projectKeys[0]}` : `project in (${projectKeys.join(', ')})`;
  return `${scope} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
}

function parseSourceKeys(value: string): string[] {
  return [...new Set(value.split(/[,/\s]+/).map((key) => key.trim().toUpperCase()).filter(Boolean))];
}

function jqlProjectKeys(jql: string): string[] {
  const equals = jql.match(/\bproject\s*=\s*(?:["']([^"']+)["']|([A-Z0-9_-]+))/i);
  if (equals) return [(equals[1] || equals[2]).trim().toUpperCase()];
  const inside = jql.match(/\bproject\s+in\s*\(([^)]+)\)/i)?.[1];
  return inside ? parseSourceKeys(inside.replace(/["']/g, '')) : [];
}

function validateProjectJql(jql: string | undefined, projectKeys: string[]): string {
  const normalized = (jql || '').trim() || jiraProjectJql(projectKeys);
  const configured = jqlProjectKeys(normalized);
  const allowed = new Set(projectKeys);
  if (configured.length !== projectKeys.length || configured.some((key) => !allowed.has(key))) {
    throw new Error(`JIRA JQL must be scoped to all configured source keys: ${projectKeys.join(', ')}.`);
  }
  return normalized;
}

function rewriteProjectJql(jql: string | undefined, previousKeys: string[], nextKeys: string[]): string {
  const current = (jql || '').trim() || jiraProjectJql(previousKeys);
  const nextScope = nextKeys.length === 1 ? `project = ${nextKeys[0]}` : `project in (${nextKeys.join(', ')})`;
  const projectClause = /\bproject\s*(?:=\s*(?:["'][^"']+["']|[A-Z0-9_-]+)|in\s*\([^)]+\))/i;
  return projectClause.test(current) ? current.replace(projectClause, nextScope) : jiraProjectJql(nextKeys);
}

type TestResult = { ok: boolean; count?: number; executions?: number; issues?: number; uat?: number; error?: string };

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div><label className={labelClass}>{label}</label><input className={fieldClass} {...props} /></div>;
}

function SyncBox({ label, note, checked, disabled, onChange }: { label: string; note?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`inline-flex items-start gap-2 text-[12.5px] text-qa-ink ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#b95c00]" /><span><span className="font-semibold">{label}</span>{note && <span className="block text-[11px] text-qa-muted-light mt-0.5">{note}</span>}</span></label>;
}

function DeploymentBox({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return <label className="inline-flex items-center gap-2 text-[12.5px] text-qa-ink"><input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onSelect(); }} className="h-4 w-4 accent-[#b95c00]" /><span className="font-semibold">{label}</span></label>;
}

function blankJiraConnection(project: ProjectRecord): JiraConnectionInput {
  const sourceKeys = projectSourceKeys(project);
  return { id: newConnectionId(), workspaceProjectId: project.id, workspaceProjectKey: project.key, name: `${project.key} JIRA`, baseUrl: '', enabled: true, syncIssues: true, deploymentType: 'on-prem', authType: 'basic', email: '', username: '', apiToken: '', credential: '', cookie: '', jiraSessionId: '', jiraXsrfToken: '', searchPath: '/rest/api/2/search', projectKeys: sourceKeys, jql: jiraProjectJql(sourceKeys), applicationCiFieldId: '' };
}

function blankQmetryConnection(project: ProjectRecord): QmetryConnectionInput {
  return { id: newConnectionId(), workspaceProjectId: project.id, workspaceProjectKey: project.key, name: `${project.key} QMetry`, baseUrl: '', enabled: true, syncExecutions: true, email: '', apiToken: '', credential: '', sessionHeader: '', sessionId: '', xsrfToken: '', projectKey: project.key, projectId: '', folderId: '', cycleIds: [] };
}

function jiraProject(conn: JiraConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => projectSourceKeys(project).some((key) => conn.projectKeys?.map((value) => value.trim().toUpperCase()).includes(key)));
}

function qmetryProject(conn: QmetryConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => projectSourceKeys(project).includes(conn.projectKey?.trim().toUpperCase()));
}

function JiraConnectionCard({ conn, onChange, project }: { conn: JiraConnectionInput; onChange: (next: JiraConnectionInput) => void; project: ProjectRecord }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const selectedProject = project;
  const enabled = conn.enabled !== false;
  const syncIssues = conn.syncIssues !== false;
  const deploymentType = conn.deploymentType || 'on-prem';
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('jira', { ...conn, enabled, syncIssues, deploymentType }), onSuccess: (r) => setTestResult(r) });

  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="flex flex-wrap gap-5 mb-4 p-3 border border-qa-border bg-white">
        <SyncBox label="Enable this JIRA connection" checked={enabled} onChange={(checked) => onChange({ ...conn, enabled: checked })} />
        <SyncBox label="Sync JIRA tickets / bugs & stories" note="Required for story, bug, defect, assignee, and traceability metrics." checked={syncIssues} disabled={!enabled} onChange={(checked) => onChange({ ...conn, syncIssues: checked })} />
      </div>
      <div className="mb-4 p-3 border border-qa-border bg-white">
        <div className="font-mono-qa text-[10.5px] uppercase tracking-wide text-qa-muted-light mb-2">JIRA deployment type</div>
        <div className="flex flex-wrap gap-5">
          <DeploymentBox label="On-premises" checked={deploymentType === 'on-prem'} onSelect={() => onChange({ ...conn, deploymentType: 'on-prem', authType: 'basic' })} />
          <DeploymentBox label="On-cloud / JIRA Cloud" checked={deploymentType === 'cloud'} onSelect={() => onChange({ ...conn, deploymentType: 'cloud', authType: 'basic' })} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2">
        <Field label="Dashboard project" value={`${selectedProject.key} — ${selectedProject.name}`} readOnly />
        <Field label="JIRA source project keys" value={projectSourceKeys(selectedProject).join(', ')} readOnly />
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label={deploymentType === 'cloud' ? 'Email / Username' : 'Username'} value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value, username: e.target.value })} />
        <Field label={deploymentType === 'cloud' ? 'API token / Auth value' : 'Auth value'} type={showSecret ? 'text' : 'password'} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="REST search path" value={conn.searchPath || '/rest/api/2/search'} onChange={(e) => onChange({ ...conn, searchPath: e.target.value })} />
        <Field label="Application CI field" placeholder="customfield_12345" value={conn.applicationCiFieldId || ''} onChange={(e) => onChange({ ...conn, applicationCiFieldId: e.target.value })} />
        <Field label="Session header" type={showSecret ? 'text' : 'password'} value={conn.cookie || ''} onChange={(e) => onChange({ ...conn, cookie: e.target.value })} />
        <Field label="Session ID" type={showSecret ? 'text' : 'password'} value={conn.jiraSessionId || ''} onChange={(e) => onChange({ ...conn, jiraSessionId: e.target.value })} />
        <Field label="Security token" type={showSecret ? 'text' : 'password'} value={conn.jiraXsrfToken || ''} onChange={(e) => onChange({ ...conn, jiraXsrfToken: e.target.value })} />
      </div>
      <label className={labelClass}>Project-scoped JQL</label>
      <textarea className="w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[82px]" value={conn.jql || ''} onChange={(event) => onChange({ ...conn, jql: event.target.value })} />
      <p className="text-[10.5px] text-qa-muted-light mt-1 mb-0">Editable for testing custom filters. The project clause must include every configured source key: <code>{projectSourceKeys(selectedProject).join(', ')}</code>.</p>
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test JIRA'}</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}</div>
    </div>
  );
}

function QmetryConnectionCard({ conn, onChange, project }: { conn: QmetryConnectionInput; onChange: (next: QmetryConnectionInput) => void; project: ProjectRecord }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const enabled = conn.enabled !== false;
  const syncExecutions = conn.syncExecutions !== false;
  const selectedProject = project;
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('qmetry', { ...conn, enabled, syncExecutions, cycleIds: [] }), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <p className="text-[12px] text-qa-muted m-0 mb-3">QMetry provides test-execution and cycle data only. Add a matching JIRA connection for the same project if you need stories, bugs, defects, and traceability.</p>
      <div className="flex flex-wrap gap-5 mb-4 p-3 border border-qa-border bg-white">
        <SyncBox label="Enable this QMetry connection" checked={enabled} onChange={(checked) => onChange({ ...conn, enabled: checked, cycleIds: [] })} />
        <SyncBox label="Sync test executions / cycles" checked={syncExecutions} disabled={!enabled} onChange={(checked) => onChange({ ...conn, syncExecutions: checked, cycleIds: [] })} />
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2">
        <Field label="Dashboard project" value={`${selectedProject.key} — ${selectedProject.name}`} readOnly />
        <div><label className={labelClass}>QMetry project key</label><select className={fieldClass} value={conn.projectKey} onChange={(event) => onChange({ ...conn, projectKey: event.target.value, cycleIds: [] })}>{projectSourceKeys(selectedProject).map((key) => <option key={key} value={key}>{key}</option>)}</select></div>
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value })} />
        <Field label="Auth value" type={showSecret ? 'text' : 'password'} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="Project ID" placeholder="19703" value={conn.projectId || ''} onChange={(e) => onChange({ ...conn, projectId: e.target.value, cycleIds: [] })} />
        <Field label="Folder ID" placeholder="96225" value={conn.folderId || ''} onChange={(e) => onChange({ ...conn, folderId: e.target.value, cycleIds: [] })} />
        <Field label="Session header" type={showSecret ? 'text' : 'password'} value={conn.sessionHeader || ''} onChange={(e) => onChange({ ...conn, sessionHeader: e.target.value, cycleIds: [] })} />
        <Field label="Session ID" type={showSecret ? 'text' : 'password'} value={conn.sessionId || ''} onChange={(e) => onChange({ ...conn, sessionId: e.target.value, cycleIds: [] })} />
        <Field label="Security token" type={showSecret ? 'text' : 'password'} value={conn.xsrfToken || ''} onChange={(e) => onChange({ ...conn, xsrfToken: e.target.value, cycleIds: [] })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test QMetry'}</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} test cycles found)` : testResult.error}</span>}</div>
    </div>
  );
}

function normalizedConnectionsForSave(
  jiraConnections: JiraConnectionInput[],
  qmetryConnections: QmetryConnectionInput[],
  projects: ProjectRecord[],
): { jira: JiraConnectionInput[]; qmetry: QmetryConnectionInput[]; removed: string[] } {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const removed: string[] = [];
  const normalizeJira = (connections: JiraConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.flatMap((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || jiraProject(connection, projects);
      if (!project) {
        removed.push(`${connection.name || connection.projectKeys?.[0] || 'Unnamed'} JIRA`);
        return [];
      }
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a JIRA connection. Only one JIRA connection is allowed per project.`);
      assigned.add(project.id);
      const sourceKeys = projectSourceKeys(project);
      return [{ ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, deploymentType: connection.deploymentType || 'on-prem', projectKeys: sourceKeys, jql: validateProjectJql(connection.jql, sourceKeys) }];
    });
  };
  const normalizeQmetry = (connections: QmetryConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.flatMap((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || qmetryProject(connection, projects);
      if (!project) {
        removed.push(`${connection.name || connection.projectKey || 'Unnamed'} QMetry`);
        return [];
      }
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a QMetry connection. Only one QMetry connection is allowed per project.`);
      assigned.add(project.id);
      const selectedSourceKey = projectSourceKeys(project).includes(connection.projectKey?.trim().toUpperCase()) ? connection.projectKey.trim().toUpperCase() : project.key;
      return [{ ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKey: selectedSourceKey, cycleIds: [] }];
    });
  };
  return { jira: normalizeJira(jiraConnections), qmetry: normalizeQmetry(qmetryConnections), removed };
}

interface SettingsPageProps {
  selectedProject: string;
  onProjectChange: (projectKey: string) => void;
}

export function SettingsPage({ selectedProject: selectedProjectKey, onProjectChange }: SettingsPageProps) {
  const queryClient = useQueryClient();
  const initialLlm = getUserLlmSelection();
  const initialProvider = (initialLlm.provider || 'template') as LlmProvider;
  const initialBranding = getReportBranding();
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(initialProvider);
  const [llmModel, setLlmModel] = useState(initialLlm.model || LLM_MODELS[initialProvider][0]);
  const [llmApiKey, setLlmApiKey] = useState(initialLlm.apiKey || getUserLlmKey(initialProvider));
  const [llmBaseUrl, setLlmBaseUrl] = useState(initialLlm.baseUrl || '');
  const [llmUseCustomEndpoint, setLlmUseCustomEndpoint] = useState(Boolean(initialLlm.baseUrl) || initialProvider === 'openai-compatible');
  const [reportBranding, setReportBrandingState] = useState<ReportBranding>(initialBranding);
  const [logoUploadMsg, setLogoUploadMsg] = useState<string | null>(null);
  const [llmTestMsg, setLlmTestMsg] = useState<string | null>(null);
  const [jiraConnections, setJiraConnectionsState] = useState<JiraConnectionInput[]>(getJiraConnections());
  const [qmetryConnections, setQmetryConnectionsState] = useState<QmetryConnectionInput[]>(getQmetryConnections().map((c) => ({ ...c, cycleIds: [] })));
  const [narrativeSavedMsg, setNarrativeSavedMsg] = useState<string | null>(null);
  const [brandingSavedMsg, setBrandingSavedMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [newProjectKey, setNewProjectKey] = useState('');
  const [newProjectSourceKeys, setNewProjectSourceKeys] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [projectDrafts, setProjectDrafts] = useState<Record<string, { key: string; sourceKeys: string; name: string }>>({});
  const [projectMessage, setProjectMessage] = useState<string | null>(null);

  const { refetch } = useQuery({ queryKey: ['integrations'], queryFn: batchApi.getIntegrations });
  const { data: projectsData, isLoading: projectsLoading } = useQuery({ queryKey: ['projects'], queryFn: batchApi.listProjects, retry: false });
  const projects = projectsData || [];
  const selectedProject = projects.find((project) => project.key === selectedProjectKey) || null;
  const allProjectsSelected = !selectedProjectKey || selectedProjectKey === 'all';
  const selectedJiraConnection = useMemo(() => selectedProject
    ? jiraConnections.find((connection) => jiraProject(connection, projects)?.id === selectedProject.id) || blankJiraConnection(selectedProject)
    : null, [jiraConnections, projects, selectedProject]);
  const selectedQmetryConnection = useMemo(() => selectedProject
    ? qmetryConnections.find((connection) => qmetryProject(connection, projects)?.id === selectedProject.id) || blankQmetryConnection(selectedProject)
    : null, [qmetryConnections, projects, selectedProject]);
  const { data: cycles, refetch: loadCycles, isFetching: cyclesFetching, isFetched: cyclesFetched } = useQuery({ queryKey: ['cycles-folders', selectedQmetryConnection?.id || 'none'], queryFn: () => batchApi.getCycleFolders(selectedQmetryConnection?.id), retry: false, enabled: false });

  useEffect(() => setConnectionError(null), [selectedProject?.id]);

  useEffect(() => {
    if (!projectsData) return;
    setProjectDrafts(Object.fromEntries(projectsData.map((project) => [project.id, { key: project.key, sourceKeys: projectSourceKeys(project).filter((key) => key !== project.key).join(', '), name: project.name }])));
    try {
      const normalized = normalizedConnectionsForSave(jiraConnections, qmetryConnections, projectsData);
      setJiraConnectionsState(normalized.jira);
      setQmetryConnectionsState(normalized.qmetry);
      setJiraConnections(normalized.jira);
      setQmetryConnections(normalized.qmetry);
      if (normalized.removed.length) {
        setConnectionNotice(`Removed orphaned saved connection${normalized.removed.length === 1 ? '' : 's'}: ${normalized.removed.join(', ')}. Connections never create dashboard projects automatically; create the missing project explicitly if it is still required.`);
      }
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection validation failed.');
    }
    // Reconcile browser-owned connections only when the server project registry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsData]);

  const customEndpointSelected = llmProvider !== 'template' && (llmProvider === 'openai-compatible' || llmUseCustomEndpoint);
  const customModelAllowed = customEndpointSelected;
  const officialBaseUrl = LLM_OFFICIAL_BASE_URLS[llmProvider];

  function currentLlmSelection(): LlmSelectionInput {
    return {
      provider: llmProvider,
      model: llmModel.trim() || undefined,
      apiKey: llmProvider === 'template' ? undefined : llmApiKey.trim() || undefined,
      baseUrl: llmProvider === 'template' ? undefined : customEndpointSelected ? llmBaseUrl.trim() || undefined : undefined,
    };
  }
  function selectedProjectFilter() { return selectedProject ? { project: selectedProject.key } : {}; }

  function updateSelectedJira(next: JiraConnectionInput) {
    if (!selectedProject) return;
    setConnectionError(null);
    setJiraConnectionsState((current) => {
      const index = current.findIndex((connection) => jiraProject(connection, projects)?.id === selectedProject.id);
      const sourceKeys = projectSourceKeys(selectedProject);
      const scoped = { ...next, workspaceProjectId: selectedProject.id, workspaceProjectKey: selectedProject.key, projectKeys: sourceKeys, jql: next.jql ?? jiraProjectJql(sourceKeys) };
      if (index < 0) return [...current, scoped];
      return current.map((connection, currentIndex) => currentIndex === index ? scoped : connection);
    });
  }

  function updateSelectedQmetry(next: QmetryConnectionInput) {
    if (!selectedProject) return;
    setConnectionError(null);
    setQmetryConnectionsState((current) => {
      const index = current.findIndex((connection) => qmetryProject(connection, projects)?.id === selectedProject.id);
      const selectedSourceKey = projectSourceKeys(selectedProject).includes(next.projectKey) ? next.projectKey : selectedProject.key;
      const scoped = { ...next, workspaceProjectId: selectedProject.id, workspaceProjectKey: selectedProject.key, projectKey: selectedSourceKey, cycleIds: [] };
      if (index < 0) return [...current, scoped];
      return current.map((connection, currentIndex) => currentIndex === index ? scoped : connection);
    });
  }
  function saveNarrativeProvider() {
    setUserLlmSelection(currentLlmSelection());
    setNarrativeSavedMsg('Narrative provider saved.');
    setTimeout(() => setNarrativeSavedMsg(null), 3500);
  }
  function saveBranding() {
    setReportBranding(reportBranding);
    setBrandingSavedMsg('Report branding saved.');
    setTimeout(() => setBrandingSavedMsg(null), 3500);
  }
  function saveConnections(): boolean {
    try {
      const normalized = normalizedConnectionsForSave(jiraConnections, qmetryConnections, projects);
      setJiraConnections(normalized.jira);
      setQmetryConnections(normalized.qmetry);
      setJiraConnectionsState(normalized.jira);
      setQmetryConnectionsState(normalized.qmetry);
      setConnectionError(null);
      const removedMessage = normalized.removed.length ? ` Removed orphaned connection${normalized.removed.length === 1 ? '' : 's'}: ${normalized.removed.join(', ')}.` : '';
      setSavedMsg(selectedProject ? `${selectedProject.key} connections saved. This project has one JIRA slot and one QMetry slot.${removedMessage}` : `Connections saved.${removedMessage}`);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-init'] });
      setTimeout(() => setSavedMsg(null), 3500);
      return true;
    } catch (err) {
      setSavedMsg(null);
      setConnectionError(err instanceof Error ? err.message : 'Connection validation failed.');
      return false;
    }
  }

  const createProject = useMutation({
    mutationFn: () => batchApi.createProject({ key: newProjectKey, sourceKeys: [newProjectKey, ...parseSourceKeys(newProjectSourceKeys)], name: newProjectName }),
    onSuccess: async (project) => {
      setNewProjectKey('');
      setNewProjectSourceKeys('');
      setNewProjectName('');
      setProjectMessage(`${project.key} created. Select it from the main Project dropdown to configure JIRA, QMetry, or import files.`);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      onProjectChange('all');
    },
  });
  const updateProject = useMutation({
    mutationFn: ({ project, draft }: { project: ProjectRecord; draft: { key: string; sourceKeys: string; name: string } }) => batchApi.updateProject(project.id, { key: draft.key, sourceKeys: [draft.key, ...parseSourceKeys(draft.sourceKeys)], name: draft.name }),
    onSuccess: async (project, variables) => {
      const nextProjects = projects.map((candidate) => candidate.id === project.id ? project : candidate);
      const previousSourceKeys = projectSourceKeys(variables.project);
      const nextSourceKeys = projectSourceKeys(project);
      const nextJira = jiraConnections.map((connection) => jiraProject(connection, projects)?.id === project.id
        ? { ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKeys: nextSourceKeys, jql: rewriteProjectJql(connection.jql, previousSourceKeys, nextSourceKeys) }
        : connection);
      const nextQmetry = qmetryConnections.map((connection) => qmetryProject(connection, projects)?.id === project.id
        ? { ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKey: nextSourceKeys.includes(connection.projectKey) ? connection.projectKey : project.key, cycleIds: [] }
        : connection);
      const normalized = normalizedConnectionsForSave(nextJira, nextQmetry, nextProjects);
      setJiraConnections(normalized.jira);
      setQmetryConnections(normalized.qmetry);
      setJiraConnectionsState(normalized.jira);
      setQmetryConnectionsState(normalized.qmetry);
      setProjectMessage(`${project.key} updated.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
      ]);
    },
  });
  const deleteProject = useMutation({
    mutationFn: (project: ProjectRecord) => batchApi.deleteProject(project.id, project.key),
    onSuccess: async (deletion) => {
      const deletedSourceKeys = new Set(projectSourceKeys(deletion.project));
      const remainingJira = jiraConnections.filter((connection) => connection.workspaceProjectId !== deletion.project.id && !connection.projectKeys?.some((key) => deletedSourceKeys.has(key.trim().toUpperCase())));
      const remainingQmetry = qmetryConnections.filter((connection) => connection.workspaceProjectId !== deletion.project.id && !deletedSourceKeys.has(connection.projectKey?.trim().toUpperCase()));
      setJiraConnections(remainingJira);
      setQmetryConnections(remainingQmetry);
      setJiraConnectionsState(remainingJira);
      setQmetryConnectionsState(remainingQmetry);
      setProjectMessage(`${deletion.project.key} deleted with ${deletion.filesDeleted} imported file${deletion.filesDeleted === 1 ? '' : 's'} and ${deletion.syncReportsDeleted} reconciliation report${deletion.syncReportsDeleted === 1 ? '' : 's'}.`);
      onProjectChange('all');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
        queryClient.invalidateQueries({ queryKey: ['input-files'] }),
      ]);
    },
  });
  const testMutation = useMutation({ mutationFn: () => batchApi.testIntegrations(selectedProjectFilter()), onSuccess: () => refetch() });
  const syncLiveMutation = useMutation({ mutationFn: () => batchApi.syncLiveData(selectedProjectFilter()), onSuccess: async () => { await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }), queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['report'] })]); } });
  const llmTest = useMutation({ mutationFn: () => batchApi.testLlm(currentLlmSelection()), onSuccess: (data) => setLlmTestMsg(data.ok ? (data.provider === 'template' ? `Ready - ${data.providerLabel || LLM_PROVIDER_LABELS[llmProvider]} / ${data.model}; no network required` : `Connected - ${data.providerLabel || LLM_PROVIDER_LABELS[llmProvider]} / ${data.model}`) : data.error || 'Narrative provider validation failed'), onError: (err: Error) => setLlmTestMsg(err.message) });
  const testResult = testMutation.data as TestResult | undefined;
  const syncResult = syncLiveMutation.data as SyncInputResult | undefined;
  const syncWarnings = userFacingWarnings(syncResult?.warnings);

  function changeLlmProvider(provider: LlmProvider) {
    setLlmProvider(provider);
    setLlmModel(LLM_MODELS[provider][0]);
    setLlmApiKey(getUserLlmKey(provider));
    setLlmUseCustomEndpoint(provider === 'openai-compatible');
    setLlmBaseUrl('');
    setLlmTestMsg(null);
  }
  function changeEndpointMode(mode: 'official' | 'custom') {
    if (llmProvider === 'openai-compatible' || llmProvider === 'template') return;
    setLlmUseCustomEndpoint(mode === 'custom');
    if (mode === 'official') setLlmBaseUrl('');
    setLlmTestMsg(null);
  }
  function saveAndTestLlm() {
    if (customEndpointSelected && !llmBaseUrl.trim()) {
      setLlmTestMsg('Enter the custom base URL before testing the LLM connection.');
      return;
    }
    if (!llmModel.trim()) {
      setLlmTestMsg('Enter or select a model before testing the LLM connection.');
      return;
    }
    saveNarrativeProvider();
    llmTest.mutate();
  }
  function handleLogoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setLogoUploadMsg('Please select a PNG, JPG, SVG, or WebP image file.'); event.target.value = ''; return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoUploadMsg('Logo file is too large. Please use an optimized image under 1.5 MB.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { const dataUrl = String(reader.result || ''); setReportBrandingState({ ...reportBranding, logoUrl: dataUrl, logoAlt: reportBranding.logoAlt || file.name.replace(/\.[^.]+$/, '') }); setLogoUploadMsg(`Selected ${file.name}. Click Save branding to keep it.`); };
    reader.onerror = () => setLogoUploadMsg('Could not read the selected logo file. Please try another image.');
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function confirmProjectDeletion(project: ProjectRecord) {
    const confirmed = window.confirm(`Delete ${project.name} (${project.key})?\n\nThis permanently removes the project, its uploaded files, imported and live cached data, reconciliation reports, and saved browser connections. This action cannot be undone.`);
    if (confirmed) deleteProject.mutate(project);
  }

  const syncCounts = syncResult?.rowCounts;

  return (
    <QaPageShell title="Settings" intro="Create and manage logical dashboard projects, map one or more JIRA/QMetry source keys to each project, then configure its single JIRA and QMetry connections. Import Data only accepts files for an existing selected project.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        {allProjectsSelected && <QaSection title="Project management" subtitle="Visible only in All Projects. Create, update, or delete dashboard projects here." className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 items-end lg:grid-cols-[minmax(140px,0.55fr)_minmax(210px,0.8fr)_minmax(220px,1fr)_auto]">
            <Field label="New project key" placeholder="e.g. ACE" maxLength={32} value={newProjectKey} onChange={(event) => setNewProjectKey(event.target.value.toUpperCase())} />
            <Field label="Additional source keys" placeholder="e.g. DP, DTTRV" value={newProjectSourceKeys} onChange={(event) => setNewProjectSourceKeys(event.target.value.toUpperCase())} />
            <Field label="New project name" placeholder="e.g. ACE Backoffice" maxLength={100} value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
            <button type="button" onClick={() => createProject.mutate()} disabled={createProject.isPending || newProjectKey.trim().length < 2 || newProjectName.trim().length < 2} className="font-mono-qa text-[10px] uppercase tracking-wider border border-qa-ink bg-white px-4 py-2.5 cursor-pointer disabled:opacity-50">{createProject.isPending ? 'Creating…' : 'Create project'}</button>
          </div>
          <div className="mt-5 space-y-3">
            {projects.map((project) => {
              const draft = projectDrafts[project.id] || { key: project.key, sourceKeys: projectSourceKeys(project).filter((key) => key !== project.key).join(', '), name: project.name };
              const draftKeys = [...new Set([draft.key.trim().toUpperCase(), ...parseSourceKeys(draft.sourceKeys)])].filter(Boolean).sort();
              const currentKeys = [...projectSourceKeys(project)].sort();
              const changed = draft.key.trim().toUpperCase() !== project.key || draft.name.trim() !== project.name || draftKeys.join('|') !== currentKeys.join('|');
              return <div key={project.id} className="border border-qa-border bg-[#faf8f2] p-3.5">
                <div className="grid grid-cols-1 gap-3 items-end lg:grid-cols-[minmax(130px,0.5fr)_minmax(190px,0.75fr)_minmax(220px,1fr)_auto_auto]">
                  <Field label="Project key" maxLength={32} value={draft.key} onChange={(event) => setProjectDrafts((current) => ({ ...current, [project.id]: { ...draft, key: event.target.value.toUpperCase() } }))} />
                  <Field label="Additional source keys" placeholder="e.g. DP, DTTRV" value={draft.sourceKeys} onChange={(event) => setProjectDrafts((current) => ({ ...current, [project.id]: { ...draft, sourceKeys: event.target.value.toUpperCase() } }))} />
                  <Field label="Project name" maxLength={100} value={draft.name} onChange={(event) => setProjectDrafts((current) => ({ ...current, [project.id]: { ...draft, name: event.target.value } }))} />
                  <button type="button" onClick={() => updateProject.mutate({ project, draft })} disabled={updateProject.isPending || !changed || draft.key.trim().length < 2 || draft.name.trim().length < 2} className="font-mono-qa text-[10px] uppercase tracking-wider border border-qa-ink bg-white px-4 py-2.5 cursor-pointer disabled:opacity-50">{updateProject.isPending && updateProject.variables?.project.id === project.id ? 'Updating…' : 'Update project'}</button>
                  <button type="button" onClick={() => confirmProjectDeletion(project)} disabled={deleteProject.isPending} className="font-mono-qa text-[10px] uppercase tracking-wider border border-[#a13d2c] text-[#a13d2c] bg-white px-4 py-2.5 cursor-pointer disabled:opacity-50">{deleteProject.isPending && deleteProject.variables?.id === project.id ? 'Deleting…' : 'Delete project'}</button>
                </div>
                <p className="m-0 mt-2 text-[11.5px] text-qa-muted">Sources: {projectSourceKeys(project).join(', ')} · {project.fileCount || 0} imported file{project.fileCount === 1 ? '' : 's'} · created {new Date(project.createdAt).toLocaleString()}. Rows from every configured source key are consolidated under {project.key}.</p>
              </div>;
            })}
            {!projectsLoading && !projects.length && <div className="p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">No dashboard projects exist yet. Create the first project above.</div>}
          </div>
          {projectsLoading && <p className="text-[12px] text-qa-muted mt-3">Loading projects...</p>}
          {createProject.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(createProject.error as Error).message}</div>}
          {updateProject.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(updateProject.error as Error).message}</div>}
          {deleteProject.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(deleteProject.error as Error).message}</div>}
          {projectMessage && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{projectMessage}</div>}
        </QaSection>}
        <QaSection title="Narrative Provider">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Select a network-backed language model or the deterministic template provider.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-2.5">
            <div><label className={labelClass}>Provider</label><select className={fieldClass} value={llmProvider} onChange={(e) => changeLlmProvider(e.target.value as LlmProvider)}>{(Object.keys(LLM_PROVIDER_LABELS) as LlmProvider[]).map((p) => <option key={p} value={p}>{LLM_PROVIDER_LABELS[p]}</option>)}</select></div>
            {llmProvider !== 'template' && <div><label className={labelClass}>Endpoint</label><select className={fieldClass} value={customEndpointSelected ? 'custom' : 'official'} disabled={llmProvider === 'openai-compatible'} onChange={(e) => changeEndpointMode(e.target.value as 'official' | 'custom')}><option value="official">Official API</option><option value="custom">Custom URL</option></select></div>}
            {llmProvider !== 'template' && <div><label className={labelClass}>Model</label>{customModelAllowed ? <input className={fieldClass} placeholder={llmProvider === 'anthropic' ? 'e.g. claude-sonnet-4-6' : 'Enter gateway model name'} value={llmModel} onChange={(e) => setLlmModel(e.target.value)} /> : <select className={fieldClass} value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>{LLM_MODELS[llmProvider].map((m) => <option key={m} value={m}>{m}</option>)}</select>}</div>}
          </div>
          <div className="mb-2.5 border border-qa-border bg-[#faf8f2] px-3 py-2 text-[11.5px] text-qa-muted">
            {llmProvider === 'template' ? 'Uses verified dashboard metrics to produce a deterministic narrative. No API key or network request is required.' : customEndpointSelected ? 'Custom endpoint selected. The provider-native request format and authentication are retained.' : `Official endpoint: ${officialBaseUrl || 'provider default'}`}
          </div>
          {llmProvider !== 'template' && customEndpointSelected && <div className="mb-2.5"><Field label="Custom base URL" placeholder={llmProvider === 'anthropic' ? 'https://gateway.example.com' : 'https://gateway.example.com/v1'} value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} /><p className="text-[10.5px] text-qa-muted-light mt-1 mb-0">For an Anthropic-native gateway, enter the base URL before <code>/v1/messages</code>. The app adds the messages path automatically.</p></div>}
          {llmProvider !== 'template' && <Field label="LLM key" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} />}
          <div className="flex flex-wrap items-center gap-2 mt-3"><button type="button" onClick={saveNarrativeProvider} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save</button><button type="button" onClick={saveAndTestLlm} disabled={llmTest.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{llmTest.isPending ? 'Validating...' : llmProvider === 'template' ? 'Save & Validate' : 'Save & Test LLM'}</button></div>
          {narrativeSavedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{narrativeSavedMsg}</div>}
          {llmTestMsg && <div className="mt-3 p-3 text-[13px] border border-qa-border bg-[#faf8f2] text-qa-ink">{llmTestMsg}</div>}
        </QaSection>
        <QaSection title="Report Branding">
          <div className="mb-3 border border-qa-border bg-[#faf8f2] p-3"><label className={labelClass}>Browse logo file</label><label className="inline-flex items-center justify-center font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">Browse Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} /></label>{logoUploadMsg && <div className="mt-2 text-[12px] text-qa-muted">{logoUploadMsg}</div>}</div>
          <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2"><Field label="Logo URL / uploaded image" value={reportBranding.logoUrl?.startsWith('data:image/') ? 'Uploaded logo saved in browser' : reportBranding.logoUrl || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoUrl: e.target.value })} /><Field label="Logo alt text" value={reportBranding.logoAlt || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoAlt: e.target.value })} /><Field label="Report title" value={reportBranding.title || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, title: e.target.value })} /><Field label="Report subtitle prefix" value={reportBranding.subtitle || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, subtitle: e.target.value })} /></div>
          <button type="button" onClick={saveBranding} className="mt-3 font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save branding</button>
          {brandingSavedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{brandingSavedMsg}</div>}
        </QaSection>
        <QaSection title="Selected project connection summary">
          {selectedProject ? <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-2"><div className="min-w-0 border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">JIRA · {selectedProject.key}</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0 break-words">{jiraConnections.some((connection) => jiraProject(connection, projects)?.id === selectedProject.id) ? (selectedJiraConnection?.enabled === false ? 'Configured · disabled' : 'Configured · enabled') : 'Not configured'}</p></div><div className="min-w-0 border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">QMetry · {selectedProject.key}</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0 break-words">{qmetryConnections.some((connection) => qmetryProject(connection, projects)?.id === selectedProject.id) ? (selectedQmetryConnection?.enabled === false ? 'Configured · disabled' : 'Configured · enabled') : 'Not configured'}</p></div></div> : <div className="mb-3 p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">Select a specific project from the main Project dropdown to configure, test, or sync its connections.</div>}
          <p className="text-[11.5px] text-qa-muted-light mt-0">Sync scope: {selectedProject ? `${selectedProject.key} only` : 'no project selected'}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex min-h-[132px] flex-col border border-qa-border bg-[#faf8f2] p-3"><p className="m-0 text-[12px] font-semibold">Save configuration</p><p className="mt-1 mb-3 text-[11px] leading-relaxed text-qa-muted">Stores the selected project’s Jira and QMetry settings in this browser. It makes no external API call.</p><button type="button" onClick={saveConnections} disabled={!selectedProject} className="mt-auto w-full font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">Save connections</button></div>
            <div className="flex min-h-[132px] flex-col border border-qa-border bg-[#faf8f2] p-3"><p className="m-0 text-[12px] font-semibold">Validate configuration</p><p className="mt-1 mb-3 text-[11px] leading-relaxed text-qa-muted">Saves the current values, calls only the selected project’s enabled APIs, and displays sample counts without updating dashboard data.</p><button type="button" onClick={() => { if (saveConnections()) testMutation.mutate(); }} disabled={!selectedProject || testMutation.isPending} className="mt-auto w-full font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Save & test'}</button></div>
            <div className="flex min-h-[132px] flex-col border border-qa-border bg-[#faf8f2] p-3"><p className="m-0 text-[12px] font-semibold">Refresh dashboard data</p><p className="mt-1 mb-3 text-[11px] leading-relaxed text-qa-muted">Saves the current values, imports live Jira/QMetry data for this project, and rebuilds its dashboard dataset.</p><button type="button" onClick={() => { if (saveConnections()) syncLiveMutation.mutate(); }} disabled={!selectedProject || syncLiveMutation.isPending} className="mt-auto w-full font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{syncLiveMutation.isPending ? 'Syncing...' : 'Save & sync data'}</button></div>
          </div>
          {syncCounts && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">Synced executions {syncCounts.executions} · issues {syncCounts.issues} · uat {syncCounts.uat}{syncWarnings.length ? ` · warnings: ${syncWarnings.join('; ')}` : ''}</div>}
          {syncLiveMutation.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(syncLiveMutation.error as Error).message}</div>}
          {testMutation.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(testMutation.error as Error).message}</div>}
          {testResult && <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>{testResult.ok ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} rows` : testResult.error}</div>}
          {savedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{savedMsg}</div>}
          {connectionNotice && <div className="mt-3 p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">{connectionNotice}</div>}
          {connectionError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{connectionError}</div>}
        </QaSection>
        <QaSection title="JIRA connection" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">The selected project has one JIRA configuration slot. Its JQL remains editable but must include all source keys configured in Project Management.</p>
          {selectedProject && selectedJiraConnection ? <JiraConnectionCard key={`${selectedProject.id}-jira`} conn={selectedJiraConnection} project={selectedProject} onChange={updateSelectedJira} /> : <div className="p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">Select a specific project from the main Project dropdown to configure JIRA.</div>}
        </QaSection>
        <QaSection title="QMetry connection" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">The selected project has one QMetry configuration slot. Choose the applicable QMetry key from this project's configured source keys; the numeric Project ID and folder remain configurable.</p>
          {selectedProject && selectedQmetryConnection ? <QmetryConnectionCard key={`${selectedProject.id}-qmetry`} conn={selectedQmetryConnection} project={selectedProject} onChange={updateSelectedQmetry} /> : <div className="p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">Select a specific project from the main Project dropdown to configure QMetry.</div>}
        </QaSection>
        <QaSection title="Cycle / Folder list" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Live QMetry cycles are shown only after you click Load cycles/folders.</p>
          <div className="flex flex-wrap items-center gap-2 mb-3"><button type="button" onClick={() => loadCycles()} disabled={!selectedProject || cyclesFetching} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{cyclesFetching ? 'Loading...' : cyclesFetched ? 'Refresh cycles/folders' : 'Load cycles/folders'}</button><span className="min-w-0 break-words text-[12px] text-qa-muted">Source: <span className="font-mono-qa text-qa-ink">{cycles?.source || 'not loaded'}</span>{cycles?.connection ? ` - ${cycles.connection}` : ''}</span></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">{(cycles?.cycles || []).map((c) => <div key={c.id} className="border border-qa-border bg-[#faf8f2] px-3 py-2 font-mono-qa text-[11px]"><span className="text-qa-muted-light">{c.id}</span> · {c.name}</div>)}{!cycles?.cycles?.length && <div className="text-[13px] text-qa-muted">No cycles loaded. Click Load cycles/folders after saving QMetry.</div>}</div>
        </QaSection>
        <QaSection title="Folder paths">
          <ul className="text-[13px] text-qa-muted m-0 p-0 list-none space-y-2 font-mono-qa"><li><span className="text-qa-ink">input/</span> - staged Excel exports</li><li><span className="text-qa-ink">output/</span> - dashboard-data.json, report.md</li><li><span className="text-qa-ink">config/</span> - fallback runtime config</li></ul>
        </QaSection>
      </div>
      <QaSection className="mt-[22px]"><p className="text-[13px] text-qa-muted m-0 leading-relaxed"><strong className="text-qa-ink">Privacy model:</strong> Browser settings are stored locally in localStorage and are only sent to this API while you use the app.</p></QaSection>
    </QaPageShell>
  );
}
