import fs from 'fs';
import path from 'path';
import type { ApiFetchScope, DashboardPayload, Dataset, GenerateParams, GenerateResult } from './types/dataset';
import { buildDataset, computeFingerprint } from './cache/datasetCache';
import { buildDashboardPayload } from './export/buildDashboardPayload';
import { hasDashboardMetrics, noMetricsForScopeMessage } from './export/reportMetrics';
import { generateReportFromDataset, resolveReportLlmConfig } from './ai/reportWriter';
import { LLM_PROVIDER_LABELS, envKeyForProvider } from './ai/llmProviders';
import { discoverInputFiles } from './parse/dispatcher';
import { canonicalProjectOrUndefined } from './projects/projectKey';
import { validIsoDate } from './filters/scopeMatching';
import { ensureRuntimeDirectories, resolveRuntimePaths } from './runtime/runtimePaths';
import { readJsonFile, writeJsonFile } from './utils/jsonFile';
import { toErrorMessage } from './utils/errors';

/**
 * Reports whether generation received browser-supplied live integrations.
 *
 * Live credentials are intentionally treated as a cache-bypass signal because
 * the remote source may have changed even when local input fingerprints have not.
 *
 * @param params Report generation request.
 * @returns `true` when at least one JIRA or QMetry connection is present.
 */
function hasBrowserConnections(params: GenerateParams): boolean {
  return Boolean(params.connections?.jira?.length || params.connections?.qmetry?.length);
}

/**
 * Removes an optional generated artifact.
 *
 * @param filePath Path to the artifact.
 */
function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * Removes report artifacts that would otherwise expose an obsolete snapshot.
 *
 * @param paths Artifact paths to remove when present.
 */
function clearStaleReportFiles(...paths: string[]): void {
  paths.forEach(removeIfExists);
}

/**
 * Loads the optional report-scoped raw dataset cache.
 *
 * Missing or malformed cache files are recoverable and trigger a rebuild.
 *
 * @param rawPath Path to the report dataset JSON.
 * @returns Parsed dataset, or `null` when no usable cache exists.
 */
function loadReportDataset(rawPath: string): Dataset | null {
  return readJsonFile<Dataset>(rawPath);
}

/**
 * Loads and trims the optional report dataset fingerprint.
 *
 * @param fingerprintPath Path to the fingerprint text file.
 * @returns Stored fingerprint, or `null` when the file is absent.
 */
function loadReportFingerprint(fingerprintPath: string): string | null {
  return fs.existsSync(fingerprintPath) ? fs.readFileSync(fingerprintPath, 'utf8').trim() : null;
}

/**
 * Persists the report-scoped dataset and the fingerprint that produced it.
 *
 * @param rawPath Destination for the normalized dataset JSON.
 * @param fingerprintPath Destination for the fingerprint text.
 * @param dataset Dataset used to render the report.
 * @param fingerprint Fingerprint for source files, configuration, and scope.
 */
function saveReportDataset(rawPath: string, fingerprintPath: string, dataset: Dataset, fingerprint: string): void {
  writeJsonFile(rawPath, dataset);
  fs.writeFileSync(fingerprintPath, fingerprint);
}

/**
 * Converts dashboard metrics into the compact row-count response contract.
 *
 * @param payload Filtered dashboard payload.
 * @returns Counts surfaced by the generation endpoint.
 */
function reportRowCounts(payload: DashboardPayload): { executions: number; issues: number; uat: number } {
  return {
    executions: payload.overview.totalCases,
    issues: payload.storyBug.story + payload.storyBug.bug,
    uat: payload.uat?.total || 0,
  };
}

/**
 * Removes credentials before request parameters are stored in report metadata.
 *
 * @param params Original generation request.
 * @returns A copy safe to persist alongside generated artifacts.
 */
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

/**
 * Builds the normalized live API scope implied by report parameters.
 *
 * Unsupported date representations are omitted instead of being sent to remote
 * APIs. An empty selection returns `undefined`, which means no API restriction.
 *
 * @param params Report generation request.
 * @returns Canonical project/date scope, or `undefined` when unrestricted.
 */
