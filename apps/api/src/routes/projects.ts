import { Router } from 'express';
import { getDb } from '../db/schema';
import { buildProjectStatusFilter, buildWeeklyLogFilter } from '../services/dateHelpers';

const router = Router();

function getFilters(q: Record<string, unknown>) {
  return {
    year: q.year ? Number(q.year) : undefined,
    week: q.week ? Number(q.week) : undefined,
    startDate: q.startDate as string | undefined,
    endDate:   q.endDate   as string | undefined,
  };
}

// Project KPI cards
router.get('/summary', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);

  const counts = db.prepare(`
    SELECT
      COUNT(DISTINCT project_id) AS totalProjects,
      SUM(CASE WHEN status = 'On Track'  THEN 1 ELSE 0 END) AS onTrack,
      SUM(CASE WHEN status = 'At Risk'   THEN 1 ELSE 0 END) AS atRisk,
      SUM(CASE WHEN status = 'Delayed'   THEN 1 ELSE 0 END) AS delayed,
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
      AVG(percent_complete) AS avgCompletion,
      SUM(bugs_open) AS totalBugsOpen
    FROM project_status_weekly psw
    WHERE ${clause}
  `).get(...params) as Record<string, number>;

  res.json(counts);
});

// Full project status table
router.get('/status-report', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT
      psw.project_id,
      p.project_name,
      p.project_manager,
      p.target_end_date,
      psw.year,
      psw.week_number,
      psw.status,
      psw.percent_complete,
      psw.tests_executed,
      psw.bugs_open,
      psw.bugs_reported,
      psw.bugs_closed,
      psw.resources_assigned,
      psw.key_accomplishments,
      psw.risks,
      psw.blockers,
      psw.next_week_plan,
      psw.reported_by,
      r.resource_name AS reporter_name
    FROM project_status_weekly psw
    LEFT JOIN projects p ON psw.project_id = p.project_id
    LEFT JOIN resources r ON psw.reported_by = r.resource_id
    WHERE ${clause}
    ORDER BY p.project_name, psw.week_number
  `).all(...params);
  res.json(rows);
});

// Expanded detail for a single project
router.get('/:projectId/detail', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { projectId } = req.params;

  let statusClause: string;
  let statusParams: (number | string)[];

  if (startDate && endDate) {
    const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);
    statusClause = `${clause} AND psw.project_id = ?`;
    statusParams = [...params, projectId];
  } else {
    statusClause = `psw.year = ? AND psw.week_number = ? AND psw.project_id = ?`;
    statusParams = [year!, week!, projectId];
  }

  const status = db.prepare(`
    SELECT psw.*, p.project_name, p.project_manager, p.start_date, p.target_end_date
    FROM project_status_weekly psw
    LEFT JOIN projects p ON psw.project_id = p.project_id
    WHERE ${statusClause}
    ORDER BY psw.week_number DESC LIMIT 1
  `).get(...statusParams);

  if (!status) return res.status(404).json({ error: 'No status report for this project/period' });

  // Use the week from the found status row to look up CRs/resources
  const s = status as Record<string, unknown>;
  const rowYear = s.year as number;
  const rowWeek = s.week_number as number;

  const crs = db.prepare(`
    SELECT DISTINCT c.cr_id, c.cr_title, c.priority, c.status
    FROM weekly_log wl
    JOIN crs c ON wl.cr_id = c.cr_id
    WHERE wl.year = ? AND wl.week_number = ? AND c.project_id = ?
  `).all(rowYear, rowWeek, projectId);

  const resources = db.prepare(`
    SELECT DISTINCT r.resource_id, r.resource_name, r.team, r.role,
      SUM(wl.tc_executed)    AS testsExecuted,
      SUM(wl.bugs_reported)  AS bugsReported,
      SUM(wl.hours_spent)    AS hoursSpent
    FROM weekly_log wl
    JOIN resources r ON wl.resource_id = r.resource_id
    JOIN crs c ON wl.cr_id = c.cr_id
    WHERE wl.year = ? AND wl.week_number = ? AND c.project_id = ?
    GROUP BY r.resource_id
  `).all(rowYear, rowWeek, projectId);

  const prevStatus = db.prepare(`
    SELECT status, percent_complete FROM project_status_weekly
    WHERE project_id = ? AND year = ? AND week_number < ?
    ORDER BY year DESC, week_number DESC LIMIT 1
  `).get(projectId, rowYear, rowWeek) as { status: string; percent_complete: number } | undefined;

  res.json({ status, crs, resources, prevStatus: prevStatus || null });
});

// Status distribution (donut chart)
router.get('/charts/status-distribution', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM project_status_weekly psw
    WHERE ${clause}
    GROUP BY status
  `).all(...params);
  res.json(rows);
});

// Completion % by project (bar chart)
router.get('/charts/completion-by-project', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT psw.project_id, p.project_name,
      MAX(psw.percent_complete) AS percent_complete,
      psw.status
    FROM project_status_weekly psw
    LEFT JOIN projects p ON psw.project_id = p.project_id
    WHERE ${clause}
    GROUP BY psw.project_id
    ORDER BY percent_complete DESC
  `).all(...params);
  res.json(rows);
});

// Bugs by project (grouped bar)
router.get('/charts/bugs-by-project', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildProjectStatusFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT psw.project_id, p.project_name,
      SUM(psw.bugs_reported) AS reported,
      SUM(psw.bugs_closed)   AS closed,
      MAX(psw.bugs_open)     AS open
    FROM project_status_weekly psw
    LEFT JOIN projects p ON psw.project_id = p.project_id
    WHERE ${clause}
    GROUP BY psw.project_id
    ORDER BY open DESC
  `).all(...params);
  res.json(rows);
});

// Completion trend (line chart)
router.get('/charts/completion-trends', (req, res) => {
  const db = getDb();
  const year = Number(req.query.year);
  const projectId = req.query.projectId as string | undefined;
  if (!year) return res.status(400).json({ error: 'year required' });

  let query = `
    SELECT psw.week_number AS week, psw.project_id, p.project_name,
      psw.percent_complete, psw.status
    FROM project_status_weekly psw
    LEFT JOIN projects p ON psw.project_id = p.project_id
    WHERE psw.year = ?
  `;
  const params: unknown[] = [year];
  if (projectId) { query += ' AND psw.project_id = ?'; params.push(projectId); }
  query += ' ORDER BY psw.project_id, psw.week_number';

  res.json(db.prepare(query).all(...params));
});

// Resources per project (stacked bar)
router.get('/charts/resources-by-project', (req, res) => {
  const db = getDb();
  const { year, week, startDate, endDate } = getFilters(req.query);
  const { clause, params } = buildWeeklyLogFilter(year, week, startDate, endDate);

  const rows = db.prepare(`
    SELECT c.project_id, p.project_name,
      COUNT(DISTINCT wl.resource_id) AS resourceCount
    FROM weekly_log wl
    JOIN crs c ON wl.cr_id = c.cr_id
    LEFT JOIN projects p ON c.project_id = p.project_id
    WHERE ${clause}
    GROUP BY c.project_id
    ORDER BY resourceCount DESC
  `).all(...params);
  res.json(rows);
});

export default router;
