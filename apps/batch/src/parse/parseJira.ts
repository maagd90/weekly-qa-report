import path from 'path';
import type { IssueRow, FileMeta } from '../types/dataset';
import {
  excelSerialToIso, rowToObject, mapJiraStatus,
  projectFromKey, sanitizeText,
} from '../utils/excel';
import { readWorkbookRows } from '../utils/readWorkbook';
import { mapIssueType } from '../utils/jiraHelpers';
import { deriveArea } from '../utils/deriveArea';

const KEY_ALIASES = ['Key', 'Issue key'];
const JIRA_HEADERS = ['Summary'];
const DONE = ['Done', 'CLOSED', 'Cancel', 'Rejected'];

function firstText(obj: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = sanitizeText(obj[name]);
    if (value) return value;
  }
  return '';
}

function findJiraHeaderRow(rows: unknown[][], maxScan = 8): number {
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    const headers = (rows[i] as unknown[]).map((h) => sanitizeText(h));
    const hasKey = KEY_ALIASES.some((key) => headers.includes(key));
    if (hasKey && JIRA_HEADERS.every((h) => headers.includes(h))) return i;
  }
  return -1;
}

function resolveKeyHeader(headers: string[]): string | null {
  return KEY_ALIASES.find((key) => headers.includes(key)) || null;
}

export function isJiraExport(rows: unknown[][]): boolean {
  return findJiraHeaderRow(rows) >= 0;
}

export function parseJiraFromRows(
  rows: unknown[][],
  fileName: string,
  warnings: string[] = [],
): { issues: IssueRow[]; file: FileMeta } {
  const headerIdx = findJiraHeaderRow(rows);
  if (headerIdx < 0) throw new Error('JIRA headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const keyHeader = resolveKeyHeader(headers);
  const keyIndex = keyHeader ? headers.indexOf(keyHeader) : -1;
  if (!keyHeader || keyIndex < 0) throw new Error('JIRA key header not found');
  const issues: IssueRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !sanitizeText(row[keyIndex])) continue;
    const obj = rowToObject(headers, row);
    const key = sanitizeText(obj[keyHeader]);
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

    issues.push({
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
      sourceFile: fileName,
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
  const { rows } = readWorkbookRows(filePath, ['general_report', 'Jira']);
  return parseJiraFromRows(rows, path.basename(filePath), warnings);
}
