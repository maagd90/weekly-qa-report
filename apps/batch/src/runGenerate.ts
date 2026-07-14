import fs from 'fs';
import path from 'path';
import type { ApiFetchScope, DashboardPayload, GenerateParams, GenerateResult } from './types/dataset';
import { buildDataset, computeFingerprint } from './cache/datasetCache';
import { buildDashboardPayload } from './export/buildDashboardPayload';
import { hasDashboardMetrics, noMetricsForScopeMessage } from './export/reportMetrics';
import { generateReportFromDataset, resolveReportLlmConfig } from './ai/reportWriter';
import { LLM_PROVIDER_LABELS, envKeyForProvider } from './ai/llmProviders';
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

function clearStaleReportFiles(...paths: string[]): void {
  paths.forEach(removeIfExists);
}

function loadReportDataset(rawPath: string): import('./types/dataset').Dataset | null {
  if (!fs.existsSync(rawPath)) return null;
  try { return JSON.parse(fs.readFileSync(rawPath, 'utf8')) as import('./types/dataset').Dataset; } catch { return null; }
}

function loadReportFingerprint(fingerprintPath: string): string | null {
  return fs.existsSync(fingerprintPath) ? fs.readFileSync(fingerprintPath, 'utf8').trim() : null;
}

function saveReportDataset(rawPath: string, fingerprintPath: string, dataset: import('./types/dataset').Dataset, fingerprint: string): void {
  fs.writeFileSync(rawPath, JSON.stringify(dataset, null, 2));
  fs.writeFileSync(fingerprintPath, fingerprint);
}

function reportRowCounts(payload: DashboardPayload): { executions: number; issues: number; uat: number } {
  return {
    executions: payload.overview.totalCases,
    issues: payload.storyBug.story + payload.storyBug.bug,
    uat: payload.uat?.total || 0,
  };
}

function sanitizeParamsForMeta(params: GenerateParams): GenerateParams {
  const safe: GenerateParams = { ...params };
  delete safe.apiKey;
  if (safe.llm) safe.llm = { provider: safe.llm.provider, model: safe.llm.model, baseUrl: safe.llm.baseUrl };
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

  const dashboardPath = path.join(outputDir, 'report-dashboard.json');
  const reportPath = path.join(outputDir, 'report.md');
  const metaPath = path.join(outputDir, 'report-meta.json');
  const rawPath = path.join(outputDir, 'report-raw-dataset.json');
  const fingerprintPath = path.join(outputDir, 'report-dataset-fingerprint.txt');

  const project = canonicalProjectOrUndefined(params.project);
  const filterParams = { startDate: params.startDate, endDate: params.endDate, search: params.search, result: params.result, project };
  const apiScope = apiScopeFromParams(params);
  const buildOptions = { apiScope, liveSync: true, includeFiles: true };

  const fingerprint = computeFingerprint(inputDir, configDir, params.connections, buildOptions);
  const cachedFingerprint = loadReportFingerprint(fingerprintPath);

  let dataset;
  try {
    const cached = loadReportDataset(rawPath);
    const forceLiveBuild = hasBrowserConnections(params) || cachedFingerprint !== fingerprint;
    dataset = forceLiveBuild ? await buildDataset(inputDir, configDir, params.connections, buildOptions) : (cached || await buildDataset(inputDir, configDir, params.connections, buildOptions));
  } catch (err) {
    clearStaleReportFiles(dashboardPath, reportPath, metaPath, rawPath, fingerprintPath);
    return { ok: false, filesParsed: 0, rowCounts: {}, warnings: [], paths: { dashboard: '', report: '', meta: '', raw: '' }, error: (err as Error).message };
  }

  const fileCount = discoverInputFiles(inputDir).length;
  const totalRows = dataset.executions.length + dataset.issues.length + dataset.uat.length;
  if (totalRows === 0) {
    clearStaleReportFiles(dashboardPath, reportPath, metaPath, rawPath, fingerprintPath);
    return { ok: false, filesParsed: fileCount, rowCounts: {}, warnings: dataset.meta.warnings, paths: { dashboard: '', report: '', meta: '', raw: '' }, error: 'No data from APIs or input files. Configure Settings/API connections or stage Excel files.' };
  }

  saveReportDataset(rawPath, fingerprintPath, dataset, fingerprint);

  const payload = buildDashboardPayload(dataset, filterParams);
  const counts = reportRowCounts(payload);

  if (!hasDashboardMetrics(payload)) {
    clearStaleReportFiles(dashboardPath, reportPath, metaPath);
    const message = noMetricsForScopeMessage({ project, startDate: params.startDate, endDate: params.endDate, dataset });
    return {
      ok: false,
      filesParsed: fileCount,
      rowCounts: counts,
      warnings: [...dataset.meta.warnings, message],
      paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath },
      payload,
      error: message,
    };
  }

  fs.writeFileSync(dashboardPath, JSON.stringify(payload, null, 2));
  const baseReportMeta = {
    generatedAt: payload.meta.generatedAt,
    params: sanitizeParamsForMeta({ ...params, project }),
    toolCalls: [] as { toolName: string; rowCount: number }[],
  };
  fs.writeFileSync(metaPath, JSON.stringify(baseReportMeta, null, 2));

  const llmConfig = resolveReportLlmConfig(params, configDir, params.apiKey);
  if (!llmConfig.apiKey) {
    removeIfExists(reportPath);
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: [...dataset.meta.warnings, `${envKeyForProvider(llmConfig.provider)} not set — narrative skipped for ${LLM_PROVIDER_LABELS[llmConfig.provider]}`], paths: { dashboard: dashboardPath, report: '', meta: metaPath, raw: rawPath }, payload, report: { markdown: '', meta: baseReportMeta } };
  }

  try {
    const report = await generateReportFromDataset(dataset, { ...params, project }, llmConfig.apiKey, filterParams);
    const reportMeta = { ...baseReportMeta, toolCalls: report.toolCalls, llm: report.llm };
    fs.writeFileSync(reportPath, report.markdown);
    fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2));
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: dataset.meta.warnings, paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath, raw: rawPath }, payload, report: { markdown: report.markdown, meta: reportMeta } };
  } catch (err) {
    removeIfExists(reportPath);
    const msg = (err as Error).message;
    const isConn = /connection error|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket/i.test(msg);
    const hint = isConn ? ` — could not reach ${LLM_PROVIDER_LABELS[llmConfig.provider]}; verify network access and ${envKeyForProvider(llmConfig.provider)} in Settings or config/runtime.json.` : '';
    const reportMeta = { ...baseReportMeta, narrativeError: msg };
    fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2));
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: [...dataset.meta.warnings, `Narrative generation failed: ${msg}${hint}`], paths: { dashboard: dashboardPath, report: '', meta: metaPath, raw: rawPath }, payload, report: { markdown: '', meta: reportMeta }, error: msg };
  }
}

export function refilterDashboard(dataset: import('./types/dataset').Dataset, filterParams: import('./types/dataset').FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filterParams);
}
