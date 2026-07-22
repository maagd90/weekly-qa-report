import { Router, Request, Response } from 'express';
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
  integrationsSummary,
  loadIntegrations,
  testAnthropicConnection,
  testLlmConnection,
  jiraConfigFromConnection,
  qmetryConfigFromConnection,
  fetchJiraIssues,
  fetchProjectCycles,
  fetchProjectFolders,
  fetchFolderCycleHealth,
  searchQmetryTestCycles,
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
  LlmSelectionInput,
  UserConnections,
  JiraConnectionInput,
  QmetryConnectionInput,
  FilterParams,
  ReportType,
} from 'qa-dashboard-batch';
import { getEnvStatus } from '../loadRepoEnv';
import { generateReportPdf, type ReportBrandingPayload } from '../services/reportPdf';
import { ProjectImportStore } from '../services/projectImports';
import { canUseDashboardPayloadFallback } from '../services/dashboardFallback';
import {
  normalizeDatasetProjectOwnership,
  planConnectionProjectMigration,
  ProjectConnectionValidationError,
  scopeProjectConnections,
  validateProjectConnections,
} from '../services/projectConnections';

const router = Router();
const RUNTIME_PATHS = resolveRuntimePaths({ fallbackRoot: path.resolve(__dirname, '../../../..') });
const { rootDir: ROOT, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, configDir: CONFIG_DIR } = RUNTIME_PATHS;
ensureRuntimeDirectories(RUNTIME_PATHS);
const projectImports = new ProjectImportStore(RUNTIME_PATHS);

const GENERATED_OUTPUT_FILES = ['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json', 'report-dashboard.json', 'report-raw-dataset.json', 'report-dataset-fingerprint.txt', 'report.md', 'report-meta.json'];
const REPORT_OUTPUT_FILES = ['report-dashboard.json', 'report-raw-dataset.json', 'report-dataset-fingerprint.txt', 'report.md', 'report-meta.json'];
const IMPORT_CACHE_FILE = 'raw-dataset.imported.json';
const LIVE_CACHE_FILE = 'raw-dataset.live.json';
const REPORT_TYPES: ReportType[] = ['full', 'executive', 'testers', 'defects', 'cycles'];
let outputQueue: Promise<void> = Promise.resolve();

function serializeOutputs<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = outputQueue.then(operation, operation);
  outputQueue = result.then(() => undefined, () => undefined);
  return result;
}

type BuildMode = 'cached' | 'import-only' | 'live';
type DashboardPayload = ReturnType<typeof refilterDashboard>;
type ReportMetaFile = {
  generatedAt?: string;
  params?: { startDate?: string; endDate?: string; reportType?: ReportType; project?: string };
  toolCalls?: unknown[];
  [key: string]: unknown;
};

function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

function log(req: Request, message: string, data?: Record<string, unknown>): void {
  console.log(`[api] [${requestId(req)}] ${message}`, data || '');
}

function logError(req: Request, message: string, err: unknown, data?: Record<string, unknown>): void {
  console.error(`[api] [${requestId(req)}] ${message}`, { ...data, error: toErrorMessage(err) });
}

function outputPath(fileName: string): string {
  return path.join(OUTPUT_DIR, fileName);
}

/**
 * Loads an optional JSON artifact from the shared output directory.
 *
 * @typeParam T Expected artifact shape.
 * @param fileName Output-directory-relative file name.
 * @returns Parsed artifact, or `null` when it is absent or malformed.
 */
function loadJsonFile<T>(fileName: string): T | null {
  return readJsonFile<T>(outputPath(fileName));
}

function reportArtifacts(): { dashboard: DashboardPayload; meta: ReportMetaFile; markdown: string } | null {
  const dashboard = loadJsonFile<DashboardPayload>('report-dashboard.json');
  if (!dashboard) return null;
  const meta = loadJsonFile<ReportMetaFile>('report-meta.json') || {};
  const markdownPath = outputPath('report.md');
  const markdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, 'utf8') : '';
  return { dashboard, meta, markdown };
}

