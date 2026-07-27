import { Router, Request, Response } from 'express';
import {
  runGenerate,
  testAnthropicConnection,
  testLlmConnection,
  toErrorMessage,
} from 'qa-dashboard-batch';
import type { LlmSelectionInput, FilterParams, ReportType } from 'qa-dashboard-batch';
import { getEnvStatus } from '../loadRepoEnv';
import {
  apiScopeFromFilter,
  capabilitiesByProject,
  cleanProject,
  CONFIG_DIR,
  connectionSummary,
  filterFromBody,
  hasLiveSources,
  INPUT_DIR,
  log,
  logError,
  mergedSourceDataset,
  OUTPUT_DIR,
  projectNamesByKey,
  refreshGeneratedOutputs,
  requestId,
  resolveAnthropicKey,
  resolveConnections,
  REPORT_TYPES,
  ROOT,
  withRegisteredPortfolioProjects,
} from './shared/context';

const router = Router();

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
    const resultPayload = await runGenerate({
      startDate,
      endDate,
      reportType: type,
      search,
      result: (result as 'all') || 'all',
      project: clean,
      inputDir: INPUT_DIR,
      outputDir: OUTPUT_DIR,
      configDir: CONFIG_DIR,
      apiKey: key.key || undefined,
      llm,
      connections,
      sourceDataset,
      capabilitiesByProject: capabilitiesByProject(),
      projectNamesByKey: projectNamesByKey(),
    });
    log(req, 'POST /generate:done', { ok: resultPayload.ok, rowCounts: resultPayload.rowCounts, warnings: resultPayload.warnings, error: resultPayload.error, paths: resultPayload.paths });
    return res.status(200).json({ ...resultPayload, requestId: requestId(req) });
  } catch (err) {
    logError(req, 'POST /generate:failed', err);
    return res.status(500).json({ ok: false, error: toErrorMessage(err), requestId: requestId(req) });
  }
});

export default router;
