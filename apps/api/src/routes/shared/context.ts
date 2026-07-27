import { Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import {
  runGenerate,
  buildDataset,
  computeFingerprint,
  loadRawDataset,
  loadFingerprint,
  saveRawDataset,
  refilterDashboard,
  mergeDatasets,
  loadIntegrations,
  emptyConnections,
  emptyDataset,
  applyFilters,
  isUsableJiraConnection,
  isUsableQmetryConnection,
  canonicalProjectKey,
  canonicalProjectOrUndefined,
  ensureRuntimeDirectories,
  executionMatchesApiScope,
  issueMatchesApiScope,
  readJsonFile,
  resolveRuntimePaths,
  toErrorMessage,
  validIsoDate,
  writeJsonFile,
} from 'qa-dashboard-batch';
import type {
  ApiFetchScope,
  Dataset,
  UserConnections,
  QmetryConnectionInput,
  FilterParams,
  ReportType,
  StructuredReportNarrative,
} from 'qa-dashboard-batch';
import { ProjectImportStore } from '../../services/projectImports';
import {
  normalizeDatasetProjectOwnership,
  ProjectConnectionValidationError,
  scopeProjectConnections,
  validateProjectConnections,
} from '../../services/projectConnections';

/**
 * Shared infrastructure for all `/api` route modules: runtime paths, the
 * single `ProjectImportStore`, request logging, connection resolution, and
 * dataset build/cache orchestration. Each per-resource router (dashboard,
 * reports, integrations, projects, legacy input) imports only what it needs
 * from here instead of redeclaring it, keeping `batchRoutes.ts` itself a
 * thin composition root.
 */
export const RUNTIME_PATHS = resolveRuntimePaths({ fallbackRoot: path.resolve(__dirname, '../../../../..') });
export const { rootDir: ROOT, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, configDir: CONFIG_DIR } = RUNTIME_PATHS;
ensureRuntimeDirectories(RUNTIME_PATHS);
export const projectImports = new ProjectImportStore(RUNTIME_PATHS);

export const GENERATED_OUTPUT_FILES = ['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json', 'report-dashboard.json', 'report-raw-dataset.json', 'report-dataset-fingerprint.txt', 'report.md', 'report-meta.json'];
export const REPORT_OUTPUT_FILES = ['report-dashboard.json', 'report-raw-dataset.json', 'report-dataset-fingerprint.txt', 'report.md', 'report-meta.json'];
export const IMPORT_CACHE_FILE = 'raw-dataset.imported.json';
export const LIVE_CACHE_FILE = 'raw-dataset.live.json';
export const REPORT_TYPES: ReportType[] = ['full', 'executive', 'testers', 'defects', 'cycles'];
let outputQueue: Promise<void> = Promise.resolve();

export function serializeOutputs<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = outputQueue.then(operation, operation);
  outputQueue = result.then(() => undefined, () => undefined);
  return result;
}

export type BuildMode = 'cached' | 'import-only' | 'live';
export type DashboardPayload = ReturnType<typeof refilterDashboard>;
export type ReportMetaFile = {
  generatedAt?: string;
  params?: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string };
  toolCalls?: unknown[];
  narrative?: StructuredReportNarrative;
  [key: string]: unknown;
};

export function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

export function log(req: Request, message: string, data?: Record<string, unknown>): void {
  console.log(`[api] [${requestId(req)}] ${message}`, data || '');
}

export function logError(req: Request, message: string, err: unknown, data?: Record<string, unknown>): void {
  console.error(`[api] [${requestId(req)}] ${message}`, { ...data, error: toErrorMessage(err) });
}

export function outputPath(fileName: string): string {
  return path.join(OUTPUT_DIR, fileName);
}

/**
 * Loads an optional JSON artifact from the shared output directory.
 *
 * @typeParam T Expected artifact shape.
 * @param fileName Output-directory-relative file name.
 * @returns Parsed artifact, or `null` when it is absent or malformed.
 */
export function loadJsonFile<T>(fileName: string): T | null {
  return readJsonFile<T>(outputPath(fileName));
}

