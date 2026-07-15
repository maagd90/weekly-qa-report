import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { generateLlmText } from '../llmProviders';
import { testLlmConnection } from '../testConnection';
import { loadReportConfig } from '../../config/loadReportConfig';
import { resolveReportLlmConfig } from '../reportWriter';
import { runGenerate } from '../../runGenerate';

/** Restores one process environment variable after a scoped test mutation. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Verifies model isolation, no-network validation, and full report generation. */
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-template-provider-'));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  const configDir = path.join(root, 'config');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const previousProvider = process.env.LLM_PROVIDER;
  const previousModel = process.env.LLM_MODEL;
  const previousAnthropicModel = process.env.ANTHROPIC_MODEL;

  try {
    fs.writeFileSync(path.join(configDir, 'report.json'), JSON.stringify({
      provider: 'anthropic',
      model: 'old-claude-model',
      maxTokens: 6000,
    }));
    process.env.LLM_PROVIDER = 'template';
    delete process.env.LLM_MODEL;
    process.env.ANTHROPIC_MODEL = 'environment-claude-model';

    const config = loadReportConfig(configDir);
    assert.strictEqual(config.provider, 'template');
    assert.strictEqual(config.model, 'template-v1', 'template must not inherit a model from another provider');

    const resolved = resolveReportLlmConfig({ reportType: 'full', llm: { provider: 'template' } }, configDir);
    assert.strictEqual(resolved.model, 'template-v1');
    assert.strictEqual(resolved.apiKey, '');

    const connection = await testLlmConnection({ provider: 'template' }, configDir);
    assert.strictEqual(connection.ok, true);
    assert.strictEqual(connection.model, 'template-v1');
    assert.match(connection.logs?.join('\n') || '', /no API key or network call is required/);

    await assert.rejects(
      generateLlmText({ provider: 'template', model: 'template-v1', apiKey: '', maxTokens: 100, system: 'system', prompt: 'prompt' }),
      /never makes network calls/,
    );

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      {
        'Test Cycle Key': 'DLM-TR-1',
        'Test Cycle Summary': 'Template cycle',
        'Test Case Key': 'DLM-TC-1',
        'Testcase/Teststep Execution Result': 'Pass',
        'Executed On': '10/Jul/2026',
        'Executed By': 'Muhammad Annus',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Executions');
    XLSX.writeFile(workbook, path.join(inputDir, 'executions.xlsx'));

    const generated = await runGenerate({
      reportType: 'full',
      project: 'DLM',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      inputDir,
      outputDir,
      configDir,
      llm: { provider: 'template' },
    });
    assert.strictEqual(generated.ok, true);
    assert.ok(generated.paths.report);
    assert.ok(fs.existsSync(generated.paths.report));
    const markdown = fs.readFileSync(generated.paths.report, 'utf8');
    assert.match(markdown, /Full QA summary/);
    assert.match(markdown, /Quality Assurance member/);
    assert.doesNotMatch(markdown, /API key|AI-generated|\btester(?:s)?\b/i);

    const meta = JSON.parse(fs.readFileSync(generated.paths.meta, 'utf8')) as { llm?: { provider?: string; model?: string } };
    assert.deepStrictEqual(meta.llm && { provider: meta.llm.provider, model: meta.llm.model }, { provider: 'template', model: 'template-v1' });
    console.log('template provider integration tests passed');
  } finally {
    restoreEnv('LLM_PROVIDER', previousProvider);
    restoreEnv('LLM_MODEL', previousModel);
    restoreEnv('ANTHROPIC_MODEL', previousAnthropicModel);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
