import { useState } from 'react';
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
import {
  batchApi, apiErrorMessage, getUserAnthropicKey, setUserAnthropicKey,
  getJiraConnections, setJiraConnections, getQmetryConnections, setQmetryConnections, newConnectionId,
} from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

function blankJiraConnection(): JiraConnectionInput {
  return { id: newConnectionId(), name: '', baseUrl: '', email: '', apiToken: '', projectKeys: [], jql: '' };
}

function blankQmetryConnection(): QmetryConnectionInput {
  return { id: newConnectionId(), name: '', baseUrl: '', email: '', apiToken: '', projectKey: '', projectId: '', cycleIds: [], folderId: '' };
}

const fieldClass = 'w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa';
const labelClass = 'block text-[10.5px] font-mono-qa uppercase tracking-wide text-qa-muted-light mb-1';

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input className={fieldClass} {...props} />
    </div>
  );
}

interface TestResult { ok: boolean; count?: number; error?: string }

function JiraConnectionCard({
  conn, onChange, onRemove,
}: {
  conn: JiraConnectionInput;
  onChange: (next: JiraConnectionInput) => void;
  onRemove: () => void;
}) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testMutation = useMutation({
    mutationFn: () => batchApi.testConnection('jira', conn),
    onSuccess: (r) => setTestResult(r),
  });

  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Connection name"
          placeholder="DLM Cloud / DLM On-Prem"
          value={conn.name}
          onChange={(e) => onChange({ ...conn, name: e.target.value })}
        />
        <Field label="Base URL"
          placeholder="https://jira.example.com"
          value={conn.baseUrl}
          onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })}
        />
        <Field label="Email / username"
          value={conn.email}
          onChange={(e) => onChange({ ...conn, email: e.target.value })}
        />
        <Field label="API token / password"
          type="password"
          value={conn.apiToken}
          onChange={(e) => onChange({ ...conn, apiToken: e.target.value })}
        />
        <Field label="Project keys (comma separated)"
          placeholder="DLM,ACE"
          value={conn.projectKeys.join(',')}
          onChange={(e) => onChange({ ...conn, projectKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
        <Field label="Application CI field (optional)"
          placeholder="customfield_12345"
          value={conn.applicationCiFieldId || ''}
          onChange={(e) => onChange({ ...conn, applicationCiFieldId: e.target.value })}
        />
      </div>
      <label className={labelClass}>JQL override (optional)</label>
      <textarea
        className="w-full border border-qa-line bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[62px]"
        placeholder="project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC"
        value={conn.jql || ''}
        onChange={(e) => onChange({ ...conn, jql: e.target.value })}
      />
      <div className="flex items-center gap-2 mt-2.5">
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
          className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50"
        >
          {testMutation.isPending ? 'Testing…' : 'Test'}
        </button>
        <button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">
          Remove
        </button>
        {testResult && (
          <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>
            {testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}
          </span>
        )}
      </div>
    </div>
  );
}

function QmetryConnectionCard({
  conn, onChange, onRemove,
}: {
  conn: QmetryConnectionInput;
  onChange: (next: QmetryConnectionInput) => void;
  onRemove: () => void;
}) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testMutation = useMutation({
    mutationFn: () => batchApi.testConnection('qmetry', conn),
    onSuccess: (r) => setTestResult(r),
  });

  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Email / username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value })} />
        <Field label="API token / password" type="password" value={conn.apiToken} onChange={(e) => onChange({ ...conn, apiToken: e.target.value })} />
        <Field label="Project key" placeholder="DLM" value={conn.projectKey} onChange={(e) => onChange({ ...conn, projectKey: e.target.value })} />
        <Field label="Project ID (optional)" placeholder="23000" value={conn.projectId || ''} onChange={(e) => onChange({ ...conn, projectId: e.target.value })} />
        <Field label="Cycle IDs (comma separated)" value={(conn.cycleIds || []).join(',')} onChange={(e) => onChange({ ...conn, cycleIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <Field label="Folder ID (optional)" value={conn.folderId || ''} onChange={(e) => onChange({ ...conn, folderId: e.target.value })} />
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
          className="font-mono-qa text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50"
        >
          {testMutation.isPending ? 'Testing…' : 'Test'}
        </button>
        <button type="button" onClick={onRemove} className="font-mono-qa text-[10px] text-[#a13d2c] underline bg-transparent border-none cursor-pointer">
          Remove
        </button>
        {testResult && (
          <span className={`font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>
            {testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}
          </span>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [anthropicKey, setAnthropicKeyState] = useState(getUserAnthropicKey());
  const [jiraConnections, setJiraConnectionsState] = useState<JiraConnectionInput[]>(getJiraConnections());
  const [qmetryConnections, setQmetryConnectionsState] = useState<QmetryConnectionInput[]>(getQmetryConnections());
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const { data: integrations, refetch } = useQuery({
    queryKey: ['integrations'],
    queryFn: batchApi.getIntegrations,
  });

  const { data: cycles } = useQuery({
    queryKey: ['cycles-folders', jiraConnections, qmetryConnections],
    queryFn: batchApi.getCycleFolders,
    retry: false,
  });

  const testMutation = useMutation({
    mutationFn: batchApi.testIntegrations,
    onSuccess: () => refetch(),
  });

  const anthropicTest = useMutation({
    mutationFn: batchApi.testAnthropic,
    onMutate: () => {
      console.log('[settings] Test Anthropic connection — button clicked, request starting');
    },
    onSuccess: (data) => {
      console.log('[settings] Test Anthropic connection — success', data);
    },
    onError: (err) => {
      console.error('[settings] Test Anthropic connection — error', err);
    },
  });
  const anthropicResult = anthropicTest.data;
  const anthropicError = anthropicTest.isError
    ? apiErrorMessage(anthropicTest.error, 'Anthropic connectivity test failed')
    : undefined;

  const testResult = testMutation.data as {
    ok?: boolean; executions?: number; issues?: number; uat?: number; error?: string;
  } | undefined;

  function saveAll() {
    setUserAnthropicKey(anthropicKey);
    setJiraConnections(jiraConnections);
    setQmetryConnections(qmetryConnections);
    setSavedMsg('Saved in this browser. Server will use these settings on the next Generate/Test call.');
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    queryClient.invalidateQueries({ queryKey: ['cycles-folders'] });
    setTimeout(() => setSavedMsg(null), 3500);
  }

  return (
    <QaPageShell
      title="Settings"
      intro="Per-user settings are stored in your browser and sent only with your requests. Configure your own Anthropic key and multiple JIRA/QMetry connections without changing server files."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        <QaSection title="Anthropic API Key">
          <p className="text-[13px] text-qa-muted m-0 mb-3">
            Optional. If set here, this browser key overrides the server .env key. It is stored only in localStorage.
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="password"
              className="border border-qa-line bg-white px-3 py-2 text-sm font-mono-qa"
              placeholder="sk-ant-api03-..."
              value={anthropicKey}
              onChange={(e) => setAnthropicKeyState(e.target.value)}
            />
            <button
              type="button"
              onClick={saveAll}
              className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white"
              style={{ background: QA.accent }}
            >
              Save
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              saveAll();
              anthropicTest.mutate();
            }}
            disabled={anthropicTest.isPending}
            className="mt-3 font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50"
            style={{ background: QA.accent }}
          >
            {anthropicTest.isPending ? 'Testing…' : 'Save & Test Anthropic'}
          </button>
          {anthropicResult && (
            <div className={`mt-3 p-3 text-[13px] border ${anthropicResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>
              {anthropicResult.ok
                ? `Connected — model ${anthropicResult.model} (${anthropicResult.route ?? 'direct'})${anthropicResult.elapsedMs != null ? ` · ${anthropicResult.elapsedMs}ms` : ''}`
                : anthropicResult.error}
            </div>
          )}
          {anthropicResult?.logs && anthropicResult.logs.length > 0 && (
            <pre className="mt-3 bg-[#faf8f2] text-[10px] font-mono-qa p-3 overflow-x-auto border border-qa-border m-0 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {anthropicResult.logs.join('\n')}
            </pre>
          )}
          {anthropicError && !anthropicResult && (
            <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">
              {anthropicError}
            </div>
          )}
        </QaSection>

        <QaSection title="Active connection summary">
          {integrations && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="border border-qa-border p-3 bg-[#faf8f2]">
                <p className="font-semibold text-[13px] m-0">JIRA</p>
                <p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">
                  {jiraConnections.length ? `${jiraConnections.length} browser connection(s)` : (integrations.jira.enabled ? 'Config file enabled' : 'Disabled')}
                </p>
              </div>
              <div className="border border-qa-border p-3 bg-[#faf8f2]">
                <p className="font-semibold text-[13px] m-0">QMetry</p>
                <p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">
                  {qmetryConnections.length ? `${qmetryConnections.length} browser connection(s)` : `${integrations.qmetry.enabled ? 'Enabled' : 'Disabled'} · ${integrations.qmetry.cycleIds} cycle(s)`}
                </p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              saveAll();
              testMutation.mutate();
            }}
            disabled={testMutation.isPending}
            className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50"
            style={{ background: QA.accent }}
          >
            {testMutation.isPending ? 'Testing…' : 'Save & Test all connections'}
          </button>
          {testResult && (
            <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>
              {testResult.ok ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} UAT rows` : testResult.error}
            </div>
          )}
          {savedMsg && <div className="mt-3 p-3 text-[13px] border border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]">{savedMsg}</div>}
        </QaSection>

        <QaSection title="JIRA connections" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">
            Add one or more JIRA dashboards. Use this for cloud + on-prem, multiple projects, or multiple environments.
          </p>
          {jiraConnections.map((conn, idx) => (
            <JiraConnectionCard
              key={conn.id}
              conn={conn}
              onChange={(next) => setJiraConnectionsState(jiraConnections.map((c, i) => (i === idx ? next : c)))}
              onRemove={() => setJiraConnectionsState(jiraConnections.filter((_, i) => i !== idx))}
            />
          ))}
          <button
            type="button"
            onClick={() => setJiraConnectionsState([...jiraConnections, blankJiraConnection()])}
            className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer"
          >
            + Add JIRA connection
          </button>
        </QaSection>

        <QaSection title="QMetry connections" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">
            Add QMetry connections to fetch test cycles/test case executions. Cycle IDs are optional if Project ID can list cycles.
          </p>
          {qmetryConnections.map((conn, idx) => (
            <QmetryConnectionCard
              key={conn.id}
              conn={conn}
              onChange={(next) => setQmetryConnectionsState(qmetryConnections.map((c, i) => (i === idx ? next : c)))}
              onRemove={() => setQmetryConnectionsState(qmetryConnections.filter((_, i) => i !== idx))}
            />
          ))}
          <button
            type="button"
            onClick={() => setQmetryConnectionsState([...qmetryConnections, blankQmetryConnection()])}
            className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border border-qa-border bg-white cursor-pointer"
          >
            + Add QMetry connection
          </button>
        </QaSection>

        <QaSection title="Cycle / Folder list" className="lg:col-span-2">
          <p className="text-[13px] text-qa-muted m-0 mb-3">
            Used for filtering/report selection. Live QMetry cycles are shown when available; otherwise imported cycle names are listed.
          </p>
          <div className="text-[12px] text-qa-muted mb-2">
            Source: <span className="font-mono-qa text-qa-ink">{cycles?.source || 'not loaded'}</span>
            {cycles?.connection ? ` · ${cycles.connection}` : ''}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
            {(cycles?.cycles || []).map((c) => (
              <div key={c.id} className="border border-qa-border bg-[#faf8f2] px-3 py-2 font-mono-qa text-[11px]">
                <span className="text-qa-muted-light">{c.id}</span> · {c.name}
              </div>
            ))}
            {!cycles?.cycles?.length && <div className="text-[13px] text-qa-muted">No cycles found yet. Configure QMetry or generate a report from imported files.</div>}
          </div>
        </QaSection>

        <QaSection title="Folder paths">
          <ul className="text-[13px] text-qa-muted m-0 p-0 list-none space-y-2 font-mono-qa">
            <li><span className="text-qa-ink">input/</span> — staged Excel exports</li>
            <li><span className="text-qa-ink">output/</span> — dashboard-data.json, report.md</li>
            <li><span className="text-qa-ink">config/</span> — fallback integrations.json</li>
          </ul>
        </QaSection>

        <QaSection title="CLI generate">
          <pre className="bg-[#faf8f2] text-[12px] font-mono-qa p-4 overflow-x-auto border border-qa-border m-0">{`./run.sh generate 2026-06-24 2026-06-30 full`}</pre>
        </QaSection>
      </div>

      <QaSection className="mt-[22px]">
        <p className="text-[13px] text-qa-muted m-0 leading-relaxed">
          <strong className="text-qa-ink">Privacy model:</strong> Browser settings are stored locally in localStorage and are only sent to this API while you use the app. They are never written to config files, output files, or logs.
        </p>
      </QaSection>
    </QaPageShell>
  );
}