export function reportArtifacts(): { dashboard: DashboardPayload; meta: ReportMetaFile; markdown: string; narrative?: StructuredReportNarrative } | null {
  const dashboard = loadJsonFile<DashboardPayload>('report-dashboard.json');
  if (!dashboard) return null;
  const meta = loadJsonFile<ReportMetaFile>('report-meta.json') || {};
  const markdownPath = outputPath('report.md');
  const markdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, 'utf8') : '';
  return { dashboard, meta, markdown, narrative: meta.narrative };
}

export function reportScopeMatches(
  dashboard: DashboardPayload,
  meta: ReportMetaFile,
  selection: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string },
): boolean {
  const expectedProject = cleanProject(selection.project) || 'all';
  const actualProject = cleanProject(dashboard.scope.project) || 'all';
  const actualType = meta.params?.reportType || 'full';
  return dashboard.scope.startDate === selection.startDate
    && dashboard.scope.endDate === selection.endDate
    && actualProject === expectedProject
    && actualType === selection.reportType;
}

export function removeOutputFile(fileName: string): string | null {
  const filePath = outputPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  fs.unlinkSync(filePath);
  return fileName;
}

export function clearOutputFiles(fileNames: string[] = GENERATED_OUTPUT_FILES): string[] {
  const removed = new Set<string>();
  for (const fileName of fileNames) {
    const deleted = removeOutputFile(fileName);
    if (deleted) removed.add(deleted);
  }
  return [...removed];
}

export function rowCounts(dataset: Dataset): { executions: number; issues: number; uat: number } {
  return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length };
}

export function filteredRowCounts(dataset: Dataset, filter: Partial<FilterParams>): { executions: number; issues: number; uat: number } {
  const filtered = applyFilters(dataset, filterFromBody(filter));
  return { executions: filtered.executions.length, issues: filtered.issues.length, uat: filtered.uat.length };
}

export function totalRows(dataset: Dataset): number {
  const counts = rowCounts(dataset);
  return counts.executions + counts.issues + counts.uat;
}

export function cleanProject(value?: string): string | undefined {
  return canonicalProjectOrUndefined(value);
}

export function cleanApiScope(scope?: ApiFetchScope): ApiFetchScope | undefined {
  if (!scope) return undefined;
  const next: ApiFetchScope = {};
  const startDate = validIsoDate(scope.startDate);
  const endDate = validIsoDate(scope.endDate);
  const project = cleanProject(scope.project);
  if (startDate) next.startDate = startDate;
  if (endDate) next.endDate = endDate;
  if (project) next.project = project;
  return next.startDate || next.endDate || next.project ? next : undefined;
}

export function apiScopeFromFilter(filter: Partial<FilterParams>): ApiFetchScope | undefined {
  return cleanApiScope({ startDate: filter.startDate, endDate: filter.endDate, project: filter.project });
}

export function filterFromBody(body: Partial<FilterParams>): FilterParams {
  return { startDate: body.startDate, endDate: body.endDate, search: body.search, result: body.result || 'all', project: cleanProject(body.project) };
}

export function buildOptions(mode: BuildMode, apiScope?: ApiFetchScope, useConfiguredFallback = true) {
  return { apiScope: mode === 'live' ? cleanApiScope(apiScope) : undefined, liveSync: mode === 'live', includeFiles: mode !== 'live', useConfiguredFallback };
}

export function hasMetrics(payload: DashboardPayload): boolean {
  return Boolean(payload.overview.totalCases || payload.storyBug.story || payload.storyBug.bug || payload.defectBacklog.openTotal || payload.cycles.length || payload.testers.length || payload.uat?.total);
}

export function cacheFileForMode(mode: BuildMode): string | null {
  if (mode === 'import-only') return IMPORT_CACHE_FILE;
  if (mode === 'live') return LIVE_CACHE_FILE;
  return null;
}

export function loadDatasetFile(fileName: string): Dataset | null {
  return readJsonFile<Dataset>(outputPath(fileName));
}

