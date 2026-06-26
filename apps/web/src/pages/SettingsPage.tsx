import React from 'react';
import { Key, Shield, FolderOpen, FileOutput } from 'lucide-react';

export function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Configuration is file-based — no database or in-app key storage.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-violet-50 rounded-xl p-2.5">
            <Key size={20} className="text-violet-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Claude API Key</h3>
            <p className="text-xs text-slate-500">Set in the project root <code className="bg-slate-100 px-1 rounded">.env</code> file.</p>
          </div>
        </div>
        <pre className="bg-slate-900 text-slate-100 text-sm rounded-xl p-4 overflow-x-auto">ANTHROPIC_API_KEY=sk-ant-api03-...</pre>
        <p className="text-xs text-slate-500">
          Get a key at{' '}
          <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-violet-500 underline">
            console.anthropic.com
          </a>
          . Restart the API server after changing <code className="bg-slate-100 px-1 rounded">.env</code>.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <FolderOpen size={20} className="text-blue-600" />
          <h3 className="font-semibold text-slate-800">Folders</h3>
        </div>
        <ul className="text-sm text-slate-600 space-y-2">
          <li><code className="bg-slate-100 px-1 rounded">input/</code> — staged export files (upload does not parse)</li>
          <li><code className="bg-slate-100 px-1 rounded">output/</code> — last <code className="bg-slate-100 px-1 rounded">dashboard-data.json</code> and <code className="bg-slate-100 px-1 rounded">report.md</code></li>
          <li><code className="bg-slate-100 px-1 rounded">config/mappings/</code> — saved JIRA column maps</li>
        </ul>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <FileOutput size={20} className="text-green-600" />
          <h3 className="font-semibold text-slate-800">CLI generate</h3>
        </div>
        <pre className="bg-slate-50 text-sm rounded-xl p-4 overflow-x-auto border border-slate-200">{`npm run generate -- \\
  --start-date 2026-06-21 \\
  --end-date 2026-06-26 \\
  --report-type full`}</pre>
        <p className="text-xs text-slate-500">Windows: run <code className="bg-slate-100 px-1 rounded">scripts/generate-report.bat</code></p>
      </div>

      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex gap-3">
        <Shield size={18} className="text-slate-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-600 space-y-1">
          <p className="font-medium text-slate-700">Zero-hallucination reports</p>
          <p>Claude calls eight dataset tools that filter in-memory parsed data for the requested date range. No SQL, no invented metrics.</p>
        </div>
      </div>
    </div>
  );
}
