import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
import type { LlmProvider, LlmSelectionInput, ReportBranding } from '../lib/api';
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
} from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

const fieldClass = 'w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa';
const labelClass = 'block text-[10.5px] font-mono-qa uppercase tracking-wide text-qa-muted-light mb-1';
const MAX_LOGO_BYTES = 1_500_000;

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div><label className={labelClass}>{label}</label><input className={fieldClass} {...props} /></div>;
}

function blankJiraConnection(): JiraConnectionInput {
  return { id: newConnectionId(), name: '', baseUrl: '', deploymentType: 'on-prem', authType: 'basic', email: '', apiToken: '', searchPath: '/rest/api/2/search', projectKeys: [], jql: '' };
}

function blankQmetryConnection(): QmetryConnectionInput {
  return { id: newConnectionId(), name: '', baseUrl: '', email: '', apiToken: '', projectKey: '', projectId: '', folderId: '' };
}

interface TestResult { ok: boolean; count?: number; error?: string }

function withProject(conn: JiraConnectionInput, projectKey: string): JiraConnectionInput {
  const clean = projectKey.trim().toUpperCase();
  return { ...conn, projectKeys: clean ? [clean] : [], jql: clean ? `project = ${clean} AND issuetype in (Story, Bug) ORDER BY updated DESC` : '' };
}

function JiraConnectionCard({ conn, onChange, onRemove, projectOptions }: { conn: JiraConnectionInput; onChange: (next: JiraConnectionInput) => void; onRemove: () => void; projectOptions: string[] }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const selectedProject = conn.projectKeys?.[0] || '';
  const customProject = selectedProject && !projectOptions.includes(selectedProject) ? selectedProject : '';
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('jira', conn), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <div><label className={labelClass}>JIRA project</label><select className={fieldClass} value={customProject ? '__custom__' : selectedProject} onChange={(e) => onChange(withProject(conn, e.target.value === '__custom__' ? '' : e.target.value))}><option value="">Select project</option>{projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}<option value="__custom__">Other project...</option></select></div>
        <Field label="Custom project key" placeholder="ABC" value={customProject} onChange={(e) => onChange(withProject(conn, e.target.value))} />
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value, username: e.target.value })} />
        <Field label="Credential" type={showSecret ? 'text' : 'password'} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="REST search path" value={conn.searchPath || '/rest/api/2/search'} onChange={(e) => onChange({ ...conn, searchPath: e.target.value })} />
        <Field label="Application CI field" placeholder="customfield_12345" value={conn.applicationCiFieldId || ''} onChange={(e) => onChange({ ...conn, applicationCiFieldId: e.target.value })} />
      </div>
      <label className={labelClass}>JQL override</label>
      <textarea className="w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[62px]" value={conn.jql || ''} onChange={(e) => onChange({ ...conn, jql: e.target.value })} />
      <div className="flex items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test'}</button><button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>{testResult && <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}</div>
    </div>
  );
}

