import { Router, Request, Response } from 'express';
import { generateReport, type ReportRequest } from '../services/aiReportService';
import { getDb } from '../db/schema';

const router = Router();

// POST /api/ai/report — generates a report via Claude tool-use, streams via SSE
router.post('/report', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, projectId } = req.body as Partial<ReportRequest>;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const validTypes = ['full', 'executive', 'resources', 'projects'];
  const type = validTypes.includes(reportType || '') ? reportType! : 'full';

  // Set SSE headers before writing anything
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  await generateReport({ startDate, endDate, reportType: type, projectId }, res);
});

// GET /api/ai/reports — list past reports
router.get('/reports', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, created_at, start_date, end_date, report_type, project_id,
      LENGTH(report_markdown) AS reportLength
    FROM ai_reports
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

// GET /api/ai/reports/:id — get a specific past report
router.get('/reports/:id', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM ai_reports WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Report not found' });
  const r = row as Record<string, unknown>;
  res.json({
    ...r,
    toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json as string) : [],
  });
});

export default router;