export function saveDatasetFile(fileName: string, dataset: Dataset): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJsonFile(outputPath(fileName), dataset);
}

function liveDatasetSlice(dataset: Dataset, executions: Dataset['executions'], issues: Dataset['issues'], files: Dataset['files']): Dataset {
  return {
    executions,
    issues,
    uat: [],
    projects: [...new Set([...executions.map((e) => canonicalProjectKey(e.project)), ...issues.map((i) => canonicalProjectKey(i.project))].filter(Boolean))].sort(),
    files,
    meta: {
      parsedAt: new Date().toISOString(),
      fetchedAt: dataset.meta.fetchedAt,
      sourceFiles: [],
      warnings: [],
      integrations: { jira: issues.length > 0, qmetry: executions.length > 0 },
      deduped: { executions: 0, issues: 0, uat: 0 },
    },
  };
}

function preserveLiveCache(freshDataset: Dataset, apiScope?: ApiFetchScope): Dataset {
  const previous = loadDatasetFile(LIVE_CACHE_FILE);
  if (!previous) return freshDataset;

  const freshJira = freshDataset.issues.some((row) => row.source === 'jira-api') || freshDataset.files.some((file) => file.source === 'jira-api');
  const freshQmetry = freshDataset.executions.some((row) => row.source === 'qmetry') || freshDataset.files.some((file) => file.source === 'qmetry-api');
  const previousJira = previous.issues.filter((row) => row.source === 'jira-api');
  const previousQmetry = previous.executions.filter((row) => row.source === 'qmetry');
  const warnings = [...freshDataset.meta.warnings];

  const preservedIssues = freshJira ? previousJira.filter((row) => !issueMatchesApiScope(row, apiScope)) : previousJira;
  const preservedExecutions = freshQmetry ? previousQmetry.filter((row) => !executionMatchesApiScope(row, apiScope)) : previousQmetry;
  const preservedFiles = previous.files.filter((file) => {
    if (file.source === 'jira-api') return !freshJira;
    if (file.source === 'qmetry-api') return !freshQmetry;
    return false;
  });

  if (!freshJira && previousJira.length && freshDataset.meta.integrations.jira) warnings.push('JIRA live search returned no fresh issue rows for the selected scope; kept previous cached JIRA rows.');
  if (!freshQmetry && previousQmetry.length && freshDataset.meta.integrations.qmetry) warnings.push('QMetry live search returned no fresh execution rows for the selected scope; kept previous cached QMetry rows.');

  const preserved = liveDatasetSlice(previous, preservedExecutions, preservedIssues, preservedFiles);
  const freshWithWarnings: Dataset = { ...freshDataset, meta: { ...freshDataset.meta, warnings } };
  return mergeDatasets([preserved, freshWithWarnings]);
}

export function hasLiveSources(connections: UserConnections): boolean {
  if (connections.jira.some(isUsableJiraConnection)) return true;
  if (connections.qmetry.some(isUsableQmetryConnection)) return true;
  const config = loadIntegrations(CONFIG_DIR);
  const jiraProfiles = config.jiraProfiles.length ? config.jiraProfiles : [config.jira];
  const hasConfiguredJira = jiraProfiles.some((profile) => profile.enabled
    && Boolean(profile.baseUrl.trim())
    && Boolean(profile.auth.token?.trim() || (profile.auth.tokenEnv && process.env[profile.auth.tokenEnv]?.trim()) || profile.cookie?.trim() || profile.jiraSessionId?.trim() || profile.jiraXsrfToken?.trim()));
  const qmetry = config.qmetry;
  const hasConfiguredQmetry = qmetry.enabled
    && Boolean(qmetry.baseUrl.trim())
    && Boolean(qmetry.auth.token?.trim() || (qmetry.auth.tokenEnv && process.env[qmetry.auth.tokenEnv]?.trim()) || (qmetry.authEncodedEnv && process.env[qmetry.authEncodedEnv]?.trim()));
  return hasConfiguredJira || hasConfiguredQmetry;
}

