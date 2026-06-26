import { Router } from 'express';
import { getDb } from '../db/schema';
import { buildWeeklyLogFilter } from '../services/dateHelpers';

const router = Router();

function getFilters(q: Record<string, unknown>) {
  return {
    year: q.year ? Number(q.year) : undefined,
    week: q.week ? Number(q.week) : undefined,
    startDate: q.startDate as string | undefined,
    endDate: q.endDate as string | undefined,
  };
}

// KPI summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildWeeklyLogFilter(year, week, startDate, endDate);

  const row = db.prepare(`
    SELECT
      SUM(tc_executed) AS testsExecuted,
      SUM(tc_passed)   AS testsPassed,
      SUM(tc_failed)   AS testsFailed,
      SUM(bugs_reported) AS bugsReported,
      SUM(bugs_closed)   AS bugsClosed,
      COUNT(DISTINCT resource_id) AS activeResources
    FROM weekly_log wl
    WHERE ${clause}
  `).get(...params) as Record<string, number>;

  const bugsReported = row.bugsReported || 0;
  const bugsClosed   = row.bugsClosed   || 0;
  res.json({
    ...row,
    bugClosureRate: bugsReported > 0 ? Math.round((bugsClosed / bugsReported) * 100) : 0,
  });
});

// Resource × CR assignment matrix
router.get('/cr-assignments', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildWeeklyLogFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT
      wl.resource_id, r.resource_name, r.team,
      wl.cr_id, c.cr_title, c.project_id, p.project_name,
      SUM(wl.tc_executed) AS tc_executed,
      SUM(wl.tc_passed)   AS tc_passed,
      SUM(wl.tc_failed)   AS tc_failed,
      SUM(wl.bugs_reported) AS bugs_reported,
      SUM(wl.bugs_closed)   AS bugs_closed,
      SUM(wl.hours_spent)   AS hours_spent,
      GROUP_CONCAT(wl.notes, ' | ') AS notes
    FROM weekly_log wl
    LEFT JOIN resources r ON wl.resource_id = r.resource_id
    LEFT JOIN crs c ON wl.cr_id = c.cr_id
    LEFT JOIN projects p ON c.project_id = p.project_id
    WHERE ${clause}
    GROUP BY wl.resource_id, wl.cr_id
    ORDER BY r.resource_name, wl.cr_id
  `).all(...params);
  res.json(rows);
});

// Test execution by resource (bar chart)
router.get('/charts/execution-by-resource', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildWeeklyLogFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT
      wl.resource_id, r.resource_name,
      SUM(wl.tc_planned)  AS planned,
      SUM(wl.tc_executed) AS executed,
      SUM(wl.tc_passed)   AS passed,
      SUM(wl.tc_failed)   AS failed
    FROM weekly_log wl
    LEFT JOIN resources r ON wl.resource_id = r.resource_id
    WHERE ${clause}
    GROUP BY wl.resource_id
    ORDER BY executed DESC
  `).all(...params);
  res.json(rows);
});

// Bugs by resource (grouped bar chart)
router.get('/charts/bugs-by-resource', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildWeeklyLogFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT
      wl.resource_id, r.resource_name,
      SUM(wl.bugs_reported) AS reported,
      SUM(wl.bugs_closed)   AS closed
    FROM weekly_log wl
    LEFT JOIN resources r ON wl.resource_id = r.resource_id
    WHERE ${clause}
    GROUP BY wl.resource_id
    ORDER BY reported DESC
  `).all(...params);
  res.json(rows);
});

// Weekly trends for the year (line chart)
router.get('/charts/weekly-trends', (req, res) => {
  const db = getDb();
  const year = Number(req.query.year);
  if (!year) return res.status(400).json({ error: 'year required' });

  const rows = db.prepare(`
    SELECT
      week_number AS week,
      SUM(tc_executed)   AS testsExecuted,
      SUM(bugs_reported) AS bugsReported,
      SUM(bugs_closed)   AS bugsClosed,
      COUNT(DISTINCT resource_id) AS activeResources
    FROM weekly_log
    WHERE year = ?
    GROUP BY week_number
    ORDER BY week_number ASC
  `).all(year);
  res.json(rows);
});

export default router;
