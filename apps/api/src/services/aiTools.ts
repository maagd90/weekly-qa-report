import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { getDb } from '../db/schema';
import { buildWeeklyLogFilter, buildProjectStatusFilter, weeksOverlappingRange } from './dateHelpers';

export interface ToolInput {
  startDate?: string;
  endDate?: string;
  year?: number;
  weekNumber?: number;
  projectId?: string;
  metric?: string;
}

/**
 * Execute a named tool call from Claude and return real data from SQLite.
 * This is the zero-hallucination layer: Claude can ONLY see data returned here.
 */
export function executeTool(name: string, input: ToolInput): unknown {
  const db = getDb();
  const { startDate, endDate, year, weekNumber, projectId } = input;

  switch (name) {
    case 'get_resource_summary': {
      const { clause, params } = buildWeeklyLogFilter(year, weekNumber, startDate, endDate);
      const row = db.prepare(`
        SELECT
          SUM(tc_planned)  AS testsPlanned,
          SUM(tc_executed) AS testsExecuted,
          SUM(tc_passed)   AS testsPassed,
          SUM(tc_failed)   AS testsFailed,
          SUM(bugs_reported) AS bugsReported,
          SUM(bugs_closed)   AS bugsClosed,
          SUM(hours_spent)   AS totalHours,
          COUNT(DISTINCT resource_id) AS activeResources,
          COUNT(DISTINCT cr_id) AS activeCRs
        FROM weekly_log wl WHERE ${clause}
      `).get(...params);
      return row;
    }

    case 'get_resource_breakdown': {
      const { clause, params } = buildWeeklyLogFilter(year, weekNumber, startDate, endDate);
      const base = projectId
        ? `FROM weekly_log wl JOIN crs c ON wl.cr_id = c.cr_id LEFT JOIN resources r ON wl.resource_id = r.resource_id WHERE ${clause} AND c.project_id = ?`
        : `FROM weekly_log wl LEFT JOIN resources r ON wl.resource_id = r.resource_id WHERE ${clause}`;
      const extraParams = projectId ? [...params, projectId] : params;
      return db.prepare(`
        SELECT
          r.resource_name, r.team, r.role,
          SUM(wl.tc_executed) AS testsExecuted,
          SUM(wl.tc_passed)   AS testsPassed,
          SUM(wl.tc_failed)   AS testsFailed,
          SUM(wl.bugs_reported) AS bugsReported,
          SUM(wl.bugs_closed)   AS bugsClosed,
          SUM(wl.hours_spent)   AS hoursSpent,
          GROUP_CONCAT(DISTINCT wl.cr_id) AS assignedCRs
        ${base}
        GROUP BY wl.resource_id
        ORDER BY testsExecuted DESC
      `).all(...extraParams);
    }

    case 'get_project_status': {
      const { clause, params } = buildProjectStatusFilter(year, weekNumber, startDate, endDate);
      const pidFilter = projectId ? ` AND psw.project_id = ?` : '';
      const extraParams = projectId ? [...params, projectId] : params;
      return db.prepare(`
        SELECT
          p.project_name,
          psw.project_id,
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
          psw.year,
          psw.week_number
        FROM project_status_weekly psw
        LEFT JOIN projects p ON psw.project_id = p.project_id
        WHERE ${clause}${pidFilter}
        ORDER BY p.project_name, psw.week_number
      `).all(...extraParams);
    }

    case 'get_cr_assignments': {
      const { clause, params } = buildWeeklyLogFilter(year, weekNumber, startDate, endDate);
      const pidFilter = projectId ? ` AND c.project_id = ?` : '';
      const extraParams = projectId ? [...params, projectId] : params;
      return db.prepare(`
        SELECT
          r.resource_name,
          wl.cr_id,
          c.cr_title,
          c.priority,
          c.status AS cr_status,
          p.project_name,
          SUM(wl.tc_executed) AS testsExecuted,
          SUM(wl.bugs_reported) AS bugsReported,
          SUM(wl.hours_spent)   AS hoursSpent
        FROM weekly_log wl
        LEFT JOIN resources r ON wl.resource_id = r.resource_id
        LEFT JOIN crs c ON wl.cr_id = c.cr_id
        LEFT JOIN projects p ON c.project_id = p.project_id
        WHERE ${clause}${pidFilter}
        GROUP BY wl.resource_id, wl.cr_id
        ORDER BY r.resource_name, wl.cr_id
      `).all(...extraParams);
    }

    case 'get_bug_trend': {
      const overlap = startDate && endDate ? weeksOverlappingRange(startDate, endDate) : null;
      const yearFilter = overlap ? overlap.year : (year || new Date().getFullYear());
      return db.prepare(`
        SELECT
          psw.year, psw.week_number,
          SUM(psw.bugs_reported) AS bugsReported,
          SUM(psw.bugs_closed)   AS bugsClosed,
          SUM(psw.bugs_open)     AS bugsOpen
        FROM project_status_weekly psw
        WHERE psw.year = ?
        GROUP BY psw.week_number
        ORDER BY psw.week_number ASC
      `).all(yearFilter);
    }

    case 'get_test_execution_trend': {
      const yearFilter = year || new Date().getFullYear();
      return db.prepare(`
        SELECT
          week_number,
          SUM(tc_executed) AS testsExecuted,
          SUM(tc_passed)   AS testsPassed,
          SUM(tc_failed)   AS testsFailed
        FROM weekly_log
        WHERE year = ?
        GROUP BY week_number
        ORDER BY week_number ASC
      `).all(yearFilter);
    }

    case 'get_top_performers': {
      const { clause, params } = buildWeeklyLogFilter(year, weekNumber, startDate, endDate);
      const metric = input.metric === 'bugs' ? 'SUM(wl.bugs_closed)' : 'SUM(wl.tc_executed)';
      return db.prepare(`
        SELECT
          r.resource_name,
          r.team,
          SUM(wl.tc_executed)    AS testsExecuted,
          SUM(wl.bugs_reported)  AS bugsReported,
          SUM(wl.bugs_closed)    AS bugsClosed,
          SUM(wl.hours_spent)    AS hoursSpent
        FROM weekly_log wl
        LEFT JOIN resources r ON wl.resource_id = r.resource_id
        WHERE ${clause}
        GROUP BY wl.resource_id
        ORDER BY ${metric} DESC
        LIMIT 10
      `).all(...params);
    }

    case 'get_risk_summary': {
      const { clause, params } = buildProjectStatusFilter(year, weekNumber, startDate, endDate);
      const pidFilter = projectId ? ` AND psw.project_id = ?` : '';
      const extraParams = projectId ? [...params, projectId] : params;
      return db.prepare(`
        SELECT
          p.project_name,
          psw.project_id,
          psw.status,
          psw.percent_complete,
          psw.risks,
          psw.blockers,
          psw.week_number,
          psw.year
        FROM project_status_weekly psw
        LEFT JOIN projects p ON psw.project_id = p.project_id
        WHERE ${clause}${pidFilter}
          AND (psw.risks != '' OR psw.blockers != '')
        ORDER BY psw.week_number DESC
      `).all(...extraParams);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * The tool definitions sent to Claude. These describe what each tool does
 * and what parameters it accepts. Claude reads these to decide which to call.
 */
export const AI_TOOLS: Tool[] = [
  {
    name: 'get_resource_summary',
    description: 'Get aggregate totals for all resources in the period: tests planned/executed/passed/failed, bugs reported/closed, total hours, active resource count, active CR count. Call this first for the Executive Summary section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
        year:       { type: 'number', description: 'Year (alternative to date range)' },
        weekNumber: { type: 'number', description: 'ISO week number (use with year)' },
      },
    },
  },
  {
    name: 'get_resource_breakdown',
    description: 'Get per-resource metrics: each person\'s tests executed/passed/failed, bugs reported/closed, hours spent, and which CRs they were assigned to. Use for the Resource Performance section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
        weekNumber: { type: 'number' },
        projectId:  { type: 'string', description: 'Optional: filter to one project' },
      },
    },
  },
  {
    name: 'get_project_status',
    description: 'Get the weekly status report for each project: name, status (On Track/At Risk/Delayed/Completed), % complete, tests, bugs open/reported/closed, resources assigned, key accomplishments, risks, blockers, next week plan. Use for the Project Health section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
        weekNumber: { type: 'number' },
        projectId:  { type: 'string', description: 'Optional: filter to one project' },
      },
    },
  },
  {
    name: 'get_cr_assignments',
    description: 'Get which resource is working on which Change Request (CR), including CR title, priority, status, project, tests executed, bugs reported, hours spent. Use for the CR Assignment section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
        weekNumber: { type: 'number' },
        projectId:  { type: 'string' },
      },
    },
  },
  {
    name: 'get_bug_trend',
    description: 'Get weekly bug trend data for the year: bugs reported, closed, and open count per week. Use for the Bug Analysis trend section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
      },
    },
  },
  {
    name: 'get_test_execution_trend',
    description: 'Get weekly test execution trend data: tests executed, passed, failed per week across the year. Use for trend analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
      },
    },
  },
  {
    name: 'get_top_performers',
    description: 'Get the top performing resources ranked by tests executed or bugs closed. Use for highlighting achievements.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
        weekNumber: { type: 'number' },
        metric: { type: 'string', enum: ['tests', 'bugs'], description: 'Rank by tests executed or bugs closed' },
      },
    },
  },
  {
    name: 'get_risk_summary',
    description: 'Get all projects that have non-empty risks or blockers in the period, with the full text of risks and blockers. Use for the Risks & Blockers section and Recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string' },
        endDate:   { type: 'string' },
        year:       { type: 'number' },
        weekNumber: { type: 'number' },
        projectId:  { type: 'string' },
      },
    },
  },
];