export function mergedSourceDataset(updatedMode?: BuildMode, updatedDataset?: Dataset): Dataset {
  const parts: Dataset[] = [];
  const importDataset = updatedMode === 'import-only' ? updatedDataset : loadDatasetFile(IMPORT_CACHE_FILE);
  const liveDataset = updatedMode === 'live' ? updatedDataset : loadDatasetFile(LIVE_CACHE_FILE);
  if (importDataset) parts.push(importDataset);
  if (liveDataset) parts.push(liveDataset);
  return mergeDatasets(parts);
}

export function withRegisteredPortfolioProjects(dataset: Dataset, project?: string): Dataset {
  if (cleanProject(project)) return dataset;
  const registeredKeys = projectImports.listProjects().map((record) => record.key);
  if (!registeredKeys.length) return dataset;
  const present = new Set([
    ...dataset.executions.map((row) => row.project),
    ...dataset.issues.map((row) => row.project),
    ...dataset.uat.map((row) => row.project),
    ...dataset.files.filter((file) => file.rows > 0).map((file) => file.project),
  ].map(canonicalProjectKey));
  const missing = registeredKeys.filter((key) => !present.has(canonicalProjectKey(key)));
  return {
    ...dataset,
    projects: [...new Set([...dataset.projects, ...registeredKeys])],
    meta: {
      ...dataset.meta,
      warnings: [
        ...dataset.meta.warnings,
        ...missing.map((key) => `[${key}] No data was available for this project in the selected portfolio source snapshot.`),
      ],
    },
  };
}

export function capabilitiesByProject(): NonNullable<import('qa-dashboard-batch').DashboardPayload['scope']['capabilitiesByProject']> {
  return Object.fromEntries(projectImports.listProjects().flatMap((project) => {
    const capabilities = project.capabilities || { vendorPortal: false, wonderMilesExport: false };
    return [project.key, ...project.sourceKeys].map((key) => [key, capabilities] as const);
  }));
}

export function projectNamesByKey(): NonNullable<import('qa-dashboard-batch').DashboardPayload['scope']['projectNamesByKey']> {
  return Object.fromEntries(projectImports.listProjects().map((project) => [project.key, project.name]));
}

export async function refreshGeneratedOutputs(req: Request, connections: UserConnections, apiScope?: ApiFetchScope, dashboardFilter: Partial<FilterParams> = {}, mode: BuildMode = 'live') {
  return serializeOutputs(async () => {
  const options = buildOptions(mode, apiScope, !req.header('x-user-connections'));
  const sourceConnections = mode === 'live'
    ? scopeProjectConnections(connections, apiScope?.project)
    : emptyConnections();
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR, sourceConnections, options);
  const builtSourceDataset = await buildDataset(INPUT_DIR, CONFIG_DIR, sourceConnections, options);
  const freshSourceDataset = mode === 'live'
    ? normalizeDatasetProjectOwnership(builtSourceDataset, projectImports.listProjects())
    : builtSourceDataset;
  const sourceDataset = mode === 'live' ? preserveLiveCache(freshSourceDataset, options.apiScope) : freshSourceDataset;
  const sourceCacheFile = cacheFileForMode(mode);
  if (sourceCacheFile) saveDatasetFile(sourceCacheFile, sourceDataset);
  const dataset = mergedSourceDataset(mode, sourceDataset);
  const counts = mode === 'live' ? filteredRowCounts(sourceDataset, dashboardFilter) : rowCounts(dataset);
  const removed = clearOutputFiles(REPORT_OUTPUT_FILES);
  if (totalRows(dataset) === 0) {
    removed.push(...clearOutputFiles(['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json']));
    log(req, 'generated outputs cleared; no source data remains', { mode, rowCounts: counts, removed, apiScope: options.apiScope });
    return { rebuilt: false, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects };
  }
  saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
  const portfolioDataset = withRegisteredPortfolioProjects(dataset, dashboardFilter.project);
  const payload = refilterDashboard(portfolioDataset, { ...dashboardFilter, project: cleanProject(dashboardFilter.project) });
  writeJsonFile(outputPath('dashboard-data.json'), refilterDashboard(withRegisteredPortfolioProjects(dataset), {}));
  log(req, 'generated outputs refreshed', { mode, rowCounts: counts, warnings: dataset.meta.warnings, projects: dataset.projects, apiScope: options.apiScope });
  return { rebuilt: true, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects, dashboard: payload };
  });
}

