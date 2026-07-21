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

function jiraProjectJql(projectKey: string): string {
  return `project = ${projectKey} AND issuetype in (Story, Bug) ORDER BY updated DESC`;
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
  return { id: newConnectionId(), workspaceProjectId: project.id, name: `${project.key} JIRA`, baseUrl: '', enabled: true, syncIssues: true, deploymentType: 'on-prem', authType: 'basic', email: '', username: '', apiToken: '', credential: '', cookie: '', jiraSessionId: '', jiraXsrfToken: '', searchPath: '/rest/api/2/search', projectKeys: [project.key], jql: jiraProjectJql(project.key), applicationCiFieldId: '' };
}

function blankQmetryConnection(project: ProjectRecord): QmetryConnectionInput {
  return { id: newConnectionId(), workspaceProjectId: project.id, name: `${project.key} QMetry`, baseUrl: '', enabled: true, syncExecutions: true, email: '', apiToken: '', credential: '', sessionHeader: '', sessionId: '', xsrfToken: '', projectKey: project.key, projectId: '', folderId: '', cycleIds: [] };
}

function withJiraProject(conn: JiraConnectionInput, project?: ProjectRecord): JiraConnectionInput {
  if (!project) return { ...conn, workspaceProjectId: undefined, projectKeys: [], jql: '' };
  return { ...conn, workspaceProjectId: project.id, projectKeys: [project.key], jql: jiraProjectJql(project.key) };
}

function withQmetryProject(conn: QmetryConnectionInput, project?: ProjectRecord): QmetryConnectionInput {
  if (!project) return { ...conn, workspaceProjectId: undefined, projectKey: '', cycleIds: [] };
  return { ...conn, workspaceProjectId: project.id, projectKey: project.key, cycleIds: [] };
}

function jiraProject(conn: JiraConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => project.key === conn.projectKeys?.[0]?.trim().toUpperCase());
}

function qmetryProject(conn: QmetryConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => project.key === conn.projectKey?.trim().toUpperCase());
}

function JiraConnectionCard({ conn, onChange, onRemove, projects, unavailableProjectIds }: { conn: JiraConnectionInput; onChange: (next: JiraConnectionInput) => void; onRemove: () => void; projects: ProjectRecord[]; unavailableProjectIds: Set<string> }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const selectedProject = jiraProject(conn, projects);
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
        <div><label className={labelClass}>Dashboard project</label><select className={fieldClass} value={selectedProject?.id || ''} onChange={(e) => onChange(withJiraProject(conn, projects.find((project) => project.id === e.target.value)))}><option value="">Select existing project</option>{projects.map((project) => <option key={project.id} value={project.id} disabled={unavailableProjectIds.has(project.id)}>{project.key} — {project.name}</option>)}</select></div>
        <Field label="JIRA project key" value={selectedProject?.key || conn.projectKeys?.[0] || ''} readOnly />
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
      <textarea className="w-full border border-qa-line bg-[#f3f0e8] px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[62px]" value={conn.jql || ''} readOnly />
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled || !selectedProject} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test'}</button><button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}</div>
    </div>
  );
}

function QmetryConnectionCard({ conn, onChange, onRemove, projects, unavailableProjectIds }: { conn: QmetryConnectionInput; onChange: (next: QmetryConnectionInput) => void; onRemove: () => void; projects: ProjectRecord[]; unavailableProjectIds: Set<string> }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const enabled = conn.enabled !== false;
  const syncExecutions = conn.syncExecutions !== false;
  const selectedProject = qmetryProject(conn, projects);
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('qmetry', { ...conn, enabled, syncExecutions, cycleIds: [] }), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <p className="text-[12px] text-qa-muted m-0 mb-3">QMetry provides test-execution and cycle data only. Add a matching JIRA connection for the same project if you need stories, bugs, defects, and traceability.</p>
      <div className="flex flex-wrap gap-5 mb-4 p-3 border border-qa-border bg-white">
        <SyncBox label="Enable this QMetry connection" checked={enabled} onChange={(checked) => onChange({ ...conn, enabled: checked, cycleIds: [] })} />
        <SyncBox label="Sync test executions / cycles" checked={syncExecutions} disabled={!enabled} onChange={(checked) => onChange({ ...conn, syncExecutions: checked, cycleIds: [] })} />
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2">
        <div><label className={labelClass}>Dashboard project</label><select className={fieldClass} value={selectedProject?.id || ''} onChange={(e) => onChange(withQmetryProject(conn, projects.find((project) => project.id === e.target.value)))}><option value="">Select existing project</option>{projects.map((project) => <option key={project.id} value={project.id} disabled={unavailableProjectIds.has(project.id)}>{project.key} — {project.name}</option>)}</select></div>
        <Field label="QMetry project key" value={selectedProject?.key || conn.projectKey || ''} readOnly />
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
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled || !selectedProject} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test'}</button><button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} test cycles found)` : testResult.error}</span>}</div>
    </div>
  );
}

