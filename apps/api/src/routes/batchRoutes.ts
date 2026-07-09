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
  canonicalProjectKey,
  canonicalProjectOrUndefined,
  dataDateBounds,
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

const router = Router();
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const INPUT_DIR = process.env.INPUT_DIR || path.join(ROOT, 'input');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(ROOT, 'output');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, 'config');

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });

const GENERATED_OUTPUT_FILES = ['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json', 'report.md', 'report-meta.json'];
const REPORT_OUTPUT_FILES = ['report.md', 'report-meta.json'];
const IMPORT_CACHE_FILE = 'raw-dataset.imported.json';
const LIVE_CACHE_FILE = 'raw-dataset.live.json';
const REPORT_TYPES: ReportType[] = ['full', 'executive', 'testers', 'defects', 'cycles'];

type BuildMode = 'cached' | 'import-only' | 'live';
type DashboardPayload = ReturnType<typeof refilterDashboard>;

function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

function log(req: Request, message: string, data?: Record<string, unknown>): void {
  console.log(`[api] [${requestId(req)}] ${message}`, data || '');
}

function logError(req: Request, message: string, err: unknown, data?: Record<string, unknown>): void {
  console.error(`[api] [${requestId(req)}] ${message}`, { ...data, error: err instanceof Error ? err.message : String(err) });
}

