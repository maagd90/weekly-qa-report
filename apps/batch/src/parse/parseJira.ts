import path from 'path';
import type { IssueRow, FileMeta } from '../types/dataset';
import {
  excelSerialToIso, findHeaderRow, rowToObject, mapJiraStatus,
  projectFromKey, sanitizeText,
} from '../utils/excel';
import { readWorkbookRows } from '../utils/readWorkbook';
import { mapIssueType } from '../utils/jiraHelpers';
import { deriveArea } from '../utils/deriveArea';

const JIRA_HEADERS = ['Key', 'Issue Type', 'Summary'];
const DONE = ['Done', 'CLOSED', 'Cancel'];

function firstText(obj: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = sanitizeText(obj[name]);
    if (value) return value;
  }
  return '';
}

export function isJiraExport(rows: unknown[][]): boolean {
  return findHeaderRow(rows, JIRA_HEADERS) >= 0;
}

export function parseJiraFromRows(
  rows: unknown[][],
  fileName: string,
  warnings: string[] = [],
): { issues: IssueRow[]; file: FileMeta } {
  const headerIdx = findHeaderRow(rows, JIRA_HEADERS);
  if (headerIdx < 0) throw new Error('JIRA headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const issues: IssueRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !sanitizeText(row[headers.indexOf('Key')])) continue;
    const obj = rowToObject(headers, row);
    const key = sanitizeText(obj['Key']);
    const issueType = mapIssueType(obj['Issue Type']);
    if (!key || !issueType) continue;

    const createdAt = excelSerialToIso(obj['Created']);
    if (!createdAt) {
      warnings.push(`${key}: missing created date, skipped`);
      continue;
    }
    const summary = sanitizeText(obj['Summary']);
    const updatedAt = excelSerialToIso(obj['Updated']) || createdAt;
    const sprint = firstText(obj, ['Sprint', 'Sprint Name', 'Sprint No', 'Sprint Number', 'Sprint ID', 'Sprint Id']);

    (issues as any[]).push({
      project: projectFromKey(key),
      key,
      area: deriveArea(summary),
      issueType,
      status: mapJiraStatus(sanitizeText(obj['Status']), DONE),
      priority: sanitizeText(obj['Priority']) || 'Medium',
      assignee: sanitizeText(obj['Assignee']) || 'Unassigned',
      createdAt,
      resolvedAt: excelSerialToIso(obj['Resolved']),
      updatedAt,
      summary,
      sprint: sprint || 'Not mapped',
      source: 'jira-file',
    });
  }

  return {
    issues,
    file: {
      name: fileName,
      ext: 'XLSX',
      project: issues[0]?.project || 'DLM',
      rows: issues.length,
      status: 'parsed',
      detectedType: 'jira',
      source: 'file',
    },
  };
}

export function parseJira(filePath: string, warnings: string[] = []): { issues: IssueRow[]; file: FileMeta } {
  const { rows } = readWorkbookRows(filePath, ['general_report']);
  return parseJiraFromRows(rows, path.basename(filePath), warnings);
}