function normalizedConnectionsForSave(
  jiraConnections: JiraConnectionInput[],
  qmetryConnections: QmetryConnectionInput[],
  projects: ProjectRecord[],
): { jira: JiraConnectionInput[]; qmetry: QmetryConnectionInput[] } {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const normalizeJira = (connections: JiraConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.map((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || jiraProject(connection, projects);
      if (!project) throw new Error(`${connection.name || 'JIRA connection'} must be assigned to an existing dashboard project.`);
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a JIRA connection. Only one JIRA connection is allowed per project.`);
      assigned.add(project.id);
      return { ...connection, workspaceProjectId: project.id, deploymentType: connection.deploymentType || 'on-prem', projectKeys: [project.key], jql: jiraProjectJql(project.key) };
    });
  };
  const normalizeQmetry = (connections: QmetryConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.map((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || qmetryProject(connection, projects);
      if (!project) throw new Error(`${connection.name || 'QMetry connection'} must be assigned to an existing dashboard project.`);
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a QMetry connection. Only one QMetry connection is allowed per project.`);
      assigned.add(project.id);
      return { ...connection, workspaceProjectId: project.id, projectKey: project.key, cycleIds: [] };
    });
  };
  return { jira: normalizeJira(jiraConnections), qmetry: normalizeQmetry(qmetryConnections) };
}

