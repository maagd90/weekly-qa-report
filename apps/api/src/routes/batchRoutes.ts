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
} from 'qa-dashboard-batch';
import type { Dataset, LlmSelectionInput, UserConnections, JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
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

function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || req.header('x-request-id') || 'no-request-id';
}

function log(req: Request, message: string, data?: Record<string, unknown>): void { console.log(`[api] [${requestId(req)}] ${message}`, data || ''); }
function logError(req: Request, message: string, err: unknown, data?: Record<string, unknown>): void { console.error(`[api] [${requestId(req)}] ${message}`, { ...data, error: err instanceof Error ? err.message : String(err) }); }
function outputPath(fileName: string): string { return path.join(OUTPUT_DIR, fileName); }
function removeOutputFile(fileName: string): string | null { const filePath = outputPath(fileName); if (!fs.existsSync(filePath)) return null; fs.unlinkSync(filePath); return fileName; }
function clearOutputFiles(fileNames: string[] = GENERATED_OUTPUT_FILES): string[] { const removed = new Set<string>(); for (const fileName of fileNames) { const deleted = removeOutputFile(fileName); if (deleted) removed.add(deleted); } return [...removed]; }
function rowCounts(dataset: Dataset): { executions: number; issues: number; uat: number } { return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }; }
function totalRows(dataset: Dataset): number { const counts = rowCounts(dataset); return counts.executions + counts.issues + counts.uat; }

async function refreshGeneratedOutputs(req: Request, connections: UserConnections) {
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR, connections);
  const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections);
  const counts = rowCounts(dataset);
  const removed = clearOutputFiles(REPORT_OUTPUT_FILES);
  if (totalRows(dataset) === 0) {
    removed.push(...clearOutputFiles(['raw-dataset.json', 'dataset-fingerprint.txt', 'dashboard-data.json']));
    log(req, 'generated outputs cleared; no source data remains', { rowCounts: counts, removed });
    return { rebuilt: false, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects };
  }
  saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
  const payload = refilterDashboard(dataset, {});
  fs.writeFileSync(outputPath('dashboard-data.json'), JSON.stringify(payload, null, 2));
  log(req, 'generated outputs refreshed after input change', { rowCounts: counts, warnings: dataset.meta.warnings, projects: dataset.projects });
  return { rebuilt: true, rowCounts: counts, removed, warnings: dataset.meta.warnings, files: dataset.files, projects: dataset.projects };
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
  } catch (err) { logError(req, 'failed to parse x-user-connections header', err); return emptyConnections(); }
}

function resolveAnthropicKey(req: Request): { key: string; source: 'user' | 'server' | 'none' } {
  const headerKey = (req.header('x-anthropic-key') || '').trim();
  if (headerKey) return { key: headerKey, source: 'user' };
  const envKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (envKey) return { key: envKey, source: 'server' };
  return { key: '', source: 'none' };
}

async function ensureDataset(req: Request, connections: UserConnections): Promise<{ dataset: Dataset; fingerprint: string } | null> {
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR, connections);
  const cached = loadFingerprint(OUTPUT_DIR);
  let dataset = loadRawDataset(OUTPUT_DIR);
  log(req, 'ensureDataset:start', { inputDir: INPUT_DIR, configDir: CONFIG_DIR, outputDir: OUTPUT_DIR, fingerprint, cachedFingerprint: cached });
  if (dataset && cached === fingerprint) { log(req, 'ensureDataset:using cached dataset', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length }); return { dataset, fingerprint }; }
  try {
    dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections);
    log(req, 'ensureDataset:built dataset', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings });
    if (totalRows(dataset) === 0) { const removed = clearOutputFiles(); log(req, 'ensureDataset:no data; cleared stale outputs', { removed }); return null; }
    saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
    return { dataset, fingerprint };
  } catch (err) { logError(req, 'ensureDataset:build failed', err); return dataset ? { dataset, fingerprint: cached || fingerprint } : null; }
}

function parseFilterParams(req: Request) {
  return { startDate: req.query.startDate as string | undefined, endDate: req.query.endDate as string | undefined, search: req.query.search as string | undefined, result: (req.query.result as 'all' | 'PASS' | 'FAIL' | 'BLOCKED') || 'all', project: req.query.project as string | undefined };
}

