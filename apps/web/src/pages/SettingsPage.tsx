import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Trash2, Wifi, CheckCircle, AlertCircle, Eye, EyeOff, Shield } from 'lucide-react';
import { settingsApi } from '../lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: aiSettings, isLoading } = useQuery({
    queryKey: ['settings-ai'],
    queryFn: settingsApi.getAi,
  });

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
