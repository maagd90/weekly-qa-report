import { Router, Request, Response } from 'express';
import {
  buildDataset,
  fetchJiraIssues,
  integrationsSummary,
  jiraConfigFromConnection,
  loadIntegrations,
  qmetryConfigFromConnection,
  searchQmetryTestCycles,
  toErrorMessage,
} from 'qa-dashboard-batch';
import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
import { ProjectConnectionValidationError, scopeProjectConnections, validateProjectConnections } from '../services/projectConnections';
import {
  apiScopeFromFilter,
  CONFIG_DIR,
  connectionSummary,
  filterFromBody,
  INPUT_DIR,
  log,
  logError,
  projectImports,
  refreshGeneratedOutputs,
  requestId,
  resolveConnections,
} from './shared/context';

const router = Router();

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
  const filter = filterFromBody(req.body as Partial<import('qa-dashboard-batch').FilterParams>);
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
  const filter = filterFromBody(req.body as Partial<import('qa-dashboard-batch').FilterParams>);
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

export default router;
