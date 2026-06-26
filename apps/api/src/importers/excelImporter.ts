import * as XLSX from 'xlsx';
import { getDb } from '../db/schema';

interface ImportResult {
  importedAt: string;
  sourceFile: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errors: string[];
}

function readSheet(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function clamp100(v: unknown): number {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function importExcel(filePath: string): ImportResult {
  const result: ImportResult = {
    importedAt: new Date().toISOString(),
    sourceFile: filePath,
    rowsAdded: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    errors: [],
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(filePath, { cellDates: true });
  } catch (e) {
    result.errors.push(`Cannot read file: ${(e as Error).message}`);
    return result;
  }

  const db = getDb();

  const upsertResources = db.prepare(`
    INSERT INTO resources (resource_id, resource_name, team, role, active)
    VALUES (@resource_id, @resource_name, @team, @role, @active)
    ON CONFLICT(resource_id) DO UPDATE SET
      resource_name = excluded.resource_name,
      team = excluded.team,
      role = excluded.role,
      active = excluded.active
  `);

  const upsertProjects = db.prepare(`
    INSERT INTO projects (project_id, project_name, project_manager, start_date, target_end_date, overall_status, active)
    VALUES (@project_id, @project_name, @project_manager, @start_date, @target_end_date, @overall_status, @active)
    ON CONFLICT(project_id) DO UPDATE SET
      project_name = excluded.project_name,
      project_manager = excluded.project_manager,
      start_date = excluded.start_date,
      target_end_date = excluded.target_end_date,
      overall_status = excluded.overall_status,
      active = excluded.active
  `);

  const upsertCRs = db.prepare(`
    INSERT INTO crs (cr_id, project_id, cr_title, priority, status, owner)
    VALUES (@cr_id, @project_id, @cr_title, @priority, @status, @owner)
    ON CONFLICT(cr_id) DO UPDATE SET
      project_id = excluded.project_id,
      cr_title = excluded.cr_title,
      priority = excluded.priority,
      status = excluded.status,
      owner = excluded.owner
  `);

  const upsertLog = db.prepare(`
    INSERT INTO weekly_log (year, week_number, week_start, week_end, resource_id, cr_id,
      tc_planned, tc_executed, tc_passed, tc_failed, bugs_reported, bugs_closed, hours_spent, notes)
    VALUES (@year, @week_number, @week_start, @week_end, @resource_id, @cr_id,
      @tc_planned, @tc_executed, @tc_passed, @tc_failed, @bugs_reported, @bugs_closed, @hours_spent, @notes)
    ON CONFLICT(year, week_number, resource_id, cr_id) DO UPDATE SET
      week_start = excluded.week_start,
      week_end = excluded.week_end,
      tc_planned = excluded.tc_planned,
      tc_executed = excluded.tc_executed,
      tc_passed = excluded.tc_passed,
      tc_failed = excluded.tc_failed,
      bugs_reported = excluded.bugs_reported,
      bugs_closed = excluded.bugs_closed,
      hours_spent = excluded.hours_spent,
      notes = excluded.notes
  `);

  const upsertProjectStatus = db.prepare(`
    INSERT INTO project_status_weekly (year, week_number, project_id, status, percent_complete,
      tests_executed, bugs_open, bugs_reported, bugs_closed, resources_assigned,
      key_accomplishments, risks, blockers, next_week_plan, reported_by)
    VALUES (@year, @week_number, @project_id, @status, @percent_complete,
      @tests_executed, @bugs_open, @bugs_reported, @bugs_closed, @resources_assigned,
      @key_accomplishments, @risks, @blockers, @next_week_plan, @reported_by)
    ON CONFLICT(year, week_number, project_id) DO UPDATE SET
      status = excluded.status,
      percent_complete = excluded.percent_complete,
      tests_executed = excluded.tests_executed,
      bugs_open = excluded.bugs_open,
      bugs_reported = excluded.bugs_reported,
      bugs_closed = excluded.bugs_closed,
      resources_assigned = excluded.resources_assigned,
      key_accomplishments = excluded.key_accomplishments,
      risks = excluded.risks,
      blockers = excluded.blockers,
      next_week_plan = excluded.next_week_plan,
      reported_by = excluded.reported_by
  `);

  const runImport = db.transaction(() => {
    // Resources
    for (const row of readSheet(wb, 'Resources')) {
      const id = str(row['ResourceID']);
      const name = str(row['ResourceName']);
      if (!id || !name) { result.errors.push(`Resources: skipped row missing ResourceID or ResourceName`); result.rowsSkipped++; continue; }
      const existing = db.prepare('SELECT resource_id FROM resources WHERE resource_id = ?').get(id);
      upsertResources.run({ resource_id: id, resource_name: name, team: str(row['Team']), role: str(row['Role']), active: str(row['Active']) || 'Yes' });
      existing ? result.rowsUpdated++ : result.rowsAdded++;
    }

    // Projects
    for (const row of readSheet(wb, 'Projects')) {
      const id = str(row['ProjectID']);
      const name = str(row['ProjectName']);
      if (!id || !name) { result.errors.push(`Projects: skipped row missing ProjectID or ProjectName`); result.rowsSkipped++; continue; }
      const existing = db.prepare('SELECT project_id FROM projects WHERE project_id = ?').get(id);
      upsertProjects.run({ project_id: id, project_name: name, project_manager: str(row['ProjectManager']), start_date: str(row['StartDate']), target_end_date: str(row['TargetEndDate']), overall_status: str(row['OverallStatus']), active: str(row['Active']) || 'Yes' });
      existing ? result.rowsUpdated++ : result.rowsAdded++;
    }

    // CRs
    for (const row of readSheet(wb, 'CRs')) {
      const id = str(row['CR_ID']);
      const title = str(row['CR_Title']);
      if (!id || !title) { result.errors.push(`CRs: skipped row missing CR_ID or CR_Title`); result.rowsSkipped++; continue; }
      const existing = db.prepare('SELECT cr_id FROM crs WHERE cr_id = ?').get(id);
      upsertCRs.run({ cr_id: id, project_id: str(row['ProjectID']), cr_title: title, priority: str(row['Priority']), status: str(row['Status']), owner: str(row['Owner']) });
      existing ? result.rowsUpdated++ : result.rowsAdded++;
    }

    // Weekly_Log
    for (const [i, row] of readSheet(wb, 'Weekly_Log').entries()) {
      const year = num(row['Year']);
      const week = num(row['WeekNumber']);
      const resourceId = str(row['ResourceID']);
      const crId = str(row['CR_ID']);
      if (!year || !week || !resourceId || !crId) {
        result.errors.push(`Weekly_Log row ${i + 2}: missing Year, WeekNumber, ResourceID, or CR_ID`);
        result.rowsSkipped++; continue;
      }
      const existing = db.prepare('SELECT id FROM weekly_log WHERE year=? AND week_number=? AND resource_id=? AND cr_id=?').get(year, week, resourceId, crId);
      upsertLog.run({ year, week_number: week, week_start: str(row['WeekStart']), week_end: str(row['WeekEnd']), resource_id: resourceId, cr_id: crId, tc_planned: num(row['TestCasesPlanned']), tc_executed: num(row['TestCasesExecuted']), tc_passed: num(row['TestCasesPassed']), tc_failed: num(row['TestCasesFailed']), bugs_reported: num(row['BugsReported']), bugs_closed: num(row['BugsClosed']), hours_spent: num(row['HoursSpent']), notes: str(row['Notes']) });
      existing ? result.rowsUpdated++ : result.rowsAdded++;
    }

    // Project_Status_Weekly
    for (const [i, row] of readSheet(wb, 'Project_Status_Weekly').entries()) {
      const year = num(row['Year']);
      const week = num(row['WeekNumber']);
      const projectId = str(row['ProjectID']);
      const status = str(row['Status']);
      if (!year || !week || !projectId || !status) {
        result.errors.push(`Project_Status_Weekly row ${i + 2}: missing Year, WeekNumber, ProjectID, or Status`);
        result.rowsSkipped++; continue;
      }
      const pct = clamp100(row['PercentComplete']);
      const existing = db.prepare('SELECT id FROM project_status_weekly WHERE year=? AND week_number=? AND project_id=?').get(year, week, projectId);
      upsertProjectStatus.run({ year, week_number: week, project_id: projectId, status, percent_complete: pct, tests_executed: num(row['TestsExecuted']), bugs_open: num(row['BugsOpen']), bugs_reported: num(row['BugsReported']), bugs_closed: num(row['BugsClosed']), resources_assigned: num(row['ResourcesAssigned']), key_accomplishments: str(row['KeyAccomplishments']), risks: str(row['Risks']), blockers: str(row['Blockers']), next_week_plan: str(row['NextWeekPlan']), reported_by: str(row['ReportedBy']) });
      existing ? result.rowsUpdated++ : result.rowsAdded++;
    }
  });

  try {
    runImport();
  } catch (e) {
    result.errors.push(`Transaction error: ${(e as Error).message}`);
  }

  // Save import log
  db.prepare(`INSERT INTO import_log (imported_at, source_file, rows_added, rows_updated, rows_skipped, errors) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(result.importedAt, result.sourceFile, result.rowsAdded, result.rowsUpdated, result.rowsSkipped, JSON.stringify(result.errors));

  return result;
}
