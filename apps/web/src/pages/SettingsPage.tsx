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
const checkLabelClass = 'inline-flex items-center gap-2 font-mono-qa text-[11px] uppercase tracking-wide text-qa-ink mr-5 cursor-pointer';
const MAX_LOGO_BYTES = 1_500_000;

const LLM_KEY_PLACEHOLDER: Record<LlmProvider, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  gemini: 'AIza...',
  'openai-compatible': 'Provider API key',
};

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input className={fieldClass} {...props} />
    </div>
  );
}

function blankJiraConnection(): JiraConnectionInput {
  return {
    id: newConnectionId(),
    name: '',
    baseUrl: '',
    deploymentType: 'on-prem',
    authType: 'basic',
    email: '',
    apiToken: '',
    cookie: '',
    jiraSessionId: '',
    jiraXsrfToken: '',
    searchPath: '/rest/api/2/search',
    projectKeys: [],
    jql: '',
  };
}

function blankQmetryConnection(): QmetryConnectionInput {
  return { id: newConnectionId(), name: '', baseUrl: '', email: '', apiToken: '', projectKey: '', projectId: '', cycleIds: [], folderId: '' };
}

interface TestResult { ok: boolean; count?: number; error?: string }

function setDeployment(conn: JiraConnectionInput, deploymentType: 'cloud' | 'on-prem'): JiraConnectionInput {
  if (deploymentType === 'cloud') return { ...conn, deploymentType, authType: 'basic', searchPath: '/rest/api/2/search' };
  return { ...conn, deploymentType, authType: 'basic', searchPath: '/rest/api/2/search' };
}

function withProject(conn: JiraConnectionInput, projectKey: string): JiraConnectionInput {
  const clean = projectKey.trim().toUpperCase();
  return { ...conn, projectKeys: clean ? [clean] : [], jql: clean ? `project = ${clean} AND issuetype in (Story, Bug) ORDER BY updated DESC` : '' };
}

function cleanCookie(value: string): string {
  return value.replace(/^Cookie:\s*/i, '').trim();
}