export function publishProjectImportOutputs(req: Request, dashboardFilter: Partial<FilterParams> = {}) {
  return serializeOutputs(() => {
  const imported = loadDatasetFile(IMPORT_CACHE_FILE) || emptyDataset();
  const dataset = mergedSourceDataset('import-only', imported);
  const counts = rowCounts(dataset);
  const removed = clearOutputFiles(REPORT_OUTPUT_FILES);
  if (totalRows(dataset) === 0) {
    removed.push(...clearOutputFiles(['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json']));
    return { rebuilt: false, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects };
  }
  const fingerprint = `project-import:${imported.meta.parsedAt}:${totalRows(imported)}`;
  saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
  const portfolioDataset = withRegisteredPortfolioProjects(dataset, dashboardFilter.project);
  const dashboard = refilterDashboard(portfolioDataset, { ...dashboardFilter, project: cleanProject(dashboardFilter.project) });
  writeJsonFile(outputPath('dashboard-data.json'), refilterDashboard(withRegisteredPortfolioProjects(dataset), {}));
  log(req, 'project-scoped import outputs published', { rowCounts: counts, projects: dataset.projects });
  return { rebuilt: true, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects, dashboard };
  });
}

export function connectionSummary(connections: UserConnections) {
  return {
    jira: connections.jira.map((c) => ({ name: c.name, workspaceProjectId: c.workspaceProjectId || '', baseUrl: c.baseUrl, projectKeys: c.projectKeys?.join(',') || '' })),
    qmetry: connections.qmetry.map((c) => ({ name: c.name, workspaceProjectId: c.workspaceProjectId || '', baseUrl: c.baseUrl, projectKey: c.projectKey, projectId: c.projectId || '', folderId: c.folderId || '' })),
  };
}

type ConnectionRequest = Request & { validatedUserConnections?: UserConnections };

export function resolveConnections(req: Request): UserConnections {
  const connectionRequest = req as ConnectionRequest;
  if (connectionRequest.validatedUserConnections) return connectionRequest.validatedUserConnections;
  const raw = req.header('x-user-connections');
  if (!raw) return emptyConnections();
  try {
    const parsed = JSON.parse(raw) as Partial<UserConnections>;
    const connections = { jira: Array.isArray(parsed.jira) ? parsed.jira : [], qmetry: Array.isArray(parsed.qmetry) ? parsed.qmetry : [] };
    const validated = validateProjectConnections(connections, projectImports.listProjects());
    connectionRequest.validatedUserConnections = validated;
    log(req, 'resolved browser connections', connectionSummary(validated));
    return validated;
  } catch (err) {
    logError(req, 'failed to parse x-user-connections header', err);
    throw err instanceof SyntaxError
      ? new ProjectConnectionValidationError('The saved JIRA/QMetry connection data is invalid JSON.')
      : err;
  }
}

export function resolveAnthropicKey(req: Request): { key: string; source: 'user' | 'server' | 'none' } {
  const headerKey = (req.header('x-anthropic-key') || '').trim();
  if (headerKey) return { key: headerKey, source: 'user' };
  const envKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (envKey) return { key: envKey, source: 'server' };
  return { key: '', source: 'none' };
}

