import * as XLSX from 'xlsx';
import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { str, num, clamp100 } from '../utils/helpers';

function readSheet(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function hasTemplateSheets(wb: XLSX.WorkBook): boolean {
  return !!wb.Sheets['Weekly_Log'] || !!wb.Sheets['Resources'];
}

export function parseExcelBuffer(buffer: Buffer, sourceFile: string): Dataset {
  const ds = emptyDataset();
  ds.meta.sourceFiles = [sourceFile];
  ds.meta.formats.push('xlsx-template');

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (e) {
    ds.meta.warnings.push(`Cannot read Excel: ${(e as Error).message}`);
    return ds;
  }

  if (!hasTemplateSheets(wb)) {
    ds.meta.formats = ['xlsx-foreign'];
    ds.meta.warnings.push(`${sourceFile}: no template sheets — use JIRA mapping or CSV export`);
    return ds;
  }

  for (const row of readSheet(wb, 'Resources')) {
    const id = str(row['ResourceID']);
    const name = str(row['ResourceName']);
    if (!id || !name) continue;
    ds.resources.push({ resource_id: id, resource_name: name, team: str(row['Team']), role: str(row['Role']), active: str(row['Active']) || 'Yes' });
  }

  for (const row of readSheet(wb, 'Projects')) {
    const id = str(row['ProjectID']);
    const name = str(row['ProjectName']);
    if (!id || !name) continue;
    ds.projects.push({ project_id: id, project_name: name, project_manager: str(row['ProjectManager']), start_date: str(row['StartDate']), target_end_date: str(row['TargetEndDate']), overall_status: str(row['OverallStatus']), active: str(row['Active']) || 'Yes' });
  }

  for (const row of readSheet(wb, 'CRs')) {
    const id = str(row['CR_ID']);
    const title = str(row['CR_Title']);
    if (!id || !title) continue;
    ds.crs.push({ cr_id: id, project_id: str(row['ProjectID']), cr_title: title, priority: str(row['Priority']), status: str(row['Status']), owner: str(row['Owner']) });
  }

  for (const row of readSheet(wb, 'Weekly_Log')) {
    const year = num(row['Year']);
    const week = num(row['WeekNumber']);
    const resourceId = str(row['ResourceID']);
    const crId = str(row['CR_ID']);
    if (!year || !week || !resourceId || !crId) continue;
    ds.weeklyLog.push({
      year, week_number: week,
      week_start: str(row['WeekStart']), week_end: str(row['WeekEnd']),
      resource_id: resourceId, cr_id: crId,
      tc_planned: num(row['TestCasesPlanned']), tc_executed: num(row['TestCasesExecuted']),
      tc_passed: num(row['TestCasesPassed']), tc_failed: num(row['TestCasesFailed']),
      bugs_reported: num(row['BugsReported']), bugs_closed: num(row['BugsClosed']),
      hours_spent: num(row['HoursSpent']), notes: str(row['Notes']),
    });
  }

  for (const row of readSheet(wb, 'Project_Status_Weekly')) {
    const year = num(row['Year']);
    const week = num(row['WeekNumber']);
    const projectId = str(row['ProjectID']);
    const status = str(row['Status']);
    if (!year || !week || !projectId || !status) continue;
    ds.projectStatusWeekly.push({
      year, week_number: week, project_id: projectId, status,
      percent_complete: clamp100(row['PercentComplete']),
      tests_executed: num(row['TestsExecuted']), bugs_open: num(row['BugsOpen']),
      bugs_reported: num(row['BugsReported']), bugs_closed: num(row['BugsClosed']),
      resources_assigned: num(row['ResourcesAssigned']),
      key_accomplishments: str(row['KeyAccomplishments']), risks: str(row['Risks']),
      blockers: str(row['Blockers']), next_week_plan: str(row['NextWeekPlan']),
      reported_by: str(row['ReportedBy']),
    });
  }

  return ds;
}

export function parseExcelFile(filePath: string): Dataset {
  const fs = require('fs') as typeof import('fs');
  return parseExcelBuffer(fs.readFileSync(filePath), filePath);
}

/** Read first sheet as row objects (for CSV-like Excel or foreign formats) */
export function readFirstSheetRows(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