function reportScopeMatches(
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

function removeOutputFile(fileName: string): string | null {
  const filePath = outputPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  fs.unlinkSync(filePath);
  return fileName;
}

function clearOutputFiles(fileNames: string[] = GENERATED_OUTPUT_FILES): string[] {
  const removed = new Set<string>();
  for (const fileName of fileNames) {
    const deleted = removeOutputFile(fileName);
    if (deleted) removed.add(deleted);
  }
  return [...removed];
}

function rowCounts(dataset: Dataset): { executions: number; issues: number; uat: number } {
  return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length };
}

function filteredRowCounts(dataset: Dataset, filter: Partial<FilterParams>): { executions: number; issues: number; uat: number } {
  const filtered = applyFilters(dataset, filterFromBody(filter));
  return { executions: filtered.executions.length, issues: filtered.issues.length, uat: filtered.uat.length };
}

function totalRows(dataset: Dataset): number {
  const counts = rowCounts(dataset);
  return counts.executions + counts.issues + counts.uat;
}

function cleanProject(value?: string): string | undefined {
  return canonicalProjectOrUndefined(value);
}

function cleanApiScope(scope?: ApiFetchScope): ApiFetchScope | undefined {
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

function apiScopeFromFilter(filter: Partial<FilterParams>): ApiFetchScope | undefined {
  return cleanApiScope({ startDate: filter.startDate, endDate: filter.endDate, project: filter.project });
}

function filterFromBody(body: Partial<FilterParams>): FilterParams {
  return { startDate: body.startDate, endDate: body.endDate, search: body.search, result: body.result || 'all', project: cleanProject(body.project) };
}

function buildOptions(mode: BuildMode, apiScope?: ApiFetchScope, useConfiguredFallback = true) {
  return { apiScope: mode === 'live' ? cleanApiScope(apiScope) : undefined, liveSync: mode === 'live', includeFiles: mode !== 'live', useConfiguredFallback };
}

function hasMetrics(payload: DashboardPayload): boolean {
  return Boolean(payload.overview.totalCases || payload.storyBug.story || payload.storyBug.bug || payload.defectBacklog.openTotal || payload.cycles.length || payload.testers.length || payload.uat?.total);
}

function cacheFileForMode(mode: BuildMode): string | null {
  if (mode === 'import-only') return IMPORT_CACHE_FILE;
  if (mode === 'live') return LIVE_CACHE_FILE;
  return null;
}

function loadDatasetFile(fileName: string): Dataset | null {
  return readJsonFile<Dataset>(outputPath(fileName));
}

function saveDatasetFile(fileName: string, dataset: Dataset): void {
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

function hasLiveSources(connections: UserConnections): boolean {
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

function mergedSourceDataset(updatedMode?: BuildMode, updatedDataset?: Dataset): Dataset {
  const parts: Dataset[] = [];
  const importDataset = updatedMode === 'import-only' ? updatedDataset : loadDatasetFile(IMPORT_CACHE_FILE);
  const liveDataset = updatedMode === 'live' ? updatedDataset : loadDatasetFile(LIVE_CACHE_FILE);
  if (importDataset) parts.push(importDataset);
  if (liveDataset) parts.push(liveDataset);
  return mergeDatasets(parts);
}

function withRegisteredPortfolioProjects(dataset: Dataset, project?: string): Dataset {
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

async function refreshGeneratedOutputs(req: Request, connections: UserConnections, apiScope?: ApiFetchScope, dashboardFilter: Partial<FilterParams> = {}, mode: BuildMode = 'live') {
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

function publishProjectImportOutputs(req: Request, dashboardFilter: Partial<FilterParams> = {}) {
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

function connectionSummary(connections: UserConnections) {
  return {
    jira: connections.jira.map((c) => ({ name: c.name, workspaceProjectId: c.workspaceProjectId || '', baseUrl: c.baseUrl, projectKeys: c.projectKeys?.join(',') || '' })),
    qmetry: connections.qmetry.map((c) => ({ name: c.name, workspaceProjectId: c.workspaceProjectId || '', baseUrl: c.baseUrl, projectKey: c.projectKey, projectId: c.projectId || '', folderId: c.folderId || '' })),
  };
}

type ConnectionRequest = Request & { validatedUserConnections?: UserConnections };

function resolveConnections(req: Request): UserConnections {
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

function resolveAnthropicKey(req: Request): { key: string; source: 'user' | 'server' | 'none' } {
  const headerKey = (req.header('x-anthropic-key') || '').trim();
  if (headerKey) return { key: headerKey, source: 'user' };
  const envKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (envKey) return { key: envKey, source: 'server' };
  return { key: '', source: 'none' };
}

async function ensureDataset(req: Request, connections: UserConnections, apiScope?: ApiFetchScope, mode: BuildMode = 'import-only'): Promise<{ dataset: Dataset; fingerprint: string } | null> {
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

function parseFilterParams(req: Request): FilterParams {
  return {
    startDate: queryString(req.query.startDate) || undefined,
    endDate: queryString(req.query.endDate) || undefined,
    search: queryString(req.query.search) || undefined,
    result: (queryString(req.query.result, 'all') as 'all' | 'PASS' | 'FAIL' | 'BLOCKED') || 'all',
    project: cleanProject(queryString(req.query.project)),
  };
}

function queryString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return fallback;
}

function selectQmetryConnection(connections: UserConnections, connectionId?: string): QmetryConnectionInput | null {
  if (!connections.qmetry.length) return null;
  if (connectionId) return connections.qmetry.find((c) => c.id === connectionId) || null;
  return connections.qmetry[0];
}

router.use((req: Request, res: Response, next) => {
  if (!req.header('x-user-connections')) return next();
  try {
    resolveConnections(req);
    return next();
  } catch (err) {
    return res.status(400).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/status', (_req: Request, res: Response) => res.json({
  apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.CUSTOM_LLM_API_KEY),
  llmProvidersConfigured: {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    custom: Boolean(process.env.CUSTOM_LLM_API_KEY),
    template: true,
  },
  jiraConfigured: Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
  projectRoot: process.env.PROJECT_ROOT || ROOT,
}));

router.get('/env', (_req: Request, res: Response) => res.json(getEnvStatus()));

router.post('/llm/test', async (req: Request, res: Response) => {
  log(req, 'POST /llm/test:start', { provider: (req.body as LlmSelectionInput | undefined)?.provider, model: (req.body as LlmSelectionInput | undefined)?.model });
  try {
    const result = await testLlmConnection((req.body || {}) as LlmSelectionInput, CONFIG_DIR);
    log(req, 'POST /llm/test:done', { ok: result.ok, provider: result.provider, model: result.model, error: result.error });
    res.json(result);
  } catch (err) {
    logError(req, 'POST /llm/test:failed', err);
    res.status(500).json({ ok: false, route: 'direct', error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/anthropic/test', async (req: Request, res: Response) => {
  const key = resolveAnthropicKey(req);
  log(req, 'GET /anthropic/test:start', { keySource: key.source, configDir: CONFIG_DIR });
  try {
    const result = await testAnthropicConnection(key.key, CONFIG_DIR);
    log(req, 'GET /anthropic/test:done', { ok: result.ok, route: result.route, elapsedMs: result.elapsedMs, error: result.error });
    res.json(result);
  } catch (err) {
    logError(req, 'GET /anthropic/test:failed', err);
    res.status(500).json({ ok: false, route: 'direct', error: toErrorMessage(err), requestId: requestId(req) });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Only .xlsx and .xls files are allowed'));
  },
});

router.post('/generate', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, search, result, project, llm } = req.body as { startDate?: string; endDate?: string; reportType?: string; search?: string; result?: string; project?: string; llm?: LlmSelectionInput };
  const clean = cleanProject(project);
  const connections = resolveConnections(req);
  const key = resolveAnthropicKey(req);
  log(req, 'POST /generate:start', { startDate, endDate, reportType, search, result, project: clean, keySource: key.source, connections: connectionSummary(connections) });
  const type = REPORT_TYPES.includes(reportType as ReportType) ? (reportType as ReportType) : 'full';
  try {
    const filter = filterFromBody({ startDate, endDate, search, result: (result as FilterParams['result']) || 'all', project: clean });
    if (hasLiveSources(connections)) await refreshGeneratedOutputs(req, connections, apiScopeFromFilter(filter), filter, 'live');
    const sourceDataset = withRegisteredPortfolioProjects(mergedSourceDataset(), clean);
    const resultPayload = await runGenerate({ startDate, endDate, reportType: type, search, result: (result as 'all') || 'all', project: clean, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, configDir: CONFIG_DIR, apiKey: key.key || undefined, llm, connections, sourceDataset });
    log(req, 'POST /generate:done', { ok: resultPayload.ok, rowCounts: resultPayload.rowCounts, warnings: resultPayload.warnings, error: resultPayload.error, paths: resultPayload.paths });
    return res.status(200).json({ ...resultPayload, requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /generate:failed', err);
    return res.status(500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/dashboard', async (req: Request, res: Response) => {
  const filter = parseFilterParams(req);
  const connections = resolveConnections(req);
  log(req, 'GET /dashboard:start', { filter, mode: 'cached-refilter', connections: connectionSummary(connections) });
  const cached = await ensureDataset(req, connections, undefined, 'cached');
  if (cached) return res.json(refilterDashboard(withRegisteredPortfolioProjects(cached.dataset, filter.project), filter));
  const imported = await ensureDataset(req, emptyConnections(), undefined, 'import-only');
  if (imported) return res.json(refilterDashboard(withRegisteredPortfolioProjects(imported.dataset, filter.project), filter));
  const file = path.join(OUTPUT_DIR, 'dashboard-data.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No dashboard generated yet. Import files, then Sync imported data, or use Settings → Sync JIRA/QMetry. Dataset contains: no projects / 0 rows.', requestId: requestId(req) });
  if (!canUseDashboardPayloadFallback(filter)) {
    return res.status(409).json({
      error: 'Only an aggregate dashboard snapshot is available, so the requested project/date/search filters cannot be applied safely. Sync imported or live data to rebuild the raw dataset, then retry.',
      requestId: requestId(req),
    });
  }
  const dashboard = readJsonFile<DashboardPayload>(file);
  if (!dashboard) return res.status(500).json({ error: 'The cached dashboard is not valid JSON. Sync data to rebuild it.', requestId: requestId(req) });
  res.json(dashboard);
});

router.post('/dashboard/search', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  const apiScope = apiScopeFromFilter(filter);
  log(req, 'POST /dashboard/search:start', { filter, apiScope, mode: hasLiveSources(connections) ? 'live-search' : 'cached-refilter', connections: connectionSummary(connections) });
  try {
    if (hasLiveSources(connections)) {
      try {
        const sync = await refreshGeneratedOutputs(req, connections, apiScope, filter, 'live');
        if (sync.dashboard) return res.json({ ok: true, dashboard: sync.dashboard, rowCounts: sync.rowCounts, warnings: sync.warnings, projects: sync.projects, source: 'live-search', requestId: requestId(req) });
      } catch (liveErr) {
        logError(req, 'POST /dashboard/search:live refresh failed; falling back to cache', liveErr, { filter });
        const cached = await ensureDataset(req, connections, undefined, 'cached');
        if (cached) {
          const dashboard = refilterDashboard(cached.dataset, filter);
          return res.json({ ok: true, dashboard, rowCounts: rowCounts(cached.dataset), warnings: [`Live search failed: ${toErrorMessage(liveErr)}`, ...cached.dataset.meta.warnings], projects: cached.dataset.projects, source: 'cached-fallback', requestId: requestId(req) });
        }
        throw liveErr;
      }
    }
    const cached = await ensureDataset(req, connections, undefined, 'cached');
    if (cached) {
      const dashboard = refilterDashboard(cached.dataset, filter);
      return res.json({ ok: true, dashboard, rowCounts: rowCounts(cached.dataset), warnings: cached.dataset.meta.warnings, projects: cached.dataset.projects, source: 'cached', requestId: requestId(req) });
    }
    const imported = await ensureDataset(req, emptyConnections(), undefined, 'import-only');
    if (imported) {
      const dashboard = refilterDashboard(imported.dataset, filter);
      return res.json({ ok: true, dashboard, rowCounts: rowCounts(imported.dataset), warnings: imported.dataset.meta.warnings, projects: imported.dataset.projects, source: 'imported', requestId: requestId(req) });
    }
    return res.status(404).json({ ok: false, error: 'No cached dashboard data. Sync imported files or JIRA/QMetry first.', requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /dashboard/search:failed', err);
    return res.status(500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/cycles/folders', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  log(req, 'GET /cycles/folders:start', { connections: connectionSummary(connections) });
  const conn = selectQmetryConnection(connections, queryString(req.query.connectionId));
  if (conn) {
    try {
      const cfg = qmetryConfigFromConnection(conn);
      const folders = await fetchProjectFolders(cfg);
      const cycles = await fetchProjectCycles(cfg);
      log(req, 'GET /cycles/folders:qmetry result', { connection: conn.name, folders: folders.length, cycles: cycles.length });
      return res.json({ source: 'qmetry-live', connection: conn.name, connectionId: conn.id, folders, cycles });
    } catch (err) {
      logError(req, `GET /cycles/folders:qmetry failed for ${conn.name}`, err);
    }
  }
  const cached = await ensureDataset(req, connections, undefined, 'cached');
  if (!cached) return res.json({ source: 'imported', folders: [{ id: 'all', name: 'All imported cycles' }], cycles: [] });
  const seen = new Map<string, string>();
  for (const e of cached.dataset.executions) if (e.cycleKey && !seen.has(e.cycleKey)) seen.set(e.cycleKey, e.cycleName || e.cycleKey);
  res.json({ source: 'imported', folders: [{ id: 'all', name: 'All imported cycles' }], cycles: [...seen.entries()].map(([id, name]) => ({ id, name })) });
});

router.get('/cycles/by-folder', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  const folderId = queryString(req.query.folderId, 'all') || 'all';
  const conn = selectQmetryConnection(connections, queryString(req.query.connectionId));
  const filter = parseFilterParams(req);
  const scope = apiScopeFromFilter(filter);
  log(req, 'GET /cycles/by-folder:start', { folderId, connection: conn?.name || 'none', startDate: filter.startDate, endDate: filter.endDate, project: filter.project });
  if (conn) {
    try {
      const result = await fetchFolderCycleHealth(qmetryConfigFromConnection(conn), folderId === 'all' ? undefined : folderId, scope);
      log(req, 'GET /cycles/by-folder:qmetry result', { connection: conn.name, folderId, cycles: result.cycles.length, error: result.error });
      return res.json({ source: 'qmetry-live', connection: conn.name, connectionId: conn.id, folderId, cycles: result.cycles, warnings: result.error ? [result.error] : [] });
    } catch (err) {
      logError(req, `GET /cycles/by-folder:qmetry failed for ${conn.name}`, err);
    }
  }
  const cached = await ensureDataset(req, connections, undefined, 'cached');
  if (!cached) return res.json({ source: 'imported', folderId, cycles: [] });
  const payload = refilterDashboard(cached.dataset, filter);
  res.json({ source: 'imported', folderId, cycles: payload.cycles });
});

router.get('/report', (_req: Request, res: Response) => {
  const artifacts = reportArtifacts();
  if (!artifacts) return res.status(404).json({ error: 'No report generated yet.' });
  res.json(artifacts);
});

router.post('/report/pdf', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, kpiStyle, project, branding } = req.body as { startDate?: string; endDate?: string; reportType?: string; kpiStyle?: string; project?: string; branding?: ReportBrandingPayload };
  const clean = cleanProject(project);
  const connections = resolveConnections(req);
  log(req, 'POST /report/pdf:start', { startDate, endDate, reportType, kpiStyle, project: clean, hasLogo: Boolean(branding?.logoUrl), connections: connectionSummary(connections) });
  const type = REPORT_TYPES.includes(reportType as ReportType) ? (reportType as ReportType) : 'executive';
  const kpi = ['editorial', 'framed', 'minimal'].includes(kpiStyle || '') ? kpiStyle! : 'editorial';
  const artifacts = reportArtifacts();
  if (!artifacts) return res.status(404).json({ error: 'No report snapshot is available. Generate the selected report before downloading its PDF.', requestId: requestId(req) });
  const effectiveStartDate = startDate || artifacts.dashboard.scope.startDate || '';
  const effectiveEndDate = endDate || artifacts.dashboard.scope.endDate || '';
  if (!reportScopeMatches(artifacts.dashboard, artifacts.meta, { startDate: effectiveStartDate, endDate: effectiveEndDate, reportType: type, project: clean })) {
    return res.status(409).json({ error: 'The saved report snapshot does not match the selected project, dates, or report type. Generate the report again before downloading the PDF.', requestId: requestId(req) });
  }
  if (!hasMetrics(artifacts.dashboard)) return res.status(404).json({ error: 'The saved report snapshot contains no metrics.', requestId: requestId(req) });
  try {
    const reportId = artifacts.meta.generatedAt || artifacts.dashboard.meta.generatedAt;
    const pdfBuffer = await generateReportPdf(effectiveStartDate, effectiveEndDate, type, kpi, clean, branding, reportId);
    const suffix = clean ? `-${clean}` : '';
    const filename = `qa-report${suffix}-${effectiveStartDate}-to-${effectiveEndDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    logError(req, 'POST /report/pdf:failed', err, { project: clean });
    res.status(500).json({ error: `PDF generation failed: ${toErrorMessage(err)}`, requestId: requestId(req) });
  }
});

router.get('/integrations', (req: Request, res: Response) => {
  const summary = integrationsSummary(CONFIG_DIR);
  const cfg = loadIntegrations(CONFIG_DIR);
  const userConnections = resolveConnections(req);
  res.json({
    ...summary,
    config: {
      jira: { enabled: cfg.jira.enabled, projectKeys: cfg.jira.projectKeys, jql: cfg.jira.jql },
      qmetry: { enabled: cfg.qmetry.enabled, projectKey: cfg.qmetry.projectKey, projectId: cfg.qmetry.projectId },
    },
    userConnections: {
      jira: userConnections.jira.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl })),
      qmetry: userConnections.qmetry.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl })),
    },
  });
});

router.post('/integrations/test', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  const apiScope = apiScopeFromFilter(filter);
  const scopedConnections = scopeProjectConnections(connections, apiScope?.project);
  log(req, 'POST /integrations/test:start', { filter, apiScope, connections: connectionSummary(scopedConnections) });
  try {
    const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, scopedConnections, {
      liveSync: true,
      apiScope,
      includeFiles: false,
      useConfiguredFallback: !req.header('x-user-connections'),
    });
    log(req, 'POST /integrations/test:done', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings });
    res.json({ ok: true, executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings });
  } catch (err) {
    logError(req, 'POST /integrations/test:failed', err);
    res.status(500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/integrations/sync', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  const apiScope = apiScopeFromFilter(filter);
  log(req, 'POST /integrations/sync:start', { filter, apiScope, connections: connectionSummary(connections) });
  try {
    const sync = await refreshGeneratedOutputs(req, connections, apiScope, filter, 'live');
    return res.json({ ok: true, ...sync, requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /integrations/sync:failed', err);
    return res.status(500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/integrations/test-connection', async (req: Request, res: Response) => {
  const { type, connection } = req.body as { type?: 'jira' | 'qmetry'; connection?: JiraConnectionInput | QmetryConnectionInput };
  if (!type || !connection) return res.status(400).json({ ok: false, error: 'type and connection are required', requestId: requestId(req) });
  try {
    if (type === 'jira') {
      const validated = validateProjectConnections({ jira: [connection as JiraConnectionInput], qmetry: [] }, projectImports.listProjects());
      const { issues, error } = await fetchJiraIssues({ ...jiraConfigFromConnection(validated.jira[0]), pageSize: 5 });
      if (error) return res.json({ ok: false, error });
      return res.json({ ok: true, count: issues.length });
    }
    const validated = validateProjectConnections({ jira: [], qmetry: [connection as QmetryConnectionInput] }, projectImports.listProjects());
    const qmetryCfg = qmetryConfigFromConnection(validated.qmetry[0]);
    const cycles = await searchQmetryTestCycles(qmetryCfg, { startAt: 0, maxResults: 5 });
    if (cycles.error) return res.json({ ok: false, error: cycles.error });
    return res.json({ ok: true, count: cycles.total, sampleCycles: cycles.cycles });
  } catch (err) {
    const status = err instanceof ProjectConnectionValidationError ? 400 : 500;
    return res.status(status).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

function seedProjectRegistry() {
  const existing = projectImports.listProjects();
  if (existing.length) return existing;
  // One-time migration is limited to imported files. Live credentials and API
  // response data must never create a dashboard project implicitly.
  const keys = uniqueProjectsFromDatasets([loadDatasetFile(IMPORT_CACHE_FILE)]);
  return projectImports.ensureProjectsForKeys(keys);
}

function uniqueProjectsFromDatasets(datasets: Array<Dataset | null>): string[] {
  return [...new Set(datasets.flatMap((dataset) => dataset?.projects || []).map(canonicalProjectKey).filter((key) => key && key !== 'all'))];
}

function projectErrorStatus(err: unknown): number {
  const message = toErrorMessage(err);
  if (/already exists/i.test(message)) return 409;
  if (/not found/i.test(message)) return 404;
  return 400;
}

router.get('/projects', (_req: Request, res: Response) => {
  const projects = seedProjectRegistry().map((project) => ({
    ...project,
    fileCount: projectImports.listFiles(project.id).length,
  }));
  res.json(projects);
});

router.post('/projects', (req: Request, res: Response) => {
  try {
    const project = projectImports.createProject(req.body as { key?: string; sourceKeys?: string[]; name?: string; capabilities?: { vendorPortal?: boolean; wonderMilesExport?: boolean } });
    return res.status(201).json({ ok: true, project, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/migrate-connections', (req: Request, res: Response) => {
  try {
    if (projectImports.listProjects().length) {
      return res.status(409).json({ ok: false, error: 'Connection migration is available only while the project registry is empty.', requestId: requestId(req) });
    }
    const body = req.body as Partial<UserConnections>;
    const connections: UserConnections = {
      jira: Array.isArray(body.jira) ? body.jira : [],
      qmetry: Array.isArray(body.qmetry) ? body.qmetry : [],
    };
    const plan = planConnectionProjectMigration(connections);
    if (!plan.length) {
      return res.status(400).json({ ok: false, error: 'No saved connection contains an explicit workspace or source project key to migrate.', requestId: requestId(req) });
    }
    for (const candidate of plan) {
      if (candidate.name.length < 2 || candidate.name.length > 100 || candidate.sourceKeys.some((key) => !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(key))) {
        throw new ProjectConnectionValidationError(`Project ${candidate.key} contains an invalid ownership key. Use 2-32 letters, numbers, underscores, or hyphens.`);
      }
    }
    const migrated = plan.map((candidate) => ({
      candidate,
      project: projectImports.createProject({ key: candidate.key, sourceKeys: candidate.sourceKeys, name: candidate.name }),
    }));
    return res.status(201).json({
      ok: true,
      projects: migrated.map(({ project }) => project),
      assignments: migrated.flatMap(({ candidate, project }) => [
        ...(candidate.jiraConnectionId ? [{ type: 'jira' as const, connectionId: candidate.jiraConnectionId, projectId: project.id, projectKey: project.key }] : []),
        ...(candidate.qmetryConnectionId ? [{ type: 'qmetry' as const, connectionId: candidate.qmetryConnectionId, projectId: project.id, projectKey: project.key }] : []),
      ]),
      requestId: requestId(req),
    });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.patch('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const project = projectImports.updateProject(req.params.projectId, req.body as { key?: string; sourceKeys?: string[]; name?: string; capabilities?: { vendorPortal?: boolean; wonderMilesExport?: boolean } });
    const published = await publishProjectImportOutputs(req);
    return res.json({ ok: true, project, ...published, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const confirmationKey = String((req.body as { confirmationKey?: string } | undefined)?.confirmationKey || '');
    const deletion = projectImports.deleteProject(req.params.projectId, confirmationKey);
    const published = await publishProjectImportOutputs(req);
    log(req, 'project deleted', { projectId: deletion.project.id, projectKey: deletion.project.key, filesDeleted: deletion.filesDeleted, syncReportsDeleted: deletion.syncReportsDeleted });
    return res.json({ ok: true, deletion, ...published, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/files', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.listFiles(req.params.projectId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/:projectId/files', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) });
  try {
    const file = projectImports.stageFile(req.params.projectId, req.file.originalname, req.file.buffer);
    log(req, 'project file staged', { projectId: req.params.projectId, fileId: file.id, filename: file.originalName, size: file.size });
    return res.status(201).json({ ok: true, file, message: 'File uploaded for the selected project. The Import Data workflow will automatically synchronize it.' });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/projects/:projectId/imports/sync', async (req: Request, res: Response) => {
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  try {
    const reconciliation = await projectImports.syncProjectSerialized(req.params.projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { ...filter, project: reconciliation.project.key });
    return res.json({
      ok: true,
      ...published,
      rowCounts: reconciliation.rowCounts,
      reconciliation,
      requestId: requestId(req),
    });
  } catch (err) {
    logError(req, 'project import sync failed', err, { projectId: req.params.projectId });
    return res.status(projectErrorStatus(err) === 404 ? 404 : 500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/projects/:projectId/files/:fileId', async (req: Request, res: Response) => {
  try {
    const removedFile = projectImports.deleteFile(req.params.projectId, req.params.fileId);
    const reconciliation = await projectImports.syncProjectSerialized(req.params.projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, removedFile, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/issues/dashboard', (req: Request, res: Response) => {
  try {
    const project = projectImports.getProject(req.params.projectId);
    const dataset = projectImports.uploadedIssueDataset(project.id);
    const filter = { ...parseFilterParams(req), project: project.key };
    return res.json(refilterDashboard(dataset, filter));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/:syncId', (req: Request, res: Response) => {
  try {
    return res.json(projectImports.getSyncReport(req.params.projectId, req.params.syncId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/projects/:projectId/imports/:syncId/report.csv', (req: Request, res: Response) => {
  try {
    const csv = projectImports.reconciliationCsv(req.params.projectId, req.params.syncId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-reconciliation-${path.basename(req.params.syncId)}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

// Compatibility endpoints remain project-scoped. They intentionally refuse an
// unscoped request so older clients cannot list, sync, or delete another
// project's files by accident.
router.post('/input/sync', async (req: Request, res: Response) => {
  const projectId = String((req.body as { projectId?: string }).projectId || '');
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required.', requestId: requestId(req) });
  try {
    const reconciliation = await projectImports.syncProjectSerialized(projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  const projectId = String((req.body as { projectId?: string }).projectId || '');
  if (!projectId) return res.status(400).json({ ok: false, error: 'projectId is required.', requestId: requestId(req) });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) });
  try {
    const file = projectImports.stageFile(projectId, req.file.originalname, req.file.buffer);
    return res.status(201).json({ ok: true, file, message: 'File staged for the selected project.' });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.get('/input/files', (req: Request, res: Response) => {
  const projectId = queryString(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId is required.', requestId: requestId(req) });
  try {
    return res.json(projectImports.listFiles(projectId));
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ error: toErrorMessage(err), requestId: requestId(req) });
  }
});

router.delete('/input/:fileId', async (req: Request, res: Response) => {
  const projectId = queryString(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId is required.', requestId: requestId(req) });
  try {
    const removedFile = projectImports.deleteFile(projectId, req.params.fileId);
    const reconciliation = await projectImports.syncProjectSerialized(projectId, req.header('x-user-name') || 'Local user');
    const published = await publishProjectImportOutputs(req, { project: reconciliation.project.key });
    return res.json({ ok: true, removedFile, ...published, rowCounts: reconciliation.rowCounts, reconciliation, requestId: requestId(req) });
  } catch (err) {
    return res.status(projectErrorStatus(err)).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

export default router;
