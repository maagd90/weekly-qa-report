import { Router } from 'express';
import { getDb } from '../db/schema';

const router = Router();

router.get('/years', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT year FROM (
      SELECT year FROM weekly_log
      UNION
      SELECT year FROM project_status_weekly
    ) ORDER BY year DESC
  `).all() as { year: number }[];
  res.json(rows.map((r) => r.year));
});

router.get('/weeks', (req, res) => {
  const db = getDb();
  const year = Number(req.query.year);
  if (!year) return res.status(400).json({ error: 'year required' });
  const rows = db.prepare(`
    SELECT week_number,
      MAX(week_start) AS week_start,
      MAX(week_end)   AS week_end
    FROM (
      SELECT week_number, week_start, week_end FROM weekly_log WHERE year = ?
      UNION ALL
      SELECT week_number, NULL AS week_start, NULL AS week_end FROM project_status_weekly WHERE year = ?
    )
    GROUP BY week_number
    ORDER BY week_number ASC
  `).all(year, year) as { week_number: number; week_start: string | null; week_end: string | null }[];
  res.json(rows);
});

router.get('/projects', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT project_id, project_name, overall_status, active FROM projects ORDER BY project_name`).all();
  res.json(rows);
});

router.get('/resources', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT resource_id, resource_name, team, role, active FROM resources ORDER BY resource_name`).all();
  res.json(rows);
});

// Returns the min/max week_start dates in the DB for initializing the date-range picker
router.get('/date-range', (_req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT MIN(week_start) AS minDate, MAX(week_end) AS maxDate
    FROM weekly_log
    WHERE week_start IS NOT NULL AND week_end IS NOT NULL
  `).get() as { minDate: string | null; maxDate: string | null };
  res.json(row);
});

export default router;
