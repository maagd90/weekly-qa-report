import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGenerate } from '../../runGenerate';
import { emptyDataset } from '../../types/dataset';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-portfolio-narrative-'));
  const outputDir = path.join(root, 'output');
  const configDir = path.join(root, 'config');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'report.json'), JSON.stringify({ provider: 'template', model: 'template-v1', maxTokens: 6000 }));

  const dataset = emptyDataset();
  dataset.projects = ['DLM', 'TRAVEL', 'EMPTY'];
  dataset.executions = [
    { project: 'DLM', cycleKey: 'DLM-C1', cycleName: 'DLM cycle', caseKey: 'DLM-T1', result: 'PASS', tester: 'QA One', executedAt: '2026-07-10', updatedAt: '2026-07-10', source: 'qmetry' },
    { project: 'TRAVEL', cycleKey: 'TVL-C1', cycleName: 'Travel cycle', caseKey: 'TVL-T1', result: 'FAIL', tester: 'QA Two', executedAt: '2026-07-11', updatedAt: '2026-07-11', source: 'qmetry' },
  ];
  dataset.meta.parsedAt = '2026-07-23T08:00:00.000Z';

  try {
    const result = await runGenerate({
      reportType: 'full',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      outputDir,
      configDir,
      sourceDataset: dataset,
      llm: { provider: 'template' },
      capabilitiesByProject: {
        DLM: { vendorPortal: true, wonderMilesExport: false },
        TRAVEL: { vendorPortal: false, wonderMilesExport: true },
        EMPTY: { vendorPortal: false, wonderMilesExport: false },
      },
      projectNamesByKey: {
        DLM: 'DN4_FT - Supply & DMC',
        TRAVEL: 'Wonder Miles',
        EMPTY: 'Empty Project',
      },
      connections: {
        jira: [{
          id: 'jira-1',
          name: 'Jira',
          baseUrl: 'https://jira.example.test',
          email: 'qa@example.test',
          apiToken: 'jira-api-secret',
          cookie: 'JSESSIONID=private-cookie',
          jiraSessionId: 'private-session',
          jiraXsrfToken: 'private-xsrf',
          projectKeys: ['DLM'],
        }],
        qmetry: [{
          id: 'qmetry-1',
          name: 'QMetry',
          baseUrl: 'https://qmetry.example.test',
          email: 'qa@example.test',
          credential: 'private-credential',
          sessionHeader: 'private-header',
          sessionId: 'private-session-id',
          xsrfToken: 'private-qmetry-xsrf',
          projectKey: 'DLM',
        }],
      },
    });

    assert.equal(result.ok, true);
    assert.ok(result.report?.narrative?.portfolio);
    assert.deepStrictEqual(result.report?.narrative?.projectOrder, ['DLM', 'TRAVEL', 'EMPTY']);
    assert.match(result.report?.narrative?.assembledMarkdown || '', /## Portfolio summary/);
    assert.match(result.report?.narrative?.assembledMarkdown || '', /## DN4_FT - Supply & DMC/);
    assert.match(result.report?.narrative?.assembledMarkdown || '', /## Wonder Miles/);
    assert.match(result.report?.narrative?.projects.DLM.markdown || '', /100%/);
    assert.match(result.report?.narrative?.projects.TRAVEL.markdown || '', /0%/);
    assert.doesNotMatch(result.report?.narrative?.projects.DLM.markdown || '', /Travel cycle/);
    assert.doesNotMatch(result.report?.narrative?.projects.TRAVEL.markdown || '', /DLM cycle/);
    assert.equal(result.report?.narrative?.projects.EMPTY.status, 'unavailable');

    const meta = JSON.parse(fs.readFileSync(result.paths.meta, 'utf8')) as { narrative?: { projectOrder?: string[] }; params?: Record<string, unknown> };
    assert.deepStrictEqual(meta.narrative?.projectOrder, ['DLM', 'TRAVEL', 'EMPTY']);
    assert.equal(meta.params?.capabilitiesByProject, undefined);
    assert.equal(meta.params?.projectNamesByKey, undefined);
    const persistedMeta = fs.readFileSync(result.paths.meta, 'utf8');
    for (const secret of ['jira-api-secret', 'private-cookie', 'private-session', 'private-xsrf', 'private-credential', 'private-header', 'private-session-id', 'private-qmetry-xsrf']) {
      assert.doesNotMatch(persistedMeta, new RegExp(secret));
    }
    assert.match(persistedMeta, /\*\*\*redacted\*\*\*/);
    assert.equal(fs.readFileSync(result.paths.report, 'utf8'), result.report?.narrative?.assembledMarkdown);
    console.log('portfolio narrative isolation tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
