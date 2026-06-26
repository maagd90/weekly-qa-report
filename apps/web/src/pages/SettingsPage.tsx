import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Trash2, Wifi, CheckCircle, AlertCircle, Eye, EyeOff, Shield, Hammer, RefreshCw } from 'lucide-react';
import { settingsApi, jenkinsApi } from '../lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();

  // Claude state
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Jenkins state
  const [jenkinsUrl, setJenkinsUrl] = useState('');
  const [jenkinsUsername, setJenkinsUsername] = useState('');
  const [jenkinsToken, setJenkinsToken] = useState('');
  const [showJenkinsToken, setShowJenkinsToken] = useState(false);
  const [jenkinsPollInterval, setJenkinsPollInterval] = useState(5);
  const [jenkinsTestResult, setJenkinsTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: aiSettings, isLoading } = useQuery({
    queryKey: ['settings-ai'],
    queryFn: settingsApi.getAi,
  });

  const { data: jenkinsSettings } = useQuery({
    queryKey: ['settings-jenkins'],
    queryFn: jenkinsApi.getSettings,
    onSuccess: (d: { url: string; username: string; pollIntervalMinutes: number }) => {
      if (d.url) setJenkinsUrl(d.url);
      if (d.username) setJenkinsUsername(d.username);
      if (d.pollIntervalMinutes) setJenkinsPollInterval(d.pollIntervalMinutes);
    },
  } as Parameters<typeof useQuery>[0]);

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.saveAiKey(apiKey),
    onSuccess: () => {
      setApiKey('');
      setTestResult(null);
      queryClient.invalidateQueries({ queryKey: ['settings-ai'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: settingsApi.deleteAiKey,
    onSuccess: () => {
      setTestResult(null);
      queryClient.invalidateQueries({ queryKey: ['settings-ai'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: settingsApi.testAiKey,
    onSuccess: (data: { ok: boolean; response?: string }) => {
      setTestResult({ ok: true, message: `Connected! Claude responded: "${data.response}"` });
    },
    onError: (err: unknown) => {
      setTestResult({ ok: false, message: (err as Error).message });
    },
  });

  // Jenkins mutations
  const saveJenkinsMutation = useMutation({
    mutationFn: () => jenkinsApi.saveSettings({
      url: jenkinsUrl, username: jenkinsUsername,
      apiToken: jenkinsToken, pollIntervalMinutes: jenkinsPollInterval,
    }),
    onSuccess: () => {
      setJenkinsToken('');
      setJenkinsTestResult(null);
      queryClient.invalidateQueries({ queryKey: ['settings-jenkins'] });
      queryClient.invalidateQueries({ queryKey: ['jenkins'] });
    },
  });

  const deleteJenkinsMutation = useMutation({
    mutationFn: jenkinsApi.deleteSettings,
    onSuccess: () => {
      setJenkinsUrl(''); setJenkinsUsername(''); setJenkinsToken('');
      setJenkinsTestResult(null);
      queryClient.invalidateQueries({ queryKey: ['settings-jenkins'] });
    },
  });

  const testJenkinsMutation = useMutation({
    mutationFn: jenkinsApi.testConnection,
    onSuccess: (data: { ok: boolean; jobCount?: number; error?: string }) => {
      setJenkinsTestResult(data.ok
        ? { ok: true, message: `Connected! Found ${data.jobCount} job(s).` }
        : { ok: false, message: data.error || 'Connection failed' });
    },
    onError: (err: unknown) => setJenkinsTestResult({ ok: false, message: (err as Error).message }),
  });

  const jenkinsConfigured = (jenkinsSettings as { configured?: boolean } | undefined)?.configured ?? false;

  const keyConfigured = aiSettings?.keyConfigured ?? false;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Configure the Claude AI integration for report generation.</p>
      </div>

      {/* Claude API Key section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="bg-violet-50 rounded-xl p-2.5">
            <Key size={20} className="text-violet-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Claude API Key</h3>
            <p className="text-xs text-slate-500">Your key is stored encrypted server-side and never exposed to the browser.</p>
          </div>
          <div className="ml-auto">
            {isLoading ? null : keyConfigured ? (
              <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
                <CheckCircle size={12} /> Key configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 text-xs font-medium px-3 py-1 rounded-full">
                Not configured
              </span>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">
            {keyConfigured ? 'Replace API Key' : 'Enter Claude API Key'}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Get your key at{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-violet-500 underline">
              console.anthropic.com
            </a>
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!apiKey.trim() || saveMutation.isPending}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-5 py-2.5 rounded-xl transition disabled:opacity-50"
          >
            <Key size={14} />
            {saveMutation.isPending ? 'Saving…' : 'Save Key'}
          </button>

          {keyConfigured && (
            <>
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2.5 rounded-xl transition disabled:opacity-50"
              >
                <Wifi size={14} />
                {testMutation.isPending ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm px-4 py-2.5 rounded-xl transition disabled:opacity-50"
              >
                <Trash2 size={14} />
                Remove Key
              </button>
            </>
          )}
        </div>

        {/* Result messages */}
        {saveMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-4 py-3">
            <CheckCircle size={14} /> Key saved successfully.
          </div>
        )}
        {saveMutation.error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-xl px-4 py-3">
            <AlertCircle size={14} /> {(saveMutation.error as Error).message}
          </div>
        )}
        {testResult && (
          <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 ${testResult.ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
            {testResult.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
            {testResult.message}
          </div>
        )}
      </div>

      {/* ── Jenkins section ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="bg-orange-50 rounded-xl p-2.5">
            <Hammer size={20} className="text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Jenkins Integration</h3>
            <p className="text-xs text-slate-500">Connect to Jenkins to sync build status and test results automatically.</p>
          </div>
          <div className="ml-auto">
            {jenkinsConfigured ? (
              <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
                <CheckCircle size={12} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 text-xs font-medium px-3 py-1 rounded-full">
                Not configured
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">Jenkins URL</label>
            <input
              type="url"
              placeholder="https://jenkins.yourcompany.com"
              value={jenkinsUrl}
              onChange={(e) => setJenkinsUrl(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Username</label>
            <input
              type="text"
              placeholder="jenkins-user (optional for some setups)"
              value={jenkinsUsername}
              onChange={(e) => setJenkinsUsername(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">API Token</label>
            <div className="relative">
              <input
                type={showJenkinsToken ? 'text' : 'password'}
                placeholder="API token from Jenkins → User → Configure"
                value={jenkinsToken}
                onChange={(e) => setJenkinsToken(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 pr-10"
              />
              <button type="button" onClick={() => setShowJenkinsToken(!showJenkinsToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showJenkinsToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Poll Interval (minutes)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={jenkinsPollInterval}
              onChange={(e) => setJenkinsPollInterval(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => saveJenkinsMutation.mutate()}
            disabled={!jenkinsUrl.trim() || saveJenkinsMutation.isPending}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white text-sm px-5 py-2.5 rounded-xl transition disabled:opacity-50"
          >
            <Hammer size={14} />
            {saveJenkinsMutation.isPending ? 'Saving…' : 'Save & Start Polling'}
          </button>
          {jenkinsConfigured && (
            <>
              <button onClick={() => testJenkinsMutation.mutate()} disabled={testJenkinsMutation.isPending}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2.5 rounded-xl transition disabled:opacity-50">
                <Wifi size={14} />
                {testJenkinsMutation.isPending ? 'Testing…' : 'Test Connection'}
              </button>
              <button onClick={() => deleteJenkinsMutation.mutate()} disabled={deleteJenkinsMutation.isPending}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm px-4 py-2.5 rounded-xl transition disabled:opacity-50">
                <Trash2 size={14} /> Disconnect
              </button>
            </>
          )}
        </div>

        {saveJenkinsMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl px-4 py-3">
            <CheckCircle size={14} /> Jenkins settings saved. Polling started.
          </div>
        )}
        {jenkinsTestResult && (
          <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 ${jenkinsTestResult.ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
            {jenkinsTestResult.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
            {jenkinsTestResult.message}
          </div>
        )}

        <div className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 space-y-1">
          <p className="font-medium text-slate-600">How to get a Jenkins API token:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Log in to Jenkins → click your username (top right)</li>
            <li>Click <strong>Configure</strong></li>
            <li>Scroll to <strong>API Token</strong> → click <strong>Add new Token</strong></li>
            <li>Copy the token and paste it above</li>
          </ol>
        </div>
      </div>

      {/* Security note */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex gap-3">
        <Shield size={18} className="text-slate-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-600 space-y-1">
          <p className="font-medium text-slate-700">Security</p>
          <p>The API key is encrypted using AES-256 before being stored in the local database. It is never included in any response sent to the browser — only a boolean <code className="bg-slate-200 px-1 rounded text-xs">keyConfigured</code> flag is exposed.</p>
          <p>All AI tool queries use parameterized SQL — Claude cannot inject SQL through its tool calls.</p>
        </div>
      </div>
    </div>
  );
}