function outputPath(fileName: string): string {
  return path.join(OUTPUT_DIR, fileName);
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

function totalRows(dataset: Dataset): number {
  const counts = rowCounts(dataset);
  return counts.executions + counts.issues + counts.uat;
}

function validDate(value?: string): string | undefined {
  const v = (value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function cleanProject(value?: string): string | undefined {
  return canonicalProjectOrUndefined(value);
}

function cleanApiScope(scope?: ApiFetchScope): ApiFetchScope | undefined {
  if (!scope) return undefined;
  const next: ApiFetchScope = {};
  const startDate = validDate(scope.startDate);
  const endDate = validDate(scope.endDate);
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

function buildOptions(mode: BuildMode, apiScope?: ApiFetchScope) {
  return { apiScope: mode === 'live' ? cleanApiScope(apiScope) : undefined, liveSync: mode === 'live', includeFiles: mode !== 'live' };
}

function projectRows(dataset: Dataset): Array<{ project: string; rows: number }> {
  const counts = new Map<string, number>();
  const add = (project?: string, rows = 1) => {
    const key = canonicalProjectKey(project || 'UNKNOWN') || 'UNKNOWN';
    counts.set(key, (counts.get(key) || 0) + rows);
  };
  for (const row of dataset.executions) add(row.project);
  for (const row of dataset.issues) add(row.project);
  for (const row of dataset.uat) add(row.project);
  return [...counts.entries()].map(([project, rows]) => ({ project, rows })).sort((a, b) => a.project.localeCompare(b.project));
}

function datasetProjectsSummary(dataset: Dataset): string {
  const rows = projectRows(dataset);
  if (!rows.length) return 'no projects / 0 rows';
  return rows.map((p) => `${p.project} (${p.rows} rows)`).join(', ');
}

function noMetricsMessage(project: string | undefined, startDate: string | undefined, endDate: string | undefined, dataset: Dataset): string {
  const requestedProject = project && project !== 'all' ? project : 'all projects';
  const start = startDate || 'any';
  const end = endDate || 'any';
  return `No metrics for ${requestedProject} in ${start}..${end}. Dataset contains: ${datasetProjectsSummary(dataset)}. Re-sync imported data if a project is missing.`;
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
  const filePath = outputPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Dataset;
}

function saveDatasetFile(fileName: string, dataset: Dataset): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(outputPath(fileName), JSON.stringify(dataset, null, 2));
}

function projectMatchesScope(project: string | undefined, scope?: ApiFetchScope): boolean {
  const selected = canonicalProjectOrUndefined(scope?.project);
  if (!selected) return true;
  return canonicalProjectKey(project || '') === selected;
}

function dateMatchesScope(dates: Array<string | null | undefined>, scope?: ApiFetchScope): boolean {
  const startDate = validDate(scope?.startDate);
  const endDate = validDate(scope?.endDate);
  if (!startDate && !endDate) return true;
  return dates.some((raw) => {
    const date = validDate(raw || undefined);
    return Boolean(date && (!startDate || date >= startDate) && (!endDate || date <= endDate));
  });
}

function issueMatchesScope(row: Dataset['issues'][number], scope?: ApiFetchScope): boolean {
  return projectMatchesScope(row.project, scope) && dateMatchesScope([row.createdAt, row.updatedAt, row.resolvedAt], scope);
}

function executionMatchesScope(row: Dataset['executions'][number], scope?: ApiFetchScope): boolean {
  return projectMatchesScope(row.project, scope) && dateMatchesScope([row.executedAt, row.updatedAt], scope);
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

  const preservedIssues = freshJira ? previousJira.filter((row) => !issueMatchesScope(row, apiScope)) : previousJira;
  const preservedExecutions = freshQmetry ? previousQmetry.filter((row) => !executionMatchesScope(row, apiScope)) : previousQmetry;
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
  if (connections.jira.some((c) => c.enabled !== false && c.syncIssues !== false)) return true;
  if (connections.qmetry.some((c) => c.enabled !== false && c.syncExecutions !== false)) return true;
  const summary = integrationsSummary(CONFIG_DIR);
  return Boolean(summary.jira.enabled || summary.qmetry.enabled);
}

function mergedSourceDataset(updatedMode?: BuildMode, updatedDataset?: Dataset): Dataset {
  const parts: Dataset[] = [];
  const importDataset = updatedMode === 'import-only' ? updatedDataset : loadDatasetFile(IMPORT_CACHE_FILE);
  const liveDataset = updatedMode === 'live' ? updatedDataset : loadDatasetFile(LIVE_CACHE_FILE);
  if (importDataset) parts.push(importDataset);
  if (liveDataset) parts.push(liveDataset);
  return mergeDatasets(parts);
}

async function refreshGeneratedOutputs(req: Request, connections: UserConnections, apiScope?: ApiFetchScope, dashboardFilter: Partial<FilterParams> = {}, mode: BuildMode = 'live') {
  const options = buildOptions(mode, apiScope);
  const sourceConnections = mode === 'live' ? connections : emptyConnections();
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR, sourceConnections, options);
  const freshSourceDataset = await buildDataset(INPUT_DIR, CONFIG_DIR, sourceConnections, options);
  const sourceDataset = mode === 'live' ? preserveLiveCache(freshSourceDataset, options.apiScope) : freshSourceDataset;
  const sourceCacheFile = cacheFileForMode(mode);
  if (sourceCacheFile) saveDatasetFile(sourceCacheFile, sourceDataset);
  const dataset = mergedSourceDataset(mode, sourceDataset);
  const counts = rowCounts(dataset);
  const removed = clearOutputFiles(REPORT_OUTPUT_FILES);
  if (totalRows(dataset) === 0) {
    removed.push(...clearOutputFiles(['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json']));
    log(req, 'generated outputs cleared; no source data remains', { mode, rowCounts: counts, removed, apiScope: options.apiScope });
    return { rebuilt: false, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects };
  }
  saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
  const payload = refilterDashboard(dataset, { ...dashboardFilter, project: cleanProject(dashboardFilter.project) });
  fs.writeFileSync(outputPath('dashboard-data.json'), JSON.stringify(payload, null, 2));
  log(req, 'generated outputs refreshed', { mode, rowCounts: counts, warnings: dataset.meta.warnings, projects: dataset.projects, apiScope: options.apiScope });
  return { rebuilt: true, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects, dashboard: payload };
}

function connectionSummary(connections: UserConnections) {
  return {
    jira: connections.jira.map((c) => ({ name: c.name, baseUrl: c.baseUrl, projectKeys: c.projectKeys?.join(',') || '' })),
    qmetry: connections.qmetry.map((c) => ({ name: c.name, baseUrl: c.baseUrl, projectKey: c.projectKey, projectId: c.projectId || '', folderId: c.folderId || '' })),
  };
}

function resolveConnections(req: Request): UserConnections {
  const raw = req.header('x-user-connections');
  if (!raw) return emptyConnections();
  try {
    const parsed = JSON.parse(raw) as Partial<UserConnections>;
    const connections = { jira: Array.isArray(parsed.jira) ? parsed.jira : [], qmetry: Array.isArray(parsed.qmetry) ? parsed.qmetry : [] };
    log(req, 'resolved browser connections', connectionSummary(connections));
    return connections;
  } catch (err) {
    logError(req, 'failed to parse x-user-connections header', err);
    return emptyConnections();
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
    const builtDataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections, options);
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
  if (connectionId) return connections.qmetry.find((c) => c.id === connectionId) || connections.qmetry[0];
  return connections.qmetry[0];
}

router.get('/status', (_req: Request, res: Response) => res.json({
  apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.CUSTOM_LLM_API_KEY),
  llmProvidersConfigured: {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    custom: Boolean(process.env.CUSTOM_LLM_API_KEY),
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
    res.status(500).json({ ok: false, route: 'direct', error: (err as Error).message || String(err), requestId: requestId(req) });
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
    res.status(500).json({ ok: false, route: 'direct', error: (err as Error).message || String(err), requestId: requestId(req) });
  }
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INPUT_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${path.basename(file.originalname).replace(/[/\\]/g, '_')}`),
});
const upload = multer({
  storage,
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
    const resultPayload = await runGenerate({ startDate, endDate, reportType: type, search, result: (result as 'all') || 'all', project: clean, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, configDir: CONFIG_DIR, apiKey: key.key || undefined, llm, connections });
    log(req, 'POST /generate:done', { ok: resultPayload.ok, rowCounts: resultPayload.rowCounts, warnings: resultPayload.warnings, error: resultPayload.error, paths: resultPayload.paths });
    return res.status(200).json({ ...resultPayload, requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /generate:failed', err);
    return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
  }
});

router.get('/dashboard', async (req: Request, res: Response) => {
  const filter = parseFilterParams(req);
  const connections = resolveConnections(req);
  log(req, 'GET /dashboard:start', { filter, mode: 'cached-refilter', connections: connectionSummary(connections) });
  const cached = await ensureDataset(req, connections, undefined, 'cached');
  if (cached) return res.json(refilterDashboard(cached.dataset, filter));
  const imported = await ensureDataset(req, emptyConnections(), undefined, 'import-only');
  if (imported) return res.json(refilterDashboard(imported.dataset, filter));
  const file = path.join(OUTPUT_DIR, 'dashboard-data.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No dashboard generated yet. Import files, then Sync imported data, or use Settings → Sync JIRA/QMetry. Dataset contains: no projects / 0 rows.', requestId: requestId(req) });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
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
          return res.json({ ok: true, dashboard, rowCounts: rowCounts(cached.dataset), warnings: [`Live search failed: ${(liveErr as Error).message}`, ...cached.dataset.meta.warnings], projects: cached.dataset.projects, source: 'cached-fallback', requestId: requestId(req) });
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
    return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
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
  const mdPath = path.join(OUTPUT_DIR, 'report.md');
  const metaPath = path.join(OUTPUT_DIR, 'report-meta.json');
  if (!fs.existsSync(mdPath)) return res.status(404).json({ error: 'No report generated yet.' });
  const markdown = fs.readFileSync(mdPath, 'utf8');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  res.json({ markdown, meta });
});

router.post('/report/pdf', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, kpiStyle, project, branding } = req.body as { startDate?: string; endDate?: string; reportType?: string; kpiStyle?: string; project?: string; branding?: ReportBrandingPayload };
  const clean = cleanProject(project);
  const connections = resolveConnections(req);
  log(req, 'POST /report/pdf:start', { startDate, endDate, reportType, kpiStyle, project: clean, hasLogo: Boolean(branding?.logoUrl), connections: connectionSummary(connections) });
  const type = REPORT_TYPES.includes(reportType as ReportType) ? (reportType as ReportType) : 'executive';
  const kpi = ['editorial', 'framed', 'minimal'].includes(kpiStyle || '') ? kpiStyle! : 'editorial';
  const cached = await ensureDataset(req, connections, undefined, 'cached');
  if (!cached) return res.status(404).json({ error: 'No dashboard data. Search or sync data before downloading PDF. Dataset contains: no projects / 0 rows.', requestId: requestId(req) });
  const payload = refilterDashboard(cached.dataset, { startDate, endDate, project: clean });
  if (!hasMetrics(payload)) return res.status(404).json({ error: noMetricsMessage(clean, startDate, endDate, cached.dataset), requestId: requestId(req), projects: projectRows(cached.dataset) });
  const bounds = (!startDate || !endDate) ? dataDateBounds(cached.dataset) : null;
  const effectiveStartDate = startDate || bounds?.min || '';
  const effectiveEndDate = endDate || bounds?.max || '';
  try {
    const pdfBuffer = await generateReportPdf(effectiveStartDate, effectiveEndDate, type, kpi, clean, branding);
    const suffix = clean ? `-${clean}` : '';
    const filename = `qa-report${suffix}-${effectiveStartDate}-to-${effectiveEndDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    logError(req, 'POST /report/pdf:failed', err, { project: clean });
    res.status(500).json({ error: `PDF generation failed: ${(err as Error).message}`, requestId: requestId(req) });
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
  log(req, 'POST /integrations/test:start', { connections: connectionSummary(connections) });
  try {
    const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections, { liveSync: true });
    log(req, 'POST /integrations/test:done', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings });
    res.json({ ok: true, executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings });
  } catch (err) {
    logError(req, 'POST /integrations/test:failed', err);
    res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
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
    return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
  }
});

router.post('/integrations/test-connection', async (req: Request, res: Response) => {
  const { type, connection } = req.body as { type?: 'jira' | 'qmetry'; connection?: JiraConnectionInput | QmetryConnectionInput };
  if (!type || !connection) return res.status(400).json({ ok: false, error: 'type and connection are required', requestId: requestId(req) });
  try {
    if (type === 'jira') {
      const { issues, error } = await fetchJiraIssues({ ...jiraConfigFromConnection(connection as JiraConnectionInput), pageSize: 5 });
      if (error) return res.json({ ok: false, error });
      return res.json({ ok: true, count: issues.length });
    }
    const qmetryCfg = qmetryConfigFromConnection(connection as QmetryConnectionInput);
    const cycles = await searchQmetryTestCycles(qmetryCfg, { startAt: 0, maxResults: 5 });
    if (cycles.error) return res.json({ ok: false, error: cycles.error });
    return res.json({ ok: true, count: cycles.total, sampleCycles: cycles.cycles });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
  }
});

router.post('/input/sync', async (req: Request, res: Response) => {
  const filter = filterFromBody(req.body as Partial<FilterParams>);
  log(req, 'POST /input/sync:start', { filter, mode: 'import-only' });
  try {
    const sync = await refreshGeneratedOutputs(req, emptyConnections(), undefined, filter, 'import-only');
    return res.json({ ok: true, ...sync, requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /input/sync:failed', err);
    return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) });
  }
});

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) });
  log(req, 'POST /upload:done', { filename: req.file.filename, size: req.file.size });
  res.json({ ok: true, filename: req.file.filename, path: req.file.path, message: 'File staged. Click Sync imported data to update dashboard data.' });
});

router.get('/input/files', (_req: Request, res: Response) => {
  if (!fs.existsSync(INPUT_DIR)) return res.json([]);
  const files = fs.readdirSync(INPUT_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const stat = fs.statSync(path.join(INPUT_DIR, f));
      return { name: f, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    });
  res.json(files);
});

router.delete('/input/:filename', async (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found', requestId: requestId(req) });
  fs.unlinkSync(filePath);
  log(req, 'DELETE /input:file removed', { filename, mode: 'import-only' });
  try {
    const refresh = await refreshGeneratedOutputs(req, emptyConnections(), undefined, {}, 'import-only');
    return res.json({ ok: true, filename, ...refresh });
  } catch (err) {
    const removed = clearOutputFiles();
    logError(req, 'DELETE /input:refresh failed; cleared stale outputs', err, { filename, removed });
    return res.json({ ok: true, filename, rebuilt: false, rowCounts: { executions: 0, issues: 0, uat: 0 }, removed, warnings: [`File removed, but imported data refresh failed: ${(err as Error).message}`] });
  }
});

export default router;
