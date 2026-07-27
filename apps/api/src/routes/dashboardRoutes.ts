import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { emptyConnections, fetchFolderCycleHealth, fetchProjectCycles, fetchProjectFolders, qmetryConfigFromConnection, readJsonFile, refilterDashboard, toErrorMessage } from 'qa-dashboard-batch';
import { canUseDashboardPayloadFallback } from '../services/dashboardFallback';
import {
  apiScopeFromFilter,
  connectionSummary,
  DashboardPayload,
  ensureDataset,
  filterFromBody,
  hasLiveSources,
  log,
  logError,
  OUTPUT_DIR,
  parseFilterParams,
  queryString,
  refreshGeneratedOutputs,
  requestId,
  resolveConnections,
  rowCounts,
  selectQmetryConnection,
  withRegisteredPortfolioProjects,
} from './shared/context';

const router = Router();

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
  const filter = filterFromBody(req.body as Partial<import('qa-dashboard-batch').FilterParams>);
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

export default router;
