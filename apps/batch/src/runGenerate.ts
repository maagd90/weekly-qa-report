import fs from 'fs';
import path from 'path';
import type { ApiFetchScope, DashboardPayload, GenerateParams, GenerateResult } from './types/dataset';
import { buildDataset, computeFingerprint, loadFingerprint, loadRawDataset, saveRawDataset } from './cache/datasetCache';
import { buildDashboardPayload } from './export/buildDashboardPayload';
import { hasDashboardMetrics, noMetricsForScopeMessage } from './export/reportMetrics';
import { generateReportFromDataset } from './ai/reportWriter';
import { discoverInputFiles } from './parse/dispatcher';
import { canonicalProjectOrUndefined } from './projects/projectKey';

function resolveRoot(): string { return path.resolve(__dirname, '../../..'); }

function validDate(value?: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : undefined;
}

function hasBrowserConnections(params: GenerateParams): boolean {
  return Boolean(params.connections?.jira?.length || params.connections?.qmetry?.length);
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function clearStaleReportFiles(reportPath: string, metaPath: string): void {
  removeIfExists(reportPath);
  removeIfExists(metaPath);
}

function sanitizeParamsForMeta(params: GenerateParams): GenerateParams {
  const safe: GenerateParams = { ...params };
  delete safe.apiKey;
  delete safe.llm;
  if (safe.connections) {
    safe.connections = {
      jira: safe.connections.jira.map((c) => ({ ...c, apiToken: c.apiToken ? '***redacted***' : '', credential: c.credential ? '***redacted***' : '' })),
      qmetry: safe.connections.qmetry.map((c) => ({ ...c, apiToken: c.apiToken ? '***redacted***' : '', credential: c.credential ? '***redacted***' : '' })),
    };
  }
  return safe;
}

function apiScopeFromParams(params: GenerateParams): ApiFetchScope | undefined {
  const scope: ApiFetchScope = {};
  const project = canonicalProjectOrUndefined(params.project);
  const startDate = validDate(params.startDate);
  const endDate = validDate(params.endDate);
  if (project) scope.project = project;
  if (startDate) scope.startDate = startDate;
  if (endDate) scope.endDate = endDate;
  return scope.project || scope.startDate || scope.endDate ? scope : undefined;
}

export async function runGenerate(params: GenerateParams): Promise<GenerateResult> {
  const root = resolveRoot();
  const inputDir = params.inputDir || path.join(root, 'input');
  const outputDir = params.outputDir || path.join(root, 'output');
  const configDir = params.configDir || path.join(root, 'config');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const dashboardPath = path.join(outputDir, 'dashboard-data.json');
  const reportPath = path.join(outputDir, 'report.md');
  const metaPath = path.join(outputDir, 'report-meta.json');
  const rawPath = path.join(outputDir, 'raw-dataset.json');

  const project = canonicalProjectOrUndefined(params.project);
  const filterParams = { startDate: params.startDate, endDate: params.endDate, search: params.search, result: params.result, project };
  const apiScope = apiScopeFromParams(params);
  const buildOptions = { apiScope, liveSync: true, includeFiles: true };

  const fingerprint = computeFingerprint(inputDir, configDir, params.connections, buildOptions);
  const cachedFingerprint = loadFingerprint(outputDir);

  let dataset;
  try {
    const cached = loadRawDataset(outputDir);
    const forceLiveBuild = hasBrowserConnections(params) || cachedFingerprint !== fingerprint;
    dataset = forceLiveBuild ? await buildDataset(inputDir, configDir, params.connections, buildOptions) : (cached || await buildDataset(inputDir, configDir, params.connections, buildOptions));
  } catch (err) {
    clearStaleReportFiles(reportPath, metaPath);
    return { ok: false, filesParsed: 0, rowCounts: {}, warnings: [], paths: { dashboard: '', report: '', meta: '', raw: '' }, error: (err as Error).message };
  }

  const fileCount = discoverInputFiles(inputDir).length;
  const totalRows = dataset.executions.length + dataset.issues.length + dataset.uat.length;
  if (totalRows === 0) {
    clearStaleReportFiles(reportPath, metaPath);
    return { ok: false, filesParsed: fileCount, rowCounts: {}, warnings: dataset.meta.warnings, paths: { dashboard: '', report: '', meta: '', raw: '' }, error: 'No data from APIs or input files. Configure Settings/API connections or stage Excel files.' };
  }

  saveRawDataset(outputDir, dataset, fingerprint);

  const payload = buildDashboardPayload(dataset, filterParams);
  fs.writeFileSync(dashboardPath, JSON.stringify(payload, null, 2));

  if (!hasDashboardMetrics(payload)) {
    clearStaleReportFiles(reportPath, metaPath);
    const message = noMetricsForScopeMessage({ project, startDate: params.startDate, endDate: params.endDate, dataset });
    return {
      ok: false,
      filesParsed: fileCount,
      rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length },
      warnings: [...dataset.meta.warnings, message],
      paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath },
      payload,
      error: message,
    };
  }

  try {
    const report = await generateReportFromDataset(dataset, { ...params, project }, '', filterParams);
    const reportMeta = { generatedAt: new Date().toISOString(), params: sanitizeParamsForMeta({ ...params, project }), toolCalls: report.toolCalls, writer: 'deterministic-metrics-template' };
    fs.writeFileSync(reportPath, report.markdown);
    fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2));
    return { ok: true, filesParsed: fileCount, rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }, warnings: dataset.meta.warnings, paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath, raw: rawPath }, payload, report: { markdown: report.markdown, meta: reportMeta } };
  } catch (err) {
    clearStaleReportFiles(reportPath, metaPath);
    const msg = (err as Error).message;
    return { ok: true, filesParsed: fileCount, rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }, warnings: [...dataset.meta.warnings, `Narrative generation failed: ${msg}`], paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath }, payload, error: msg };
  }
}

export function refilterDashboard(dataset: import('./types/dataset').Dataset, filterParams: import('./types/dataset').FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filterParams);
}