function queryString(value: unknown, fallback = ''): string { if (typeof value === 'string') return value; if (Array.isArray(value) && typeof value[0] === 'string') return value[0]; return fallback; }
function selectQmetryConnection(connections: UserConnections, connectionId?: string): QmetryConnectionInput | null { if (!connections.qmetry.length) return null; if (connectionId) return connections.qmetry.find((c) => c.id === connectionId) || connections.qmetry[0]; return connections.qmetry[0]; }

router.get('/status', (_req: Request, res: Response) => res.json({ apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.CUSTOM_LLM_API_KEY), llmProvidersConfigured: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), custom: Boolean(process.env.CUSTOM_LLM_API_KEY) }, jiraConfigured: Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN), projectRoot: process.env.PROJECT_ROOT || ROOT }));
router.get('/env', (_req: Request, res: Response) => res.json(getEnvStatus()));

router.post('/llm/test', async (req: Request, res: Response) => {
  log(req, 'POST /llm/test:start', { provider: (req.body as LlmSelectionInput | undefined)?.provider, model: (req.body as LlmSelectionInput | undefined)?.model });
  try { const result = await testLlmConnection((req.body || {}) as LlmSelectionInput, CONFIG_DIR); log(req, 'POST /llm/test:done', { ok: result.ok, provider: result.provider, model: result.model, error: result.error }); res.json(result); }
  catch (err) { logError(req, 'POST /llm/test:failed', err); res.status(500).json({ ok: false, route: 'direct', error: (err as Error).message || String(err), requestId: requestId(req) }); }
});

router.get('/anthropic/test', async (req: Request, res: Response) => {
  const key = resolveAnthropicKey(req);
  log(req, 'GET /anthropic/test:start', { keySource: key.source, configDir: CONFIG_DIR });
  try { const result = await testAnthropicConnection(key.key, CONFIG_DIR); log(req, 'GET /anthropic/test:done', { ok: result.ok, route: result.route, elapsedMs: result.elapsedMs, error: result.error }); res.json(result); }
  catch (err) { logError(req, 'GET /anthropic/test:failed', err); res.status(500).json({ ok: false, route: 'direct', error: (err as Error).message || String(err), requestId: requestId(req) }); }
});

const storage = multer.diskStorage({ destination: (_req, _file, cb) => cb(null, INPUT_DIR), filename: (_req, file, cb) => cb(null, `${Date.now()}_${path.basename(file.originalname).replace(/[/\\]/g, '_')}`) });
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { const ext = path.extname(file.originalname).toLowerCase(); if (ext === '.xlsx' || ext === '.xls') cb(null, true); else cb(new Error('Only .xlsx and .xls files are allowed')); } });

router.post('/generate', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, search, result, project, llm } = req.body as { startDate?: string; endDate?: string; reportType?: string; search?: string; result?: string; project?: string; llm?: LlmSelectionInput };
  const connections = resolveConnections(req);
  const key = resolveAnthropicKey(req);
  log(req, 'POST /generate:start', { startDate, endDate, reportType, search, result, project, keySource: key.source, connections: connectionSummary(connections) });
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'startDate and endDate are required', requestId: requestId(req) });
  const type = ['full', 'executive', 'testers', 'cycles'].includes(reportType || '') ? reportType! : 'full';
  try {
    const resultPayload = await runGenerate({ startDate, endDate, reportType: type as 'full' | 'executive' | 'testers' | 'cycles', search, result: (result as 'all') || 'all', project, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, configDir: CONFIG_DIR, apiKey: key.key || undefined, llm, connections });
    log(req, 'POST /generate:done', { ok: resultPayload.ok, rowCounts: resultPayload.rowCounts, warnings: resultPayload.warnings, error: resultPayload.error, paths: resultPayload.paths });
    return res.status(200).json({ ...resultPayload, requestId: requestId(req) });
  } catch (err) { logError(req, 'POST /generate:failed', err); return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) }); }
});