function buildJiraCookie(conn: JiraConnectionInput): string {
  const full = cleanCookie(conn.cookie || '');
  if (full) return full;
  const parts: string[] = [];
  if (conn.jiraSessionId?.trim()) parts.push(`JSESSIONID=${conn.jiraSessionId.trim()}`);
  if (conn.jiraXsrfToken?.trim()) parts.push(`atlassian.xsrf.token=${conn.jiraXsrfToken.trim()}`);
  return parts.join('; ');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildJiraCurl(conn: JiraConnectionInput): string {
  const url = `${(conn.baseUrl || '').replace(/\/+$/, '')}${conn.searchPath || '/rest/api/2/search'}`;
  const auth = (conn.apiToken || conn.credential || '').trim();
  const jql = conn.jql?.trim() || (conn.projectKeys?.[0] ? `project = ${conn.projectKeys[0]} AND issuetype in (Story, Bug) ORDER BY updated DESC` : 'issuetype in (Story, Bug) ORDER BY updated DESC');
  const cookie = buildJiraCookie(conn);
  const body = JSON.stringify({
    jql,
    startAt: 0,
    maxResults: 10,
    fields: ['summary', 'description', 'assignee', 'status', 'priority', 'issuetype', 'created', 'updated', 'resolution', 'resolved', 'reporter', 'labels', 'components', 'fixVersions', 'customfield_10020', 'customfield_10016', 'customfield_10028'],
  }, null, 2);
  return [
    `curl --location --request POST ${shellQuote(url)} \\`,
    auth ? `--header ${shellQuote(`Authorization: ${auth}`)} \\` : '',
    `--header ${shellQuote('Accept: application/json')} \\`,
    `--header ${shellQuote('Content-Type: application/json')} \\`,
    cookie ? `--header ${shellQuote(`Cookie: ${cookie}`)} \\` : '',
    `--data-raw ${shellQuote(body)}`,
  ].filter(Boolean).join('\n');
}

function JiraConnectionCard({ conn, onChange, onRemove, projectOptions }: { conn: JiraConnectionInput; onChange: (next: JiraConnectionInput) => void; onRemove: () => void; projectOptions: string[] }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const deploymentType = conn.deploymentType || 'on-prem';
  const isCloud = deploymentType === 'cloud';
  const secretInputType = showSecrets ? 'text' : 'password';
  const selectedProject = conn.projectKeys?.[0] || '';
  const customProject = selectedProject && !projectOptions.includes(selectedProject) ? selectedProject : '';
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('jira', conn), onSuccess: (r) => setTestResult(r) });

  async function copyCurl() {
    const command = buildJiraCurl(conn);
    try {
      await navigator.clipboard.writeText(command);
      setCopyMsg('Curl copied. Compare it with the working Postman/curl command.');
    } catch {
      setCopyMsg(command);
    }
    setTimeout(() => setCopyMsg(null), 6000);
  }

  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="mb-3 border border-qa-border bg-white px-3 py-2">
        <div className={labelClass}>JIRA deployment</div>
        <label className={checkLabelClass}><input type="checkbox" checked={isCloud} onChange={() => onChange(setDeployment(conn, 'cloud'))} />On-cloud JIRA</label>
        <label className={checkLabelClass}><input type="checkbox" checked={!isCloud} onChange={() => onChange(setDeployment(conn, 'on-prem'))} />On-premises JIRA</label>
        <p className="text-[11px] text-qa-muted m-0 mt-2">
          {isCloud ? 'Cloud uses Jira REST API v2 with Authorization header.' : 'On-premises uses Jira REST API v2 with Authorization header and optional JSESSIONID/XSRF session values when SSO redirects API requests.'}
        </p>
      </div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-mono-qa text-[10.5px] uppercase tracking-wide text-qa-muted-light">Connection values</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowSecrets((v) => !v)} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecrets ? 'Hide values' : 'Show values'}</button>
          <button type="button" onClick={copyCurl} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer">Copy curl</button>
        </div>
      </div>
      {copyMsg && <div className="mb-2.5 p-2 border border-qa-border bg-white text-[11px] font-mono-qa whitespace-pre-wrap break-all text-qa-muted">{copyMsg}</div>}
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <div>
          <label className={labelClass}>JIRA project to connect</label>
          <select className={fieldClass} value={customProject ? '__custom__' : selectedProject} onChange={(e) => onChange(withProject(conn, e.target.value === '__custom__' ? '' : e.target.value))}>
            <option value="">Select project</option>
            {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="__custom__">Other project...</option>
          </select>
        </div>
        <Field label="Custom project key" placeholder="ABC" value={customProject} onChange={(e) => onChange(withProject(conn, e.target.value))} />
        <Field label="Connection name" placeholder={isCloud ? 'DLM Cloud' : 'DLM On-Prem'} value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder={isCloud ? 'https://company.atlassian.net' : 'https://jira.company.local'} value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label={isCloud ? 'Email / username' : 'Username / service account'} value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value, username: e.target.value })} />
        <Field label={isCloud ? 'Basic auth / API token' : 'Basic auth / password'} type={secretInputType} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="REST search path" value={conn.searchPath || '/rest/api/2/search'} onChange={(e) => onChange({ ...conn, searchPath: e.target.value })} />
        <Field label="Application CI field (optional)" placeholder="customfield_12345" value={conn.applicationCiFieldId || ''} onChange={(e) => onChange({ ...conn, applicationCiFieldId: e.target.value })} />
      </div>

      {!isCloud && (
        <div className="border border-qa-border bg-white p-3 mb-2.5">
          <div className={labelClass}>On-premises session cookies optional</div>
          <p className="text-[11px] text-qa-muted m-0 mb-2">
            Use these only if the API redirects to an HTML login/SSO page. The backend sends them as one header: JSESSIONID=value; atlassian.xsrf.token=value.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="JSESSIONID" type={secretInputType} placeholder="6B0D9467083D..." value={conn.jiraSessionId || ''} onChange={(e) => onChange({ ...conn, jiraSessionId: e.target.value })} />
            <Field label="Atlassian XSRF token" type={secretInputType} placeholder="BRNK-BWG8-..." value={conn.jiraXsrfToken || ''} onChange={(e) => onChange({ ...conn, jiraXsrfToken: e.target.value })} />
          </div>
          <div className="mt-2.5">
            <Field label="Full Cookie header alternative" type={secretInputType} placeholder="JSESSIONID=...; atlassian.xsrf.token=..." value={conn.cookie || ''} onChange={(e) => onChange({ ...conn, cookie: e.target.value })} />
          </div>
          <p className="text-[11px] text-qa-muted m-0 mt-2">If full Cookie header is entered, it will be used first. Otherwise JSESSIONID + XSRF token are combined.</p>
        </div>
      )}

      <label className={labelClass}>JQL override (auto-filled from project, optional)</label>
      <textarea className="w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[62px]" placeholder="project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC" value={conn.jql || ''} onChange={(e) => onChange({ ...conn, jql: e.target.value })} />
      <div className="flex items-center gap-2 mt-2.5">
        <button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing…' : 'Test'}</button>
        <button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>
        {testResult && <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}
      </div>
    </div>
  );
}