function QmetryConnectionCard({ conn, onChange, onRemove }: { conn: QmetryConnectionInput; onChange: (next: QmetryConnectionInput) => void; onRemove: () => void }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('qmetry', { ...conn, cycleIds: [] }), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <p className="text-[12px] text-qa-muted m-0 mb-3">QMetry discovers test cycles from Project ID and optional Folder ID. Cycle IDs are not required.</p>
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value })} />
        <Field label="Credential" type="password" value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="Project key" placeholder="DP" value={conn.projectKey} onChange={(e) => onChange({ ...conn, projectKey: e.target.value.toUpperCase(), cycleIds: [] })} />
        <Field label="Project ID" placeholder="19703" value={conn.projectId || ''} onChange={(e) => onChange({ ...conn, projectId: e.target.value, cycleIds: [] })} />
        <Field label="Folder ID" placeholder="96225" value={conn.folderId || ''} onChange={(e) => onChange({ ...conn, folderId: e.target.value, cycleIds: [] })} />
      </div>
      <div className="flex items-center gap-2 mt-2.5"><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test cycle search'}</button><button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>{testResult && <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} test cycles found)` : testResult.error}</span>}</div>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const initialLlm = getUserLlmSelection();
  const initialProvider = (initialLlm.provider || 'anthropic') as LlmProvider;
  const initialBranding = getReportBranding();
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(initialProvider);
  const [llmModel, setLlmModel] = useState(initialLlm.model || LLM_MODELS[initialProvider][0]);
  const [llmApiKey, setLlmApiKey] = useState(initialLlm.apiKey || getUserLlmKey(initialProvider));
  const [llmBaseUrl, setLlmBaseUrl] = useState(initialLlm.baseUrl || '');
  const [reportBranding, setReportBrandingState] = useState<ReportBranding>(initialBranding);
  const [logoUploadMsg, setLogoUploadMsg] = useState<string | null>(null);
  const [llmTestMsg, setLlmTestMsg] = useState<string | null>(null);
  const [jiraConnections, setJiraConnectionsState] = useState<JiraConnectionInput[]>(getJiraConnections());
  const [qmetryConnections, setQmetryConnectionsState] = useState<QmetryConnectionInput[]>(getQmetryConnections().map((c) => ({ ...c, cycleIds: [] })));
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const { data: integrations, refetch } = useQuery({ queryKey: ['integrations'], queryFn: batchApi.getIntegrations });
  const { data: settingsDashboard } = useQuery({ queryKey: ['settings-dashboard-projects'], queryFn: () => batchApi.getDashboard(), retry: false });
  const { data: cycles } = useQuery({ queryKey: ['cycles-folders', jiraConnections, qmetryConnections], queryFn: batchApi.getCycleFolders, retry: false });

  const projectOptions = useMemo(() => {
    const values = new Set<string>();
    for (const p of settingsDashboard?.scope.projects || []) if (p && p !== 'all') values.add(p);
    for (const c of jiraConnections) for (const p of c.projectKeys || []) if (p) values.add(p);
    for (const c of qmetryConnections) if (c.projectKey) values.add(c.projectKey.toUpperCase());
    values.add('DLM');
    values.add('DP');
    return [...values].sort();
  }, [settingsDashboard?.scope.projects, jiraConnections, qmetryConnections]);

  const testMutation = useMutation({ mutationFn: batchApi.testIntegrations, onSuccess: () => refetch() });
  const llmTest = useMutation({
    mutationFn: () => batchApi.testLlm(currentLlmSelection()),
    onSuccess: (data) => setLlmTestMsg(data.ok ? `Connected - ${data.providerLabel || LLM_PROVIDER_LABELS[llmProvider]} / ${data.model}` : data.error || 'LLM connection failed'),
    onError: (err: Error) => setLlmTestMsg(err.message),
  });
  const testResult = testMutation.data as { ok?: boolean; executions?: number; issues?: number; uat?: number; error?: string } | undefined;

  function currentLlmSelection(): LlmSelectionInput {
    return { provider: llmProvider, model: llmModel, apiKey: llmApiKey.trim() || undefined, baseUrl: llmProvider === 'openai-compatible' ? llmBaseUrl.trim() || undefined : undefined };
  }

  function saveAll() {
    setUserLlmSelection(currentLlmSelection());
    setReportBranding(reportBranding);
    setJiraConnections(jiraConnections);
    setQmetryConnections(qmetryConnections.map((c) => ({ ...c, cycleIds: [] })));
    setSavedMsg('Saved. Click Sync imported data to refresh uploaded files plus JIRA and QMetry APIs.');
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    queryClient.invalidateQueries({ queryKey: ['cycles-folders'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-init'] });
    setTimeout(() => setSavedMsg(null), 3500);
  }

  function changeLlmProvider(provider: LlmProvider) {
    setLlmProvider(provider);
    setLlmModel(LLM_MODELS[provider][0]);
    setLlmApiKey(getUserLlmKey(provider));
    if (provider !== 'openai-compatible') setLlmBaseUrl('');
  }

  function handleLogoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setLogoUploadMsg('Please select a PNG, JPG, SVG, or WebP image file.'); event.target.value = ''; return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoUploadMsg('Logo file is too large. Please use an optimized image under 1.5 MB.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setReportBrandingState({ ...reportBranding, logoUrl: dataUrl, logoAlt: reportBranding.logoAlt || file.name.replace(/\.[^.]+$/, '') });
      setLogoUploadMsg(`Selected ${file.name}. Click Save branding to keep it.`);
    };
    reader.onerror = () => setLogoUploadMsg('Could not read the selected logo file. Please try another image.');
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  return (
    <QaPageShell title="Settings" intro="Configure LLM, report branding, JIRA, and QMetry. Sync refreshes uploaded files plus live API data.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        <QaSection title="Global LLM Provider"><p className="text-[13px] text-qa-muted m-0 mb-3">Select the LLM once here.</p><div className="grid grid-cols-2 gap-2.5 mb-2.5"><div><label className={labelClass}>Provider</label><select className={fieldClass} value={llmProvider} onChange={(e) => changeLlmProvider(e.target.value as LlmProvider)}>{(Object.keys(LLM_PROVIDER_LABELS) as LlmProvider[]).map((p) => <option key={p} value={p}>{LLM_PROVIDER_LABELS[p]}</option>)}</select></div><div><label className={labelClass}>Model</label><select className={fieldClass} value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>{LLM_MODELS[llmProvider].map((m) => <option key={m} value={m}>{m}</option>)}</select></div></div><Field label="LLM key" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} />{llmProvider === 'openai-compatible' && <div className="mt-2.5"><Field label="Custom base URL" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} /></div>}<div className="flex items-center gap-2 mt-3"><button type="button" onClick={saveAll} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save</button><button type="button" onClick={() => { saveAll(); llmTest.mutate(); }} disabled={llmTest.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{llmTest.isPending ? 'Testing...' : 'Save & Test LLM'}</button></div>{llmTestMsg && <div className="mt-3 p-3 text-[13px] border border-qa-border bg-[#faf8f2] text-qa-ink">{llmTestMsg}</div>}</QaSection>
        <QaSection title="Report Branding"><div className="mb-3 border border-qa-border bg-[#faf8f2] p-3"><label className={labelClass}>Browse logo file</label><label className="inline-flex items-center justify-center font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">Browse Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} /></label>{logoUploadMsg && <div className="mt-2 text-[12px] text-qa-muted">{logoUploadMsg}</div>}</div><div className="grid grid-cols-2 gap-2.5 mb-2.5"><Field label="Logo URL / uploaded image" value={reportBranding.logoUrl?.startsWith('data:image/') ? 'Uploaded logo saved in browser' : reportBranding.logoUrl || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoUrl: e.target.value })} /><Field label="Logo alt text" value={reportBranding.logoAlt || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoAlt: e.target.value })} /><Field label="Report title" value={reportBranding.title || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, title: e.target.value })} /><Field label="Report subtitle prefix" value={reportBranding.subtitle || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, subtitle: e.target.value })} /></div><button type="button" onClick={saveAll} className="mt-3 font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save branding</button></QaSection>
        <QaSection title="Active connection summary">{integrations && <div className="grid grid-cols-2 gap-3 mb-4"><div className="border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">JIRA</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">{jiraConnections.length ? `${jiraConnections.length} browser connection(s)` : (integrations.jira.enabled ? 'Config file enabled' : 'Disabled')}</p></div><div className="border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">QMetry</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">{qmetryConnections.length ? `${qmetryConnections.length} browser connection(s)` : (integrations.qmetry.enabled ? 'Config file enabled' : 'Disabled')}</p></div></div>}<button type="button" onClick={() => { saveAll(); testMutation.mutate(); }} disabled={testMutation.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{testMutation.isPending ? 'Testing...' : 'Save & Test all connections'}</button>{testResult && <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>{testResult.ok ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} rows` : testResult.error}</div>}{savedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{savedMsg}</div>}</QaSection>
        <QaSection title="JIRA connections" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Sync refreshes these API rows together with uploaded files.</p>{jiraConnections.map((conn, idx) => <JiraConnectionCard key={conn.id} conn={conn} projectOptions={projectOptions} onChange={(next) => setJiraConnectionsState(jiraConnections.map((c, i) => (i === idx ? next : c)))} onRemove={() => setJiraConnectionsState(jiraConnections.filter((_, i) => i !== idx))} />)}<button type="button" onClick={() => setJiraConnectionsState([...jiraConnections, blankJiraConnection()])} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">+ Add JIRA connection</button></QaSection>
        <QaSection title="QMetry connections" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Use Project ID and optional Folder ID. Cycle IDs are no longer used.</p>{qmetryConnections.map((conn, idx) => <QmetryConnectionCard key={conn.id} conn={conn} onChange={(next) => setQmetryConnectionsState(qmetryConnections.map((c, i) => (i === idx ? next : c)))} onRemove={() => setQmetryConnectionsState(qmetryConnections.filter((_, i) => i !== idx))} />)}<button type="button" onClick={() => setQmetryConnectionsState([...qmetryConnections, blankQmetryConnection()])} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">+ Add QMetry connection</button></QaSection>
        <QaSection title="Cycle / Folder list" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Live QMetry cycles are shown when Project ID can list cycles.</p><div className="text-[12px] text-qa-muted mb-2">Source: <span className="font-mono-qa text-qa-ink">{cycles?.source || 'not loaded'}</span>{cycles?.connection ? ` - ${cycles.connection}` : ''}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">{(cycles?.cycles || []).map((c) => <div key={c.id} className="border border-qa-border bg-[#faf8f2] px-3 py-2 font-mono-qa text-[11px]"><span className="text-qa-muted-light">{c.id}</span> - {c.name}</div>)}{!cycles?.cycles?.length && <div className="text-[13px] text-qa-muted">No cycles found yet. Save QMetry with Project ID, then test or click Sync.</div>}</div></QaSection>
        <QaSection title="Folder paths"><ul className="text-[13px] text-qa-muted m-0 p-0 list-none space-y-2 font-mono-qa"><li><span className="text-qa-ink">input/</span> - staged Excel exports</li><li><span className="text-qa-ink">output/</span> - dashboard-data.json, report.md</li><li><span className="text-qa-ink">config/</span> - fallback runtime config</li></ul></QaSection>
      </div>
      <QaSection className="mt-[22px]"><p className="text-[13px] text-qa-muted m-0 leading-relaxed"><strong className="text-qa-ink">Privacy model:</strong> Browser settings are stored locally in localStorage and are only sent to this API while you use the app.</p></QaSection>
    </QaPageShell>
  );
}
