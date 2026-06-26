import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { runGenerate } from 'qa-dashboard-batch';
import { saveMapping, listMappings } from 'qa-dashboard-batch';

const router = Router();

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
const INPUT_DIR = process.env.INPUT_DIR || path.join(ROOT, 'input');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(ROOT, 'output');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, 'config');

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// GET /api/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({ apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INPUT_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /api/generate — only runs batch when user requests report
router.post('/generate', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, projectId } = req.body as {
    startDate?: string;
    endDate?: string;
    reportType?: string;
    projectId?: string;
  };

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const validTypes = ['full', 'executive', 'resources', 'projects'];
  const type = validTypes.includes(reportType || '') ? reportType! : 'full';

  try {
    const result = await runGenerate({
      startDate,
      endDate,
      reportType: type as 'full' | 'executive' | 'resources' | 'projects',
      projectId,
      inputDir: INPUT_DIR,
      outputDir: OUTPUT_DIR,
      configDir: CONFIG_DIR,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    if (!result.ok) {
      return res.status(result.paths.dashboard ? 207 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/dashboard
router.get('/dashboard', (_req: Request, res: Response) => {
  const file = path.join(OUTPUT_DIR, 'dashboard-data.json');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'No dashboard generated yet. Click Generate Report.' });
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

// POST /api/upload — store only, no parsing
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

// GET /api/mappings
router.get('/mappings', (_req: Request, res: Response) => {
  res.json(listMappings(CONFIG_DIR));
});

// POST /api/mappings
router.post('/mappings', (req: Request, res: Response) => {
  const { pattern, mapping, weekYear, weekNumber } = req.body as {
    pattern: string;
    mapping: Record<string, string>;
    weekYear?: number;
    weekNumber?: number;
  };
  if (!pattern || !mapping) return res.status(400).json({ error: 'pattern and mapping required' });
  saveMapping(CONFIG_DIR, pattern, mapping, weekYear, weekNumber);
  res.json({ ok: true });
});

export default router;
