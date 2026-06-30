import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Key, Shield, FolderOpen, FileOutput, Plug, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { batchApi } from '../lib/api';

export function SettingsPage() {
  const { data: integrations, refetch } = useQuery({
    queryKey: ['integrations'],
    queryFn: batchApi.getIntegrations,
  });

  const testMutation = useMutation({
    mutationFn: batchApi.testIntegrations,
    onSuccess: () => refetch(),
  });

  const testResult = testMutation.data as { ok?: boolean; executions?: number; issues?: number; uat?: number; warnings?: string[]; error?: string } | undefined;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Configuration via <code className="bg-slate-100 px-1 rounded">config/integrations.json</code> and <code className="bg-slate-100 px-1 rounded">.env</code>.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Plug size={20} className="text-blue-600" />
          <h3 className="font-semibold text-slate-800">Integrations</h3>
        </div>
        {integrations && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="font-medium">JIRA</p>
              <p className="text-xs text-slate-500 mt-1">{integrations.jira.enabled ? 'Enabled' : 'Disabled'} · {integrations.jira.configured ? 'Credentials OK' : 'Missing credentials'}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="font-medium">QMetry</p>
              <p className="text-xs text-slate-500 mt-1">{integrations.qmetry.enabled ? 'Enabled' : 'Disabled'} · {integrations.qmetry.cycleIds} cycle(s)</p>
            </div>
          </div>
        )}
        <button
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
          className="flex items-center gap-2 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {testMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          Test connections
        </button>
        {testResult && (
          <div className={`rounded-lg p-3 text-sm flex gap-2 ${testResult.ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
            {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {testResult.ok
              ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} UAT rows`
              : testResult.error}
          </div>
        )}
        <pre className="bg-slate-50 text-xs rounded-xl p-4 overflow-x-auto border border-slate-200">{`cp config/integrations.example.json config/integrations.json
# Edit cycleIds, enable jira/qmetry, set .env:
JIRA_EMAIL=you@emirates.com
JIRA_API_TOKEN=...`}</pre>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Key size={20} className="text-violet-600" />
          <h3 className="font-semibold text-slate-800">Claude API Key</h3>
        </div>
        <pre className="bg-slate-900 text-slate-100 text-sm rounded-xl p-4 overflow-x-auto">ANTHROPIC_API_KEY=sk-ant-api03-...</pre>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <FolderOpen size={20} className="text-blue-600" />
        <ul className="text-sm text-slate-600 space-y-2">
          <li><code className="bg-slate-100 px-1 rounded">input/</code> — staged Excel exports</li>
          <li><code className="bg-slate-100 px-1 rounded">output/</code> — dashboard-data.json, raw-dataset.json, report.md</li>
          <li><code className="bg-slate-100 px-1 rounded">config/integrations.json</code> — JIRA & QMetry settings</li>
        </ul>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <FileOutput size={20} className="text-green-600" />
        <pre className="bg-slate-50 text-sm rounded-xl p-4 overflow-x-auto border border-slate-200">{`npm run generate -- \\
  --start-date 2026-06-24 \\
  --end-date 2026-06-30 \\
  --report-type full`}</pre>
      </div>

      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex gap-3">
        <Shield size={18} className="text-slate-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-600">
          <p className="font-medium text-slate-700">Zero-hallucination reports</p>
          <p>Claude calls six DLM dataset tools on filtered in-memory data. Updated-date filtering includes rows modified within the date range.</p>
        </div>
      </div>
    </div>
  );
}