router.get('/dashboard', async (req: Request, res: Response) => {
  const filter = parseFilterParams(req);
  const connections = resolveConnections(req);
  log(req, 'GET /dashboard:start', { filter, connections: connectionSummary(connections) });
  const cached = await ensureDataset(req, connections);
  if (cached) return res.json(refilterDashboard(cached.dataset, filter));
  const file = path.join(OUTPUT_DIR, 'dashboard-data.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No dashboard generated yet. Click Sync on Import Data or generate a report.', requestId: requestId(req) });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

router.post('/dashboard/search', async (req: Request, res: Response) => {
  const { startDate, endDate, search, result, project } = req.body as { startDate?: string; endDate?: string; search?: string; result?: 'all' | 'PASS' | 'FAIL' | 'BLOCKED'; project?: string };
  const connections = resolveConnections(req);
  log(req, 'POST /dashboard/search:start', { startDate, endDate, search, result, project, connections: connectionSummary(connections) });
  if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'startDate and endDate are required', requestId: requestId(req) });
  try {
    const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections, { jiraSearchScope: { startDate, endDate, project } });
    const dashboard = refilterDashboard(dataset, { startDate, endDate, search, result: result || 'all', project });
    log(req, 'POST /dashboard/search:done', { rowCounts: rowCounts(dataset), overview: dashboard.overview, warnings: dataset.meta.warnings });
    return res.json({ ok: true, dashboard, rowCounts: rowCounts(dataset), warnings: dataset.meta.warnings, requestId: requestId(req) });
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
    } catch (err) { logError(req, `GET /cycles/folders:qmetry failed for ${conn.name}`, err); }
  }
  const cached = await ensureDataset(req, connections);
  if (!cached) return res.json({ source: 'imported', folders: [{ id: 'all', name: 'All imported cycles' }], cycles: [] });
  const seen = new Map<string, string>();
  for (const e of cached.dataset.executions) if (e.cycleKey && !seen.has(e.cycleKey)) seen.set(e.cycleKey, e.cycleName || e.cycleKey);
  const cycles = [...seen.entries()].map(([id, name]) => ({ id, name }));
  res.json({ source: 'imported', folders: [{ id: 'all', name: 'All imported cycles' }], cycles });
});

router.get('/cycles/by-folder', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  const folderId = queryString(req.query.folderId, 'all') || 'all';
  const conn = selectQmetryConnection(connections, queryString(req.query.connectionId));
  log(req, 'GET /cycles/by-folder:start', { folderId, connection: conn?.name || 'none' });
  if (conn) {
    try {
      const result = await fetchFolderCycleHealth(qmetryConfigFromConnection(conn), folderId === 'all' ? undefined : folderId);
      log(req, 'GET /cycles/by-folder:qmetry result', { connection: conn.name, folderId, cycles: result.cycles.length, error: result.error });
      return res.json({ source: 'qmetry-live', connection: conn.name, connectionId: conn.id, folderId, cycles: result.cycles, warnings: result.error ? [result.error] : [] });
    } catch (err) { logError(req, `GET /cycles/by-folder:qmetry failed for ${conn.name}`, err); }
  }
  const cached = await ensureDataset(req, connections);
  if (!cached) return res.json({ source: 'imported', folderId, cycles: [] });
  const payload = refilterDashboard(cached.dataset, parseFilterParams(req));
  res.json({ source: 'imported', folderId, cycles: payload.cycles });
});

router.get('/report', (_req: Request, res: Response) => { const mdPath = path.join(OUTPUT_DIR, 'report.md'); const metaPath = path.join(OUTPUT_DIR, 'report-meta.json'); if (!fs.existsSync(mdPath)) return res.status(404).json({ error: 'No report generated yet.' }); const markdown = fs.readFileSync(mdPath, 'utf8'); const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {}; res.json({ markdown, meta }); });

