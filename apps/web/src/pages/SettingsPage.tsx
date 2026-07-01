import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { batchApi, apiErrorMessage } from '../lib/api';
import { QaPageShell, QaSection } from '../components/layout/QaPageShell';
import { QA } from '../theme/qaTheme';

export function SettingsPage() {
  const { data: integrations, refetch } = useQuery({
    queryKey: ['integrations'],
    queryFn: batchApi.getIntegrations,
  });

  const testMutation = useMutation({
    mutationFn: batchApi.testIntegrations,
    onSuccess: () => refetch(),
  });

  const anthropicTest = useMutation({
    mutationFn: batchApi.testAnthropic,
  });
  const anthropicResult = anthropicTest.data;
  const anthropicError = anthropicTest.isError
    ? apiErrorMessage(anthropicTest.error, 'Anthropic connectivity test failed')
    : undefined;

  const testResult = testMutation.data as {
    ok?: boolean; executions?: number; issues?: number; uat?: number; error?: string;
  } | undefined;

  return (
    <QaPageShell
      title="Settings"
      intro="Configuration via config/integrations.json and .env. These settings control live JIRA/QMetry fetch and Claude AI reports."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        <QaSection title="Integrations">
          {integrations && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="border border-qa-border p-3 bg-[#faf8f2]">
                <p className="font-semibold text-[13px] m-0">JIRA</p>
                <p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">
                  {integrations.jira.enabled ? 'Enabled' : 'Disabled'} · {integrations.jira.configured ? 'Credentials OK' : 'Missing credentials'}
                </p>
              </div>
              <div className="border border-qa-border p-3 bg-[#faf8f2]">
                <p className="font-semibold text-[13px] m-0">QMetry</p>
                <p className="font-mono-qa text-[10px] text-qa-muted-light mt-1 m-0">
                  {integrations.qmetry.enabled ? 'Enabled' : 'Disabled'} · {integrations.qmetry.cycleIds} cycle(s)
                </p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50"
            style={{ background: QA.accent }}
          >
            {testMutation.isPending ? 'Testing…' : 'Test connections'}
          </button>
          {testResult && (
            <div className={`mt-3 p-3 text-[13px] border ${testResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>
              {testResult.ok
                ? `Fetched ${testResult.executions} executions, ${testResult.issues} issues, ${testResult.uat} UAT rows`
                : testResult.error}
            </div>
          )}
          <pre className="mt-4 bg-[#faf8f2] text-[11px] font-mono-qa p-4 overflow-x-auto border border-qa-border m-0">{`cp config/integrations.example.json config/integrations.json
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
QMETRY_BASIC_AUTH=Basic xxxxx`}</pre>
        </QaSection>

        <QaSection title="Claude API Key">
          <p className="text-[13px] text-qa-muted m-0 mb-3">Set in .env for AI Report generation.</p>
          <pre className="bg-qa-ink text-[#F5F3ED] text-sm font-mono-qa p-4 overflow-x-auto m-0">ANTHROPIC_API_KEY=sk-ant-api03-...</pre>
          <button
            type="button"
            onClick={() => anthropicTest.mutate()}
            disabled={anthropicTest.isPending}
            className="mt-3 font-mono-qa text-xs font-semibold tracking-wider uppercase px-4 py-2.5 border-none cursor-pointer text-white disabled:opacity-50"
            style={{ background: QA.accent }}
          >
            {anthropicTest.isPending ? 'Testing…' : 'Test Anthropic connection'}
          </button>
          {anthropicResult && (
            <div className={`mt-3 p-3 text-[13px] border ${anthropicResult.ok ? 'border-[#cfe0d4] bg-[#eef4ef] text-[#2f6a48]' : 'border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]'}`}>
              {anthropicResult.ok
                ? `Connected — model ${anthropicResult.model}${anthropicResult.proxyUsed ? ` (via proxy${anthropicResult.proxyUrl ? `: ${anthropicResult.proxyUrl}` : ''})` : ' (direct)'}${anthropicResult.elapsedMs != null ? ` · ${anthropicResult.elapsedMs}ms` : ''}`
                : anthropicResult.error}
            </div>
          )}
          {anthropicError && !anthropicResult && (
            <div className="mt-3 p-3 text-[13px] border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c]">
              {anthropicError}
            </div>
          )}
        </QaSection>

        <QaSection title="Folder paths">
          <ul className="text-[13px] text-qa-muted m-0 p-0 list-none space-y-2 font-mono-qa">
            <li><span className="text-qa-ink">input/</span> — staged Excel exports</li>
            <li><span className="text-qa-ink">output/</span> — dashboard-data.json, report.md</li>
            <li><span className="text-qa-ink">config/</span> — integrations.json</li>
          </ul>
        </QaSection>

        <QaSection title="CLI generate">
          <pre className="bg-[#faf8f2] text-[12px] font-mono-qa p-4 overflow-x-auto border border-qa-border m-0">{`./run.sh generate 2026-06-24 2026-06-30 full`}</pre>
        </QaSection>
      </div>

      <QaSection className="mt-[22px]">
        <p className="text-[13px] text-qa-muted m-0 leading-relaxed">
          <strong className="text-qa-ink">Zero-hallucination reports:</strong> Claude calls six DLM dataset tools on filtered in-memory data. Every figure in the AI report traces to a real row in the parsed dataset.
        </p>
      </QaSection>
    </QaPageShell>
  );
}