export async function ensureDataset(req: Request, connections: UserConnections, apiScope?: ApiFetchScope, mode: BuildMode = 'import-only'): Promise<{ dataset: Dataset; fingerprint: string } | null> {
  if (mode === 'import-only') {
    const imported = loadDatasetFile(IMPORT_CACHE_FILE);
    if (imported) {
      const merged = mergedSourceDataset('import-only', imported);
      if (totalRows(merged) > 0) return { dataset: merged, fingerprint: `project-import:${imported.meta.parsedAt}:${totalRows(imported)}` };
    }
  }
  const options = buildOptions(mode, apiScope);
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR, connections, options);
  const cached = loadFingerprint(OUTPUT_DIR);
  let dataset = loadRawDataset(OUTPUT_DIR);
  log(req, 'ensureDataset:start', { inputDir: INPUT_DIR, configDir: CONFIG_DIR, outputDir: OUTPUT_DIR, fingerprint, cachedFingerprint: cached, apiScope: options.apiScope, mode });
  if (dataset && (cached === fingerprint || mode === 'cached')) {
    log(req, 'ensureDataset:using cached dataset', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, mode });
    return { dataset, fingerprint: cached || fingerprint };
  }
  if (mode === 'cached') return null;
  try {
    const rawBuiltDataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections, options);
    const builtDataset = mode === 'live'
      ? normalizeDatasetProjectOwnership(rawBuiltDataset, projectImports.listProjects())
      : rawBuiltDataset;
    const sourceDataset = mode === 'live' ? preserveLiveCache(builtDataset, options.apiScope) : builtDataset;
    log(req, 'ensureDataset:built dataset', { executions: sourceDataset.executions.length, issues: sourceDataset.issues.length, uat: sourceDataset.uat.length, warnings: sourceDataset.meta.warnings, mode });
    if (totalRows(sourceDataset) === 0) return null;
    const sourceCacheFile = cacheFileForMode(mode);
    if (sourceCacheFile) saveDatasetFile(sourceCacheFile, sourceDataset);
    const merged = mergedSourceDataset(mode, sourceDataset);
    saveRawDataset(OUTPUT_DIR, merged, fingerprint);
    return { dataset: merged, fingerprint };
  } catch (err) {
    logError(req, 'ensureDataset:build failed', err, { mode });
    return dataset ? { dataset, fingerprint: cached || fingerprint } : null;
  }
}

export function parseFilterParams(req: Request): FilterParams {
  return {
    startDate: queryString(req.query.startDate) || undefined,
    endDate: queryString(req.query.endDate) || undefined,
    search: queryString(req.query.search) || undefined,
    result: (queryString(req.query.result, 'all') as 'all' | 'PASS' | 'FAIL' | 'BLOCKED') || 'all',
    project: cleanProject(queryString(req.query.project)),
  };
}

export function queryString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return fallback;
}

export function selectQmetryConnection(connections: UserConnections, connectionId?: string): QmetryConnectionInput | null {
  if (!connections.qmetry.length) return null;
  if (connectionId) return connections.qmetry.find((c) => c.id === connectionId) || null;
  return connections.qmetry[0];
}

export function uniqueProjectsFromDatasets(datasets: Array<Dataset | null>): string[] {
  return [...new Set(datasets.flatMap((dataset) => dataset?.projects || []).map(canonicalProjectKey).filter((key) => key && key !== 'all'))];
}

export function seedProjectRegistry() {
  const existing = projectImports.listProjects();
  if (existing.length) return existing;
  // One-time migration is limited to imported files. Live credentials and API
  // response data must never create a dashboard project implicitly.
  const keys = uniqueProjectsFromDatasets([loadDatasetFile(IMPORT_CACHE_FILE)]);
  return projectImports.ensureProjectsForKeys(keys);
}

export function projectErrorStatus(err: unknown): number {
  const message = toErrorMessage(err);
  if (/already exists/i.test(message)) return 409;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are allowed'));
  },
});

export function connectionsValidationMiddleware(req: Request, res: Response, next: () => void) {
  if (!req.header('x-user-connections')) return next();
  try {
    resolveConnections(req);
    return next();
  } catch (err) {
    return res.status(400).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
}

export { ProjectConnectionValidationError };
export type { ApiFetchScope, Dataset, FilterParams, ReportType, StructuredReportNarrative, UserConnections };