export function SettingsPage() {
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

  const { data: integrations, refetch } = useQuery({ queryKey: ['integrations'], queryFn: batchApi.getIntegrations });
  const { data: projectsData, isLoading: projectsLoading } = useQuery({ queryKey: ['projects'], queryFn: batchApi.listProjects, retry: false });
  const { data: cycles, refetch: loadCycles, isFetching: cyclesFetching, isFetched: cyclesFetched } = useQuery({ queryKey: ['cycles-folders', jiraConnections, qmetryConnections], queryFn: batchApi.getCycleFolders, retry: false, enabled: false });
  const projects = projectsData || [];

  useEffect(() => {
    if (!projectsData?.length) return;
    setJiraConnectionsState((current) => {
      const next = current.map((connection) => {
        const project = jiraProject(connection, projectsData);
        if (!project) return connection;
        const scopedJql = jiraProjectJql(project.key);
        if (connection.workspaceProjectId === project.id && connection.projectKeys?.[0] === project.key && connection.jql === scopedJql) return connection;
        return { ...connection, workspaceProjectId: project.id, projectKeys: [project.key], jql: scopedJql };
      });
      return next.some((connection, index) => connection !== current[index]) ? next : current;
    });
    setQmetryConnectionsState((current) => {
      const next = current.map((connection) => {
        const project = qmetryProject(connection, projectsData);
        if (!project || (connection.workspaceProjectId === project.id && connection.projectKey === project.key)) return connection;
        return { ...connection, workspaceProjectId: project.id, projectKey: project.key, cycleIds: [] };
      });
      return next.some((connection, index) => connection !== current[index]) ? next : current;
    });
  }, [projectsData]);

  const availableJiraProject = useMemo(() => {
    const assigned = new Set(jiraConnections.map((connection) => jiraProject(connection, projects)?.id).filter(Boolean));
    return projects.find((project) => !assigned.has(project.id));
  }, [jiraConnections, projects]);
  const availableQmetryProject = useMemo(() => {
    const assigned = new Set(qmetryConnections.map((connection) => qmetryProject(connection, projects)?.id).filter(Boolean));
    return projects.find((project) => !assigned.has(project.id));
  }, [qmetryConnections, projects]);

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
  function globalSyncFilter() { return {}; }
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
      setSavedMsg('Connections saved. Each project has at most one JIRA and one QMetry connection.');
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

  const testMutation = useMutation({ mutationFn: batchApi.testIntegrations, onSuccess: () => refetch() });
  const syncLiveMutation = useMutation({ mutationFn: () => batchApi.syncLiveData(globalSyncFilter()), onSuccess: async () => { await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['dashboard-init'] }), queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['report'] })]); } });
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

  const syncCounts = syncResult?.rowCounts;

  return (
    <QaPageShell title="Settings" intro="Configure LLM, report branding, JIRA, and QMetry. Settings Sync refreshes all enabled live API connections; dashboard Search handles scoped project/date filtering.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
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
        <QaSection title="Active connection summary">
          {integrations && <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-2"><div className="min-w-0 border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">JIRA</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0 break-words">{jiraConnections.length ? `${jiraConnections.length} browser connection(s)` : (integrations.jira.enabled ? 'Config file enabled' : 'Disabled')}</p></div><div className="min-w-0 border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">QMetry</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0 break-words">{qmetryConnections.length ? `${qmetryConnections.length} browser connection(s)` : (integrations.qmetry.enabled ? 'Config file enabled' : 'Disabled')}</p></div></div>}
          <p className="text-[11.5px] text-qa-muted-light mt-0">Sync scope: all projects · any → any</p>
          <p className="text-[11.5px] text-qa-muted-light mt-0">Settings Sync is global. Use the dashboard Search button for project/date-specific live searching.</p>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { if (saveConnections()) syncLiveMutation.mutate(); }} disabled={syncLiveMutation.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{syncLiveMutation.isPending ? 'Syncing...' : 'Sync JIRA & QMetry now'}</button><button type="button" onClick={() => { if (saveConnections()) testMutation.mutate(); }} disabled={testMutation.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Save & Test all connections'}</button></div>
          {syncCounts && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">Synced executions {syncCounts.executions} · issues {syncCounts.issues} · uat {syncCounts.uat}{syncWarnings.length ? ` · warnings: ${syncWarnings.join('; ')}` : ''}</div>}
          {syncLiveMutation.isError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{(syncLiveMutation.error as Error).message}</div>}
          {testResult && <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>{testResult.ok ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} rows` : testResult.error}</div>}
          {savedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{savedMsg}</div>}
          {connectionError && <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">{connectionError}</div>}
        </QaSection>
        <QaSection title="JIRA connections" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Each existing dashboard project can have exactly zero or one JIRA connection. The project-scoped JQL cannot be changed to another project.</p>
          {projectsLoading && <p className="text-[12px] text-qa-muted">Loading projects...</p>}
          {!projectsLoading && !projects.length && <div className="mb-3 p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">Create a project in Import Data before adding a JIRA connection.</div>}
          {jiraConnections.map((conn, idx) => <JiraConnectionCard key={conn.id} conn={conn} projects={projects} unavailableProjectIds={new Set(jiraConnections.filter((_, otherIndex) => otherIndex !== idx).flatMap((other) => { const projectId = jiraProject(other, projects)?.id; return projectId ? [projectId] : []; }))} onChange={(next) => { setConnectionError(null); setJiraConnectionsState(jiraConnections.map((c, i) => (i === idx ? next : c))); }} onRemove={() => { setConnectionError(null); setJiraConnectionsState(jiraConnections.filter((_, i) => i !== idx)); }} />)}
          <button type="button" disabled={!availableJiraProject} onClick={() => { if (availableJiraProject) { setConnectionError(null); setJiraConnectionsState([...jiraConnections, blankJiraConnection(availableJiraProject)]); } }} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{availableJiraProject ? '+ Add JIRA connection' : projects.length ? 'All projects already have JIRA' : '+ Add JIRA connection'}</button>
        </QaSection>
        <QaSection title="QMetry connections" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Each existing dashboard project can have exactly zero or one QMetry connection. Its dashboard project key is fixed; the numeric QMetry Project ID remains configurable.</p>
          {!projectsLoading && !projects.length && <div className="mb-3 p-3 text-[13px] border border-[#e6d6b8] bg-[#fff8e8] text-[#7a5612]">Create a project in Import Data before adding a QMetry connection.</div>}
          {qmetryConnections.map((conn, idx) => <QmetryConnectionCard key={conn.id} conn={conn} projects={projects} unavailableProjectIds={new Set(qmetryConnections.filter((_, otherIndex) => otherIndex !== idx).flatMap((other) => { const projectId = qmetryProject(other, projects)?.id; return projectId ? [projectId] : []; }))} onChange={(next) => { setConnectionError(null); setQmetryConnectionsState(qmetryConnections.map((c, i) => (i === idx ? next : c))); }} onRemove={() => { setConnectionError(null); setQmetryConnectionsState(qmetryConnections.filter((_, i) => i !== idx)); }} />)}
          <button type="button" disabled={!availableQmetryProject} onClick={() => { if (availableQmetryProject) { setConnectionError(null); setQmetryConnectionsState([...qmetryConnections, blankQmetryConnection(availableQmetryProject)]); } }} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{availableQmetryProject ? '+ Add QMetry connection' : projects.length ? 'All projects already have QMetry' : '+ Add QMetry connection'}</button>
        </QaSection>
        <QaSection title="Cycle / Folder list" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Live QMetry cycles are shown only after you click Load cycles/folders.</p>
          <div className="flex flex-wrap items-center gap-2 mb-3"><button type="button" onClick={() => loadCycles()} disabled={cyclesFetching} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{cyclesFetching ? 'Loading...' : cyclesFetched ? 'Refresh cycles/folders' : 'Load cycles/folders'}</button><span className="min-w-0 break-words text-[12px] text-qa-muted">Source: <span className="font-mono-qa text-qa-ink">{cycles?.source || 'not loaded'}</span>{cycles?.connection ? ` - ${cycles.connection}` : ''}</span></div>
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
