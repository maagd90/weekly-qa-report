import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema';
import { getJenkinsConfig } from './settings';
import { pollJenkins } from '../services/jenkinsPoller';

const router = Router();

// GET /api/jenkins/jobs — all synced jobs with latest build summary
router.get('/jobs', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      j.job_name,
      j.display_name,
      j.url,
      j.last_synced,
      b.build_number    AS last_build_number,
      b.result          AS last_result,
      b.status          AS last_status,
      b.duration_ms     AS last_duration_ms,
      b.timestamp       AS last_timestamp,
      b.branch          AS last_branch,
      b.tests_total     AS last_tests_total,
      b.tests_passed    AS last_tests_passed,
      b.tests_failed    AS last_tests_failed
    FROM jenkins_jobs j
    LEFT JOIN jenkins_builds b ON b.job_name = j.job_name
      AND b.build_number = (
        SELECT MAX(build_number) FROM jenkins_builds WHERE job_name = j.job_name
      )
    ORDER BY j.display_name
  `).all();
  res.json(rows);
});

// GET /api/jenkins/builds — build history with optional filters
router.get('/builds', (req: Request, res: Response) => {
  const db = getDb();
  const { jobName, result, limit = '50' } = req.query as Record<string, string>;

  let query = `
    SELECT b.*, j.display_name
    FROM jenkins_builds b
    LEFT JOIN jenkins_jobs j ON b.job_name = j.job_name
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (jobName) { query += ' AND b.job_name = ?'; params.push(jobName); }
  if (result)  { query += ' AND b.result = ?';   params.push(result); }

  query += ' ORDER BY b.timestamp DESC LIMIT ?';
  params.push(Number(limit));

  res.json(db.prepare(query).all(...params));
});

// GET /api/jenkins/jobs/:jobName/builds — build history for one job
router.get('/jobs/:jobName/builds', (req: Request, res: Response) => {
  const db = getDb();
  const { jobName } = req.params;
  const limit = Number(req.query.limit) || 30;

  const rows = db.prepare(`
    SELECT * FROM jenkins_builds
    WHERE job_name = ?
    ORDER BY build_number DESC
    LIMIT ?
  `).all(jobName, limit);
  res.json(rows);
});

// GET /api/jenkins/summary — KPI aggregates across all jobs
router.get('/summary', (_req: Request, res: Response) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT job_name)                                       AS totalJobs,
      SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END)       AS runningBuilds,
      SUM(CASE WHEN result = 'SUCCESS' THEN 1 ELSE 0 END)           AS successBuilds,
      SUM(CASE WHEN result = 'FAILURE' THEN 1 ELSE 0 END)           AS failedBuilds,
      SUM(CASE WHEN result = 'UNSTABLE' THEN 1 ELSE 0 END)          AS unstableBuilds,
      SUM(tests_total)                                               AS totalTests,
      SUM(tests_failed)                                              AS totalTestsFailed,
      ROUND(AVG(CASE WHEN result='SUCCESS' THEN 100.0 ELSE 0 END),1) AS successRate
    FROM jenkins_builds
  `).get() as Record<string, number>;

  const recentFailures = db.prepare(`
    SELECT b.job_name, j.display_name, b.build_number, b.timestamp, b.branch
    FROM jenkins_builds b
    LEFT JOIN jenkins_jobs j ON b.job_name = j.job_name
    WHERE b.result = 'FAILURE'
    ORDER BY b.timestamp DESC
    LIMIT 5
  `).all();

  res.json({ ...totals, recentFailures });
});

// GET /api/jenkins/trends — build success rate and test counts over time
router.get('/trends', (req: Request, res: Response) => {
  const db = getDb();
  const { jobName, days = '30' } = req.query as Record<string, string>;
  const since = new Date(Date.now() - Number(days) * 24 * 3600 * 1000).toISOString();

  let query = `
    SELECT
      DATE(timestamp) AS date,
      COUNT(*) AS totalBuilds,
      SUM(CASE WHEN result = 'SUCCESS' THEN 1 ELSE 0 END) AS successBuilds,
      SUM(CASE WHEN result = 'FAILURE' THEN 1 ELSE 0 END) AS failedBuilds,
      SUM(tests_total)  AS testsTotal,
      SUM(tests_failed) AS testsFailed,
      ROUND(AVG(duration_ms) / 1000, 0) AS avgDurationSec
    FROM jenkins_builds
    WHERE timestamp >= ? AND status = 'FINISHED'
  `;
  const params: string[] = [since];
  if (jobName) { query += ' AND job_name = ?'; params.push(jobName); }
  query += ' GROUP BY DATE(timestamp) ORDER BY date ASC';

  res.json(db.prepare(query).all(...params));
});

// GET /api/jenkins/live — SSE stream of in-progress builds (polls every 15s)
router.get('/live', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendLive = () => {
    const db = getDb();
    const running = db.prepare(`
      SELECT b.*, j.display_name
      FROM jenkins_builds b
      LEFT JOIN jenkins_jobs j ON b.job_name = j.job_name
      WHERE b.status = 'IN_PROGRESS'
      ORDER BY b.timestamp DESC
    `).all();
    res.write(`data: ${JSON.stringify({ type: 'live', builds: running })}\n\n`);
  };

  sendLive();
  const interval = setInterval(sendLive, 15_000);
  req.on('close', () => clearInterval(interval));
});

// POST /api/jenkins/sync — manual sync trigger
router.post('/sync', async (_req: Request, res: Response) => {
  const cfg = getJenkinsConfig();
  if (!cfg) return res.status(400).json({ error: 'Jenkins not configured' });
  try {
    const result = await pollJenkins(cfg);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
