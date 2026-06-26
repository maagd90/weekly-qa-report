import fs from 'fs';
import path from 'path';
import type { GenerateParams, GenerateResult } from './types/dataset';
import { discoverInputFiles, parseFile } from './parsers/dispatcher';
import { mergeDatasets } from './merge/mergeDatasets';
import { buildDashboardPayload } from './export/dashboardJson';
import { generateReportFromDataset } from './ai/reportWriter';

function resolveRoot(): string {
  return path.resolve(__dirname, '../../..');
}

export async function runGenerate(params: GenerateParams): Promise<GenerateResult> {
  const root = resolveRoot();
  const inputDir = params.inputDir || path.join(root, 'input');
  const outputDir = params.outputDir || path.join(root, 'output');
  const configDir = params.configDir || path.join(root, 'config');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const files = discoverInputFiles(inputDir);
  if (files.length === 0) {
    return {
      ok: false,
      filesParsed: 0,
      rowCounts: {},
      warnings: ['No files found in input folder'],
      paths: { dashboard: '', report: '', meta: '' },
      error: 'No input files in ' + inputDir,
    };
  }

  const parts = [];
  for (const file of files) {
    parts.push(await parseFile(file, { configDir }));
  }
  const dataset = mergeDatasets(parts);

  const dashboardPath = path.join(outputDir, 'dashboard-data.json');
  const reportPath = path.join(outputDir, 'report.md');
  const metaPath = path.join(outputDir, 'report-meta.json');

  const payload = buildDashboardPayload(dataset, params);
  fs.writeFileSync(dashboardPath, JSON.stringify(payload, null, 2));

  const apiKey = params.apiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return {
      ok: false,
      filesParsed: files.length,
      rowCounts: {
        resources: dataset.resources.length,
        weeklyLog: dataset.weeklyLog.length,
        projectStatus: dataset.projectStatusWeekly.length,
      },
      warnings: [...dataset.meta.warnings, 'ANTHROPIC_API_KEY not set — dashboard JSON written, report skipped'],
      paths: { dashboard: dashboardPath, report: '', meta: '' },
      error: 'ANTHROPIC_API_KEY required for AI report',
    };
  }

  const report = await generateReportFromDataset(dataset, params, apiKey);
  fs.writeFileSync(reportPath, report.markdown);
  fs.writeFileSync(metaPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    params,
    toolCalls: report.toolCalls,
  }, null, 2));

  return {
    ok: true,
    filesParsed: files.length,
    rowCounts: {
      resources: dataset.resources.length,
      projects: dataset.projects.length,
      crs: dataset.crs.length,
      weeklyLog: dataset.weeklyLog.length,
      projectStatus: dataset.projectStatusWeekly.length,
    },
    warnings: dataset.meta.warnings,
    paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath },
  };
}
