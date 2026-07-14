import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { runGenerate } from '../../runGenerate';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-scope-'));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  const configDir = path.join(root, 'config');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    {
      'Test Cycle Key': 'DLM-TR-1',
      'Test Cycle Summary': 'July regression',
      'Test Case Key': 'DLM-TC-1',
      'Testcase/Teststep Execution Result': 'Pass',
      'Executed On': '10/Jul/2026',
      'Executed By': 'Tester One',
    },
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Executions');
  XLSX.writeFile(workbook, path.join(inputDir, 'executions.xlsx'));

  const globalDashboard = '{"sentinel":"global-dashboard"}';
  const globalRaw = '{"sentinel":"global-raw"}';
  const globalFingerprint = 'global-fingerprint';
  fs.writeFileSync(path.join(outputDir, 'dashboard-data.json'), globalDashboard);
  fs.writeFileSync(path.join(outputDir, 'raw-dataset.json'), globalRaw);
  fs.writeFileSync(path.join(outputDir, 'dataset-fingerprint.txt'), globalFingerprint);

  try {
    const result = await runGenerate({
      reportType: 'executive',
      project: 'DLM',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      inputDir,
      outputDir,
      configDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload?.overview.totalCases, 1);
    assert.equal(path.basename(result.paths.dashboard), 'report-dashboard.json');
    assert.equal(path.basename(result.paths.raw), 'report-raw-dataset.json');
    assert.ok(fs.existsSync(path.join(outputDir, 'report-dashboard.json')));
    assert.ok(fs.existsSync(path.join(outputDir, 'report-raw-dataset.json')));
    assert.ok(fs.existsSync(path.join(outputDir, 'report-dataset-fingerprint.txt')));
    assert.ok(fs.existsSync(path.join(outputDir, 'report-meta.json')), 'chart-only reports still need persisted scope metadata');

    assert.equal(fs.readFileSync(path.join(outputDir, 'dashboard-data.json'), 'utf8'), globalDashboard, 'report generation must not overwrite the global dashboard snapshot');
    assert.equal(fs.readFileSync(path.join(outputDir, 'raw-dataset.json'), 'utf8'), globalRaw, 'report generation must not overwrite the global raw dataset');
    assert.equal(fs.readFileSync(path.join(outputDir, 'dataset-fingerprint.txt'), 'utf8'), globalFingerprint, 'report generation must not overwrite the global dataset fingerprint');

    const reportDashboard = JSON.parse(fs.readFileSync(path.join(outputDir, 'report-dashboard.json'), 'utf8')) as { scope: { startDate?: string; endDate?: string; project?: string } };
    assert.deepEqual(reportDashboard.scope, { startDate: '2026-07-01', endDate: '2026-07-14', search: '', result: 'all', project: 'DLM', projects: ['DLM'] });
    console.log('report scope isolation tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
