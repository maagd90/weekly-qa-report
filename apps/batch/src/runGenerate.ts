import fs from 'fs';
import path from 'path';
import type { DashboardPayload, GenerateParams, GenerateResult } from './types/dataset';
import { buildDataset, computeFingerprint, saveRawDataset } from './cache/datasetCache';
import { buildDashboardPayload } from './export/buildDashboardPayload';
import { generateReportFromDataset, resolveReportLlmConfig } from './ai/reportWriter';
import { LLM_PROVIDER_LABELS, envKeyForProvider } from './ai/llmProviders';
import { discoverInputFiles } from './parse/dispatcher';

function resolveRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function sanitizeParamsForMeta(params: GenerateParams): GenerateParams {
  const safe: GenerateParams = { ...params };
  delete safe.apiKey;
  if (safe.llm) {
    safe.llm = { provider: safe.llm.provider, model: safe.llm.model, baseUrl: safe.llm.baseUrl };
  }
  if (safe.connections) {
    safe.connections = {
      jira: safe.connections.jira.map((c) => ({ ...c, credential: c.credential ? '***redacted***' : '' })),
      qmetry: safe.connections.qmetry.map((c) => ({ ...c, credential: c.credential ? '***redacted***' : '' })),
    };
  }
  return safe;
}

export async function runGenerate(params: GenerateParams): Promise<GenerateResult> {
  const root = resolveRoot();
  const inputDir = params.inputDir || path.join(root, 'input');
  const outputDir = params.outputDir || path.join(root, 'output');
  const configDir = params.configDir || path.join(root, 'config');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const filterParams = {
    startDate: params.startDate,
    endDate: params.endDate,
    search: params.search,
    result: params.result,
    project: params.project,
  };

  let dataset;
  try {
    dataset = await buildDataset(inputDir, configDir, params.connections);
  } catch (err) {
    return {
      ok: false,
      filesParsed: 0,
      rowCounts: {},
      warnings: [],
      paths: { dashboard: '', report: '', meta: '', raw: '' },
      error: (err as Error).message,
    };
  }

  const fileCount = discoverInputFiles(inputDir).length;
  const totalRows = dataset.executions.length + dataset.issues.length + dataset.uat.length;

  if (totalRows === 0) {
    return {
      ok: false,
      filesParsed: fileCount,
      rowCounts: {},
      warnings: dataset.meta.warnings,
      paths: { dashboard: '', report: '', meta: '', raw: '' },
      error: 'No data from APIs or input files. Configure integrations.json or stage Excel files.',
    };
  }

  const fingerprint = computeFingerprint(inputDir, configDir, params.connections);
  const rawPath = path.join(outputDir, 'raw-dataset.json');
  saveRawDataset(outputDir, dataset, fingerprint);

  const dashboardPath = path.join(outputDir, 'dashboard-data.json');
  const reportPath = path.join(outputDir, 'report.md');
  const metaPath = path.join(outputDir, 'report-meta.json');

  const payload = buildDashboardPayload(dataset, filterParams);
  fs.writeFileSync(dashboardPath, JSON.stringify(payload, null, 2));

  const llmConfig = resolveReportLlmConfig(params, configDir, params.apiKey);
  if (!llmConfig.apiKey) {
    return {
      ok: true,
      filesParsed: fileCount,
      rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length },
      warnings: [...dataset.meta.warnings, `${envKeyForProvider(llmConfig.provider)} not set — AI narrative skipped for ${LLM_PROVIDER_LABELS[llmConfig.provider]}`],
      paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath },
      payload,
    };
  }

  try {
    const report = await generateReportFromDataset(dataset, params, llmConfig.apiKey, filterParams);
    const reportMeta = {
      generatedAt: new Date().toISOString(),
      params: sanitizeParamsForMeta(params),
      toolCalls: report.toolCalls,
      llm: report.llm,
    };
    fs.writeFileSync(reportPath, report.markdown);
    fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2));

    return {
      ok: true,
      filesParsed: fileCount,
      rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length },
      warnings: dataset.meta.warnings,
      paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath, raw: rawPath },
      payload,
      report: { markdown: report.markdown, meta: reportMeta },
    };
  } catch (err) {
    const msg = (err as Error).message;
    const isConn = /connection error|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket/i.test(msg);
    const hint = isConn ? ` — could not reach ${LLM_PROVIDER_LABELS[llmConfig.provider]}; verify network access and ${envKeyForProvider(llmConfig.provider)} in .env or Settings.` : '';
    return {
      ok: true,
      filesParsed: fileCount,
      rowCounts: { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length },
      warnings: [...dataset.meta.warnings, `AI narrative failed: ${msg}${hint}`],
      paths: { dashboard: dashboardPath, report: '', meta: '', raw: rawPath },
      payload,
      error: (err as Error).message,
    };
  }
}

export function refilterDashboard(dataset: import('./types/dataset').Dataset, filterParams: import('./types/dataset').FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filterParams);
}
