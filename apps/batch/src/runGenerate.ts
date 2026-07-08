import fs from 'fs';
import path from 'path';
import type { ApiFetchScope, DashboardPayload, GenerateParams, GenerateResult } from './types/dataset';
import { buildDataset, computeFingerprint, loadRawDataset, saveRawDataset } from './cache/datasetCache';
import { buildDashboardPayload } from './export/buildDashboardPayload';
import { hasDashboardMetrics, noMetricsForScopeMessage } from './export/reportMetrics';
import { generateReportFromDataset, resolveReportLlmConfig } from './ai/reportWriter';
import { LLM_PROVIDER_LABELS, envKeyForProvider } from './ai/llmProviders';
import { discoverInputFiles } from './parse/dispatcher';
import { canonicalProjectOrUndefined } from './projects/projectKey';

function resolveRoot(): string { return path.resolve(__dirname, '../../..'); }

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
  const project = canonicalProjectOrUndefined(params.project);
  return project ? { project } : undefined;
}

export async function runGenerate(params: GenerateParams): Promise<GenerateResult> {
  const root = resolveRoot();
  const inputDir = params.inputDir || path.join(root, 'input');
  const outputDir = params.outputDir || path.join(root, 'output');
  const configDir = params.configDir || path.join(root, 'config');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const project = canonicalProjectOrUndefined(params.project);
  const filterParams = { startDate: params.startDate, endDate: params.endDate, search: params.search, result: params.result, project };
  const apiScope = apiScopeFromParams(params);

  let dataset;
  try {
    dataset = loadRawDataset(outputDir) || await buildDataset(inputDir, configDir, params.connections, { apiScope });
  } catch (err) {
    return { ok: false, filesParsed: 0, rowCounts: {}, warnings: [], paths: { dashboard: '', report: '', meta: '', raw: '' }, error: (err as Error).message };
  }

  const fileCount = discoverInputFiles(inputDir).length;
  const totalRows = dataset.executions.length + dataset.issues.length + dataset.uat.length;
  if (totalRows === 0) {
    return { ok: false, filesParsed: fileCount, rowCounts: {}, warnings: dataset.meta.warnings, paths: { dashboard: '', report: '', meta: '', raw: '' }, error: 'No data from APIs or input files. Configure Settings/API connections or stage Excel files.' };
  }

  const fingerprint = computeFingerprint(inputDir, configDir, params.connections, { apiScope });
  const rawPath = path.join(outputDir, 'raw-dataset.json');
  if (!fs.existsSync(rawPath)) saveRawDataset(outputDir, dataset, fingerprint);

  const dashboardPath = path.join(outputDir, 'dashboard-data.json');
  const reportPath = path.join(outputDir, 'report.md');
  const metaPath = path.join(outputDir, 'report-meta.json');
  const payload = buildDashboardPayload(dataset, filterParams);
  fs.writeFileSync(dashboardPath, JSON.stringify(payload, null, 2));

  if (!hasDashboardMetrics(payload)) {
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

  const llmConfig = resolveReportLlmConfig(params, configDir, params.apiKey);
  if (!llmConfig.apiKey) {
    return { ok: true, filesParsed: fileCount, rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }, warnings: [...dataset.meta.warnings, `${envKeyForProvider(llmConfig.provider)} not set — AI narrative skipped for ${LLM_PROVIDER_LABELS[llmConfig.provider]}`], paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath }, payload };
  }

  try {
    const report = await generateReportFromDataset(dataset, { ...params, project }, llmConfig.apiKey, filterParams);
    const reportMeta = { generatedAt: new Date().toISOString(), params: sanitizeParamsForMeta({ ...params, project }), toolCalls: report.toolCalls, llm: report.llm };
    fs.writeFileSync(reportPath, report.markdown);
    fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2));
    return { ok: true, filesParsed: fileCount, rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }, warnings: dataset.meta.warnings, paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath, raw: rawPath }, payload, report: { markdown: report.markdown, meta: reportMeta } };
  } catch (err) {
    const msg = (err as Error).message;
    const isConn = /connection error|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket/i.test(msg);
    const hint = isConn ? ` — could not reach ${LLM_PROVIDER_LABELS[llmConfig.provider]}; verify network access and ${envKeyForProvider(llmConfig.provider)} in Settings or config/runtime.json.` : '';
    return { ok: true, filesParsed: fileCount, rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }, warnings: [...dataset.meta.warnings, `AI narrative failed: ${msg}${hint}`], paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath }, payload, error: (err as Error).message };
  }
}

export function refilterDashboard(dataset: import('./types/dataset').Dataset, filterParams: import('./types/dataset').FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filterParams);
}
