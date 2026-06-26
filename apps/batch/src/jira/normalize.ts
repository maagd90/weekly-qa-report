import type { Dataset, WeeklyLogRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { str, num } from '../utils/helpers';
import { isoWeekToDates } from '../filters/dateFilters';

export function normalizeJiraRows(
  rows: Record<string, unknown>[],
  sourceFile: string,
  weekYear?: number,
  weekNumber?: number
): Dataset {
  const ds = emptyDataset();
  ds.meta.sourceFiles = [sourceFile];
  ds.meta.formats.push('jira-normalized');

  const year = weekYear || new Date().getFullYear();
  const week = weekNumber || getIsoWeek(new Date());
  const { weekStart, weekEnd } = isoWeekToDates(year, week);

  const resourceSet = new Set<string>();
  const crSet = new Map<string, { title: string; assignee: string; status: string; priority: string }>();

  for (const row of rows) {
    const crId = str(row['CR_ID'] || row['Issue key'] || row['Key']);
    const assignee = str(row['ResourceID'] || row['Assignee']);
    const title = str(row['CR_Title'] || row['Summary']);
    if (!crId) continue;

    if (assignee && !resourceSet.has(assignee)) {
      resourceSet.add(assignee);
      ds.resources.push({
        resource_id: assignee,
        resource_name: assignee,
        team: '',
        role: 'QA',
        active: 'Yes',
      });
    }

    if (!crSet.has(crId)) {
      crSet.set(crId, { title, assignee, status: str(row['Status']), priority: str(row['Priority']) });
      ds.crs.push({
        cr_id: crId,
        project_id: str(row['ProjectID']) || 'JIRA',
        cr_title: title || crId,
        priority: str(row['Priority']),
        status: str(row['Status']),
        owner: assignee,
      });
    }

    if (assignee) {
      const log: WeeklyLogRow = {
        year,
        week_number: week,
        week_start: str(row['WeekStart']) || weekStart,
        week_end: str(row['WeekEnd']) || weekEnd,
        resource_id: assignee,
        cr_id: crId,
        tc_planned: 0,
        tc_executed: num(row['TestCasesExecuted']),
        tc_passed: 0,
        tc_failed: 0,
        bugs_reported: str(row['Status']).toLowerCase().includes('bug') ? 1 : 0,
        bugs_closed: 0,
        hours_spent: num(row['Hours_Spent']),
        notes: title,
      };
      ds.weeklyLog.push(log);
    }
  }

  if (!ds.projects.length && ds.crs.length) {
    ds.projects.push({
      project_id: 'JIRA',
      project_name: 'JIRA Export',
      project_manager: '',
      start_date: '',
      target_end_date: '',
      overall_status: 'On Track',
      active: 'Yes',
    });
  }

  return ds;
}

function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function normalizeWeeklyLogRows(rows: Record<string, unknown>[], sourceFile: string): Dataset {
  const ds = emptyDataset();
  ds.meta.sourceFiles = [sourceFile];
  ds.meta.formats.push('weekly-log-mapped');

  for (const row of rows) {
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
      hours_spent: num(row['Hours_Spent']), notes: str(row['Notes']),
    });
  }
  return ds;
}
