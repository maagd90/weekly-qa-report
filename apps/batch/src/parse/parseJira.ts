import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import type { IssueRow, FileMeta } from '../types/dataset';
import {
  excelSerialToIso, findHeaderRow, rowToObject, mapJiraStatus,
  projectFromKey, sanitizeText,
} from '../utils/excel';
import { deriveArea } from '../utils/deriveArea';

const JIRA_HEADERS = ['Key', 'Issue Type', 'Summary'];
const DONE = ['Done', 'CLOSED', 'Cancel', 'Closed'];

export function isJiraExport(rows: unknown[][]): boolean {
  return findHeaderRow(rows, JIRA_HEADERS) >= 0;
}

function mapIssueType(raw: unknown): 'Story' | 'Bug' | null {
  const t = sanitizeText(raw);
  if (t === 'Story') return 'Story';
  if (t === 'Bug') return 'Bug';
  return null;
}

export function parseJira(filePath: string): { issues: IssueRow[]; file: FileMeta } {
  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n === 'general_report') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows as unknown[][], JIRA_HEADERS);
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

    const summary = sanitizeText(obj['Summary']);
    const createdAt = excelSerialToIso(obj['Created']) || '1970-01-01';
    const updatedAt = excelSerialToIso(obj['Updated']) || createdAt;
    const resolvedAt = excelSerialToIso(obj['Resolved']);

    issues.push({
      project: projectFromKey(key),
      key,
      area: deriveArea(summary),
      issueType,
      status: mapJiraStatus(sanitizeText(obj['Status']), DONE),
      priority: sanitizeText(obj['Priority']) || 'Medium',
      assignee: sanitizeText(obj['Assignee']) || 'Unassigned',
      createdAt,
      resolvedAt,
      updatedAt,
      source: 'jira-file',
    });
  }

  const name = path.basename(filePath);
  return {
    issues,
    file: {
      name,
      ext: 'XLSX',
      project: issues[0]?.project || 'DLM',
      rows: issues.length,
      status: 'parsed',
      detectedType: 'jira',
      source: 'file',
    },
  };
}
