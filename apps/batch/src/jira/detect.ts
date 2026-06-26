/** Known JIRA export column → internal template column */
export const JIRA_AUTO_MAP: Record<string, string> = {
  'Issue key': 'CR_ID',
  'Issue Key': 'CR_ID',
  'Key': 'CR_ID',
  Summary: 'CR_Title',
  Assignee: 'ResourceID',
  Reporter: 'ResourceID',
  Status: 'Status',
  Priority: 'Priority',
  Created: 'WeekStart',
  Resolved: 'WeekEnd',
  'Time Spent': 'Hours_Spent',
  'Story Points': 'TestCasesExecuted',
};

export const TEMPLATE_COLUMNS = [
  'ResourceID', 'ResourceName', 'Team', 'Role',
  'ProjectID', 'ProjectName', 'CR_ID', 'CR_Title',
  'Year', 'WeekNumber', 'WeekStart', 'WeekEnd',
  'TestCasesPlanned', 'TestCasesExecuted', 'TestCasesPassed', 'TestCasesFailed',
  'BugsReported', 'BugsClosed', 'Hours_Spent', 'Notes',
  'Status', 'Priority', 'PercentComplete', 'KeyAccomplishments', 'Risks', 'Blockers',
];

export function isJiraExport(headers: string[]): boolean {
  const normalized = headers.map((h) => h.trim());
  const jiraKeys = ['Issue key', 'Issue Key', 'Summary', 'Assignee'];
  return jiraKeys.some((k) => normalized.includes(k));
}

export function isTemplateHeaders(headers: string[]): boolean {
  const required = ['ResourceID', 'CR_ID', 'Year', 'WeekNumber'];
  const upper = headers.map((h) => h.trim());
  return required.every((r) => upper.includes(r));
}

export function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const target = JIRA_AUTO_MAP[h.trim()];
    if (target) mapping[h] = target;
  }
  return mapping;
}