function apiScopeFromParams(params: GenerateParams): ApiFetchScope | undefined {
  const scope: ApiFetchScope = {};
  const project = canonicalProjectOrUndefined(params.project);
  const startDate = validIsoDate(params.startDate);
  const endDate = validIsoDate(params.endDate);
  if (project) scope.project = project;
  if (startDate) scope.startDate = startDate;
  if (endDate) scope.endDate = endDate;
  return scope.project || scope.startDate || scope.endDate ? scope : undefined;
}

/**
 * Builds a report snapshot from live integrations and/or staged input files.
 *
 * The operation owns report-scoped cache validation, dataset construction,
 * filtered dashboard generation, optional LLM narrative generation, and stale
 * artifact cleanup. Failures before a valid dashboard exists return `ok: false`;
 * narrative-only failures keep the metric report usable and return a warning.
 *
 * @param params Filters, report type, runtime directories, integrations, and LLM selection.
 * @returns Generation result containing artifact paths and optional dashboard/report data.
 */
export async function runGenerate(params: GenerateParams): Promise<GenerateResult> {
  const runtimePaths = resolveRuntimePaths({
    inputDir: params.inputDir,
    outputDir: params.outputDir,
    configDir: params.configDir,
    fallbackRoot: path.resolve(__dirname, '../../..'),
  });
  ensureRuntimeDirectories(runtimePaths);
  const { inputDir, outputDir, configDir } = runtimePaths;

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
    return { ok: false, filesParsed: 0, rowCounts: {}, warnings: [], paths: { dashboard: '', report: '', meta: '', raw: '' }, error: toErrorMessage(err) };
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

  writeJsonFile(dashboardPath, payload);
  const baseReportMeta = {
    generatedAt: payload.meta.generatedAt,
    params: sanitizeParamsForMeta({ ...params, project }),
    toolCalls: [] as { toolName: string; rowCount: number }[],
  };
  writeJsonFile(metaPath, baseReportMeta);

  const llmConfig = resolveReportLlmConfig(params, configDir, params.apiKey);
  if (!llmConfig.apiKey) {
    removeIfExists(reportPath);
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: [...dataset.meta.warnings, `${envKeyForProvider(llmConfig.provider)} not set — narrative skipped for ${LLM_PROVIDER_LABELS[llmConfig.provider]}`], paths: { dashboard: dashboardPath, report: '', meta: metaPath, raw: rawPath }, payload, report: { markdown: '', meta: baseReportMeta } };
  }

  try {
    const report = await generateReportFromDataset(dataset, { ...params, project }, llmConfig.apiKey, filterParams);
    const reportMeta = { ...baseReportMeta, toolCalls: report.toolCalls, llm: report.llm };
    fs.writeFileSync(reportPath, report.markdown);
    writeJsonFile(metaPath, reportMeta);
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: dataset.meta.warnings, paths: { dashboard: dashboardPath, report: reportPath, meta: metaPath, raw: rawPath }, payload, report: { markdown: report.markdown, meta: reportMeta } };
  } catch (err) {
    removeIfExists(reportPath);
    const msg = toErrorMessage(err);
    const isConn = /connection error|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket/i.test(msg);
    const hint = isConn ? ` — could not reach ${LLM_PROVIDER_LABELS[llmConfig.provider]}; verify network access and ${envKeyForProvider(llmConfig.provider)} in Settings or config/runtime.json.` : '';
    const reportMeta = { ...baseReportMeta, narrativeError: msg };
    writeJsonFile(metaPath, reportMeta);
    return { ok: true, filesParsed: fileCount, rowCounts: counts, warnings: [...dataset.meta.warnings, `Narrative generation failed: ${msg}${hint}`], paths: { dashboard: dashboardPath, report: '', meta: metaPath, raw: rawPath }, payload, report: { markdown: '', meta: reportMeta }, error: msg };
  }
}

/**
 * Rebuilds dashboard metrics from an already-normalized dataset and new filters.
 *
 * @param dataset Cached or freshly built source dataset.
 * @param filterParams Project, date, result, and search filters.
 * @returns A new dashboard payload without refetching external data.
 */
export function refilterDashboard(dataset: Dataset, filterParams: import('./types/dataset').FilterParams): DashboardPayload {
  return buildDashboardPayload(dataset, filterParams);
}