function QmetryConnectionCard({ conn, onChange, onRemove }: { conn: QmetryConnectionInput; onChange: (next: QmetryConnectionInput) => void; onRemove: () => void }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('qmetry', conn), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Email / username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value })} />
        <Field label="API token / password" type="password" value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="Project key" placeholder="DLM" value={conn.projectKey} onChange={(e) => onChange({ ...conn, projectKey: e.target.value })} />
        <Field label="Project ID (optional)" placeholder="23000" value={conn.projectId || ''} onChange={(e) => onChange({ ...conn, projectId: e.target.value })} />
        <Field label="Cycle IDs (comma separated)" value={(conn.cycleIds || []).join(',')} onChange={(e) => onChange({ ...conn, cycleIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <Field label="Folder ID (optional)" value={conn.folderId || ''} onChange={(e) => onChange({ ...conn, folderId: e.target.value })} />
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing…' : 'Test'}</button>
        <button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">Remove</button>
        {testResult && <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}
      </div>
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
  const [qmetryConnections, setQmetryConnectionsState] = useState<QmetryConnectionInput[]>(getQmetryConnections());
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
    return [...values].sort();
  }, [settingsDashboard?.scope.projects, jiraConnections, qmetryConnections]);

  const testMutation = useMutation({ mutationFn: batchApi.testIntegrations, onSuccess: () => refetch() });
  const llmTest = useMutation({
    mutationFn: () => batchApi.testLlm(currentLlmSelection()),
    onSuccess: (data) => setLlmTestMsg(data.ok ? `Connected — ${data.providerLabel || LLM_PROVIDER_LABELS[llmProvider]} / ${data.model}` : data.error || 'LLM connection failed'),
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
    setQmetryConnections(qmetryConnections);
    setSavedMsg('Saved in this browser. JIRA session values are stored locally and sent only with your API requests. No .env file is required for normal UI usage.');
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
    <QaPageShell title="Settings" intro="Configure the global LLM provider, report branding, and your project-specific JIRA/QMetry integrations. Select a project in the dashboard filter to view only that project's live or uploaded data.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        <QaSection title="Global LLM Provider">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Select the LLM once here. AI Report will use this saved provider/model/key for all generations.</p>
          <div className="grid grid-cols-2 gap-2.5 mb-2.5"><div><label className={labelClass}>Provider</label><select className={fieldClass} value={llmProvider} onChange={(e) => changeLlmProvider(e.target.value as LlmProvider)}>{(Object.keys(LLM_PROVIDER_LABELS) as LlmProvider[]).map((p) => <option key={p} value={p}>{LLM_PROVIDER_LABELS[p]}</option>)}</select></div><div><label className={labelClass}>Model</label><select className={fieldClass} value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>{LLM_MODELS[llmProvider].map((m) => <option key={m} value={m}>{m}</option>)}</select></div></div>
          <Field label={`${LLM_PROVIDER_LABELS[llmProvider]} API key`} type="password" placeholder={LLM_KEY_PLACEHOLDER[llmProvider]} value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} />
          <p className="text-[11.5px] text-qa-muted m-0 mt-2">This key is saved in this browser only and sent only when you test/generate. No LLM key is required in .env for normal UI usage.</p>
          {llmProvider === 'openai-compatible' && <div className="mt-2.5"><Field label="Custom base URL" placeholder="https://provider.example.com/v1" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} /></div>}
          <div className="flex items-center gap-2 mt-3"><button type="button" onClick={saveAll} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save</button><button type="button" onClick={() => { saveAll(); llmTest.mutate(); }} disabled={llmTest.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{llmTest.isPending ? 'Testing…' : 'Save & Test LLM'}</button></div>
          {llmTestMsg && <div className="mt-3 p-3 text-[13px] border border-qa-border bg-[#faf8f2] text-qa-ink">{llmTestMsg}</div>}
        </QaSection>

        <QaSection title="Report Branding">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Upload the logo used in generated PDF reports. You can also paste an internal HTTPS URL or public asset path if needed.</p>
          <div className="mb-3 border border-qa-border bg-[#faf8f2] p-3"><label className={labelClass}>Browse logo file</label><div className="flex flex-wrap items-center gap-2"><label className="inline-flex items-center justify-center font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">Browse Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} /></label>{reportBranding.logoUrl && <button type="button" onClick={() => { setReportBrandingState({ ...reportBranding, logoUrl: '' }); setLogoUploadMsg('Logo removed. Click Save branding to keep this change.'); }} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">Remove Logo</button>}</div><p className="text-[11.5px] text-qa-muted m-0 mt-2">Allowed: PNG, JPG, SVG, WebP. Recommended size: under 1.5 MB.</p>{logoUploadMsg && <div className="mt-2 text-[12px] text-qa-muted">{logoUploadMsg}</div>}</div>
          <div className="grid grid-cols-2 gap-2.5 mb-2.5"><Field label="Logo URL / uploaded image" placeholder="Browse file or paste URL" value={reportBranding.logoUrl?.startsWith('data:image/') ? 'Uploaded logo saved in browser' : reportBranding.logoUrl || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoUrl: e.target.value })} /><Field label="Logo alt text" placeholder="Emirates" value={reportBranding.logoAlt || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, logoAlt: e.target.value })} /><Field label="Report title" placeholder="QA Sprint Report" value={reportBranding.title || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, title: e.target.value })} /><Field label="Report subtitle prefix" placeholder="Global DMC Integration" value={reportBranding.subtitle || ''} onChange={(e) => setReportBrandingState({ ...reportBranding, subtitle: e.target.value })} /></div>
          {reportBranding.logoUrl && <div className="mt-3 border border-qa-border bg-[#faf8f2] p-3"><div className={labelClass}>Logo preview</div><img src={reportBranding.logoUrl} alt={reportBranding.logoAlt || 'Report logo'} className="max-h-16 max-w-[220px] object-contain bg-white p-2 border border-qa-border" /></div>}
          <button type="button" onClick={saveAll} className="mt-3 font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white" style={{ background: QA.accent }}>Save branding</button>
        </QaSection>

        <QaSection title="Active connection summary">
          {integrations && <div className="grid grid-cols-2 gap-3 mb-4"><div className="border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">JIRA</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">{jiraConnections.length ? `${jiraConnections.length} browser connection(s)` : (integrations.jira.enabled ? 'Config file enabled' : 'Disabled')}</p></div><div className="border border-qa-border p-3 bg-[#faf8f2]"><p className="font-semibold text-[13px] m-0">QMetry</p><p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">{qmetryConnections.length ? `${qmetryConnections.length} browser connection(s)` : `${integrations.qmetry.enabled ? 'Enabled' : 'Disabled'} · ${integrations.qmetry.cycleIds} cycle(s)`}</p></div></div>}
          <button type="button" onClick={() => { saveAll(); testMutation.mutate(); }} disabled={testMutation.isPending} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50" style={{ background: QA.accent }}>{testMutation.isPending ? 'Testing…' : 'Save & Test all connections'}</button>
          {testResult && <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>{testResult.ok ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} rows` : testResult.error}</div>}
          {savedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{savedMsg}</div>}
        </QaSection>

        <QaSection title="JIRA connections" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Add one JIRA connection per project. For on-prem JIRA, enter Basic Authorization and optional JSESSIONID/XSRF values directly here. Use Copy curl to verify the app builds the same request as your working terminal command.</p>{jiraConnections.map((conn, idx) => <JiraConnectionCard key={conn.id} conn={conn} projectOptions={projectOptions} onChange={(next) => setJiraConnectionsState(jiraConnections.map((c, i) => (i === idx ? next : c)))} onRemove={() => setJiraConnectionsState(jiraConnections.filter((_, i) => i !== idx))} />)}<button type="button" onClick={() => setJiraConnectionsState([...jiraConnections, blankJiraConnection()])} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">+ Add JIRA connection</button></QaSection>
        <QaSection title="QMetry connections" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Add QMetry connections to fetch test cycles/test case executions. Cycle IDs are optional if Project ID can list cycles.</p>{qmetryConnections.map((conn, idx) => <QmetryConnectionCard key={conn.id} conn={conn} onChange={(next) => setQmetryConnectionsState(qmetryConnections.map((c, i) => (i === idx ? next : c)))} onRemove={() => setQmetryConnectionsState(qmetryConnections.filter((_, i) => i !== idx))} />)}<button type="button" onClick={() => setQmetryConnectionsState([...qmetryConnections, blankQmetryConnection()])} className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer">+ Add QMetry connection</button></QaSection>
        <QaSection title="Cycle / Folder list" className="lg:col-span-2"><p className="text-[13px] text-qa-muted m-0 mb-3">Used for filtering/report selection. Live QMetry cycles are shown when available; otherwise imported cycle names are listed.</p><div className="text-[12px] text-qa-muted mb-2">Source: <span className="font-mono-qa text-qa-ink">{cycles?.source || 'not loaded'}</span>{cycles?.connection ? ` · ${cycles.connection}` : ''}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">{(cycles?.cycles || []).map((c) => <div key={c.id} className="border border-qa-border bg-[#faf8f2] px-3 py-2 font-mono-qa text-[11px]"><span className="text-qa-muted-light">{c.id}</span> · {c.name}</div>)}{!cycles?.cycles?.length && <div className="text-[13px] text-qa-muted">No cycles found yet. Configure QMetry or generate a report from imported files.</div>}</div></QaSection>
        <QaSection title="Folder paths"><ul className="text-[13px] text-qa-muted m-0 p-0 list-none space-y-2 font-mono-qa"><li><span className="text-qa-ink">input/</span> — staged Excel exports</li><li><span className="text-qa-ink">output/</span> — dashboard-data.json, report.md</li><li><span className="text-qa-ink">config/</span> — fallback integrations.json</li></ul></QaSection>
        <QaSection title="CLI generate"><pre className="bg-[#faf8f2] text-[12px] font-mono-qa p-4 overflow-x-auto border border-qa-border m-0">{`./run.sh generate 2026-06-24 2026-06-30 full`}</pre></QaSection>
      </div>
      <QaSection className="mt-[22px]"><p className="text-[13px] text-qa-muted m-0 leading-relaxed"><strong className="text-qa-ink">Privacy model:</strong> Browser settings are stored locally in localStorage and are only sent to this API while you use the app. They are never written to config files, output files, or logs.</p></QaSection>
    </QaPageShell>
  );
}