router.post('/report/pdf', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, kpiStyle, project, branding } = req.body as { startDate?: string; endDate?: string; reportType?: string; kpiStyle?: string; project?: string; branding?: ReportBrandingPayload };
  const connections = resolveConnections(req);
  log(req, 'POST /report/pdf:start', { startDate, endDate, reportType, kpiStyle, project, hasLogo: Boolean(branding?.logoUrl), connections: connectionSummary(connections) });
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required', requestId: requestId(req) });
  const type = ['full', 'executive', 'testers', 'cycles'].includes(reportType || '') ? reportType! : 'executive';
  const kpi = ['editorial', 'framed', 'minimal'].includes(kpiStyle || '') ? kpiStyle! : 'editorial';
  const cached = await ensureDataset(req, connections);
  if (!cached) return res.status(404).json({ error: 'No dashboard data. Click Sync on Import Data first.', requestId: requestId(req) });
  const payload = refilterDashboard(cached.dataset, { startDate, endDate, project });
  if (!payload.overview.totalCases && !payload.uat?.total) return res.status(404).json({ error: 'No metrics for this date range/project.', requestId: requestId(req) });
  try {
    const pdfBuffer = await generateReportPdf(startDate, endDate, type, kpi, project, branding);
    const suffix = project && project !== 'all' ? `-${project}` : '';
    const filename = `qa-report${suffix}-${startDate}-to-${endDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) { logError(req, 'POST /report/pdf:failed', err, { project }); res.status(500).json({ error: `PDF generation failed: ${(err as Error).message}`, requestId: requestId(req) }); }
});

router.get('/integrations', (req: Request, res: Response) => {
  const summary = integrationsSummary(CONFIG_DIR);
  const cfg = loadIntegrations(CONFIG_DIR);
  const userConnections = resolveConnections(req);
  res.json({ ...summary, config: { jira: { enabled: cfg.jira.enabled, projectKeys: cfg.jira.projectKeys, jql: cfg.jira.jql }, qmetry: { enabled: cfg.qmetry.enabled, projectKey: cfg.qmetry.projectKey, projectId: cfg.qmetry.projectId } }, userConnections: { jira: userConnections.jira.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl })), qmetry: userConnections.qmetry.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl })) } });
});

router.post('/integrations/test', async (req: Request, res: Response) => {
  const connections = resolveConnections(req);
  log(req, 'POST /integrations/test:start', { connections: connectionSummary(connections) });
  try { const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR, connections); log(req, 'POST /integrations/test:done', { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings }); res.json({ ok: true, executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, warnings: dataset.meta.warnings }); }
  catch (err) { logError(req, 'POST /integrations/test:failed', err); res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) }); }
});

router.post('/integrations/test-connection', async (req: Request, res: Response) => {
  const { type, connection } = req.body as { type?: 'jira' | 'qmetry'; connection?: JiraConnectionInput | QmetryConnectionInput };
  if (!type || !connection) return res.status(400).json({ ok: false, error: 'type and connection are required', requestId: requestId(req) });
  try {
    if (type === 'jira') { const { issues, error } = await fetchJiraIssues({ ...jiraConfigFromConnection(connection as JiraConnectionInput), pageSize: 5 }); if (error) return res.json({ ok: false, error }); return res.json({ ok: true, count: issues.length }); }
    const qmetryCfg = qmetryConfigFromConnection(connection as QmetryConnectionInput);
    const cycles = await searchQmetryTestCycles(qmetryCfg, { startAt: 0, maxResults: 5 });
    if (cycles.error) return res.json({ ok: false, error: cycles.error });
    return res.json({ ok: true, count: cycles.total, sampleCycles: cycles.cycles });
  } catch (err) { return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) }); }
});

router.post('/input/sync', async (req: Request, res: Response) => { const connections = resolveConnections(req); log(req, 'POST /input/sync:start', { connections: connectionSummary(connections) }); try { const sync = await refreshGeneratedOutputs(req, connections); return res.json({ ok: true, ...sync, requestId: requestId(req) }); } catch (err) { logError(req, 'POST /input/sync:failed', err); return res.status(500).json({ ok: false, error: (err as Error).message, requestId: requestId(req) }); } });
router.post('/upload', upload.single('file'), (req: Request, res: Response) => { if (!req.file) return res.status(400).json({ error: 'No file uploaded', requestId: requestId(req) }); log(req, 'POST /upload:done', { filename: req.file.filename, size: req.file.size }); res.json({ ok: true, filename: req.file.filename, path: req.file.path, message: 'File staged. Click Sync to update dashboard data.' }); });
router.get('/input/files', (_req: Request, res: Response) => { if (!fs.existsSync(INPUT_DIR)) return res.json([]); const files = fs.readdirSync(INPUT_DIR).filter((f) => !f.startsWith('.')).map((f) => { const stat = fs.statSync(path.join(INPUT_DIR, f)); return { name: f, size: stat.size, modifiedAt: stat.mtime.toISOString() }; }); res.json(files); });

router.delete('/input/:filename', async (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found', requestId: requestId(req) });
  fs.unlinkSync(filePath);
  const connections = resolveConnections(req);
  log(req, 'DELETE /input:file removed', { filename, connections: connectionSummary(connections) });
  try { const refresh = await refreshGeneratedOutputs(req, connections); return res.json({ ok: true, filename, ...refresh }); }
  catch (err) { const removed = clearOutputFiles(); logError(req, 'DELETE /input:refresh failed; cleared stale outputs', err, { filename, removed }); return res.json({ ok: true, filename, rebuilt: false, rowCounts: { executions: 0, issues: 0, uat: 0 }, removed, warnings: [`File removed, but generated data refresh failed: ${(err as Error).message}`] }); }
});

export default router;
