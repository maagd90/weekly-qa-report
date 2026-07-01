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
} from 'qa-dashboard-batch';
import { generateReportPdf } from '../services/reportPdf';

const router = Router();

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const INPUT_DIR = process.env.INPUT_DIR || path.join(ROOT, 'input');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(ROOT, 'output');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, 'config');

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });

async function ensureDataset(): Promise<{ dataset: import('qa-dashboard-batch').Dataset; fingerprint: string } | null> {
  const fingerprint = computeFingerprint(INPUT_DIR, CONFIG_DIR);
  const cached = loadFingerprint(OUTPUT_DIR);
  let dataset = loadRawDataset(OUTPUT_DIR);

  if (dataset && cached === fingerprint) {
    return { dataset, fingerprint };
  }

  try {
    dataset = await buildDataset(INPUT_DIR, CONFIG_DIR);
    if (!dataset.executions.length && !dataset.issues.length && !dataset.uat.length) {
      return null;
    }
    saveRawDataset(OUTPUT_DIR, dataset, fingerprint);
    return { dataset, fingerprint };
  } catch (err) {
    console.error('[api] buildDataset failed:', (err as Error).message);
    return dataset ? { dataset, fingerprint: cached || fingerprint } : null;
  }
}

function parseFilterParams(req: Request) {
  return {
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    search: req.query.search as string | undefined,
    result: (req.query.result as 'all' | 'PASS' | 'FAIL' | 'BLOCKED') || 'all',
    project: req.query.project as string | undefined,
  };
}

// GET /api/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    jiraConfigured: Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
  });
});

// GET /api/anthropic/test — live Anthropic connectivity check (key + proxy + model)
router.get('/anthropic/test', async (_req: Request, res: Response) => {
  const result = await testAnthropicConnection(process.env.ANTHROPIC_API_KEY || '', CONFIG_DIR);
  res.json(result);
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INPUT_DIR),
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[/\\]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
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

// POST /api/generate
router.post('/generate', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, search, result, project } = req.body as {
    startDate?: string;
    endDate?: string;
    reportType?: string;
    search?: string;
    result?: string;
    project?: string;
  };

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const validTypes = ['full', 'executive', 'testers', 'cycles'];
  const type = validTypes.includes(reportType || '') ? reportType! : 'full';

  try {
    const resultPayload = await runGenerate({
      startDate,
      endDate,
      reportType: type as 'full' | 'executive' | 'testers' | 'cycles',
      search,
      result: (result as 'all') || 'all',
      project,
      inputDir: INPUT_DIR,
      outputDir: OUTPUT_DIR,
      configDir: CONFIG_DIR,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    if (!resultPayload.ok) {
      return res.status(resultPayload.paths.dashboard ? 207 : 400).json(resultPayload);
    }
    res.json(resultPayload);
  } catch (err) {
    console.error('[api] POST /generate failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/dashboard — re-filter cached dataset with query params
router.get('/dashboard', async (req: Request, res: Response) => {
  const filter = parseFilterParams(req);
  const cached = await ensureDataset();

  if (cached) {
    const payload = refilterDashboard(cached.dataset, filter);
    return res.json(payload);
  }

  const file = path.join(OUTPUT_DIR, 'dashboard-data.json');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'No dashboard generated yet. Click Generate Report or configure integrations.' });
  }
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// GET /api/report
router.get('/report', (_req: Request, res: Response) => {
  const mdPath = path.join(OUTPUT_DIR, 'report.md');
  const metaPath = path.join(OUTPUT_DIR, 'report-meta.json');
  if (!fs.existsSync(mdPath)) {
    return res.status(404).json({ error: 'No report generated yet.' });
  }
  const markdown = fs.readFileSync(mdPath, 'utf8');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  res.json({ markdown, meta });
});

// POST /api/report/pdf — server-side Puppeteer render of /print/report
router.post('/report/pdf', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, kpiStyle } = req.body as {
    startDate?: string;
    endDate?: string;
    reportType?: string;
    kpiStyle?: string;
  };

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const validTypes = ['full', 'executive', 'testers', 'cycles'];
  const type = validTypes.includes(reportType || '') ? reportType! : 'executive';
  const validKpi = ['editorial', 'framed', 'minimal'];
  const kpi = validKpi.includes(kpiStyle || '') ? kpiStyle! : 'editorial';

  const cached = await ensureDataset();
  if (!cached) {
    return res.status(404).json({ error: 'No dashboard data. Generate a report first.' });
  }

  const payload = refilterDashboard(cached.dataset, { startDate, endDate });
  if (!payload.overview.totalCases && !payload.uat?.total) {
    return res.status(404).json({ error: 'No metrics for this date range.' });
  }

  try {
    const pdfBuffer = await generateReportPdf(startDate, endDate, type, kpi);
    const filename = `qa-report-${startDate}-to-${endDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[api] POST /report/pdf failed:', (err as Error).message);
    res.status(500).json({ error: `PDF generation failed: ${(err as Error).message}` });
  }
});

// GET /api/integrations
router.get('/integrations', (_req: Request, res: Response) => {
  const summary = integrationsSummary(CONFIG_DIR);
  const cfg = loadIntegrations(CONFIG_DIR);
  res.json({
    ...summary,
    config: {
      jira: { enabled: cfg.jira.enabled, projectKeys: cfg.jira.projectKeys, jql: cfg.jira.jql },
      qmetry: { enabled: cfg.qmetry.enabled, projectKey: cfg.qmetry.projectKey, cycleIds: cfg.qmetry.cycleIds },
    },
  });
});

// POST /api/integrations/test
router.post('/integrations/test', async (_req: Request, res: Response) => {
  try {
    const dataset = await buildDataset(INPUT_DIR, CONFIG_DIR);
    res.json({
      ok: true,
      executions: dataset.executions.length,
      issues: dataset.issues.length,
      uat: dataset.uat.length,
      warnings: dataset.meta.warnings,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/upload
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, filename: req.file.filename, path: req.file.path, message: 'File staged. Run Generate Report to process.' });
});

// GET /api/input/files
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

// DELETE /api/input/:filename
router.delete('/input/:filename', (req: Request, res: Response) => {
  const safe = path.basename(req.params.filename);
  const filePath = path.join(INPUT_DIR, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

export default router;
