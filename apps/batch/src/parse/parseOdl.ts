import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import type { UatRow, FileMeta } from '../types/dataset';
import { excelSerialToIso, findHeaderRow, rowToObject, sanitizeText } from '../utils/excel';

const ODL_HEADERS = ['TicketID', 'odlPriorityDescription', 'Status'];

const CLOSED = ['closed'];

export function isOdlFile(rows: unknown[][]): boolean {
  return findHeaderRow(rows, ODL_HEADERS) >= 0;
}

function mapOdlStatus(status: string): { status: string; open: boolean } {
  const s = sanitizeText(status);
  const open = !CLOSED.some((c) => c.toLowerCase() === s.toLowerCase());
  return { status: s, open };
}

export function parseOdl(filePath: string): { uat: UatRow[]; file: FileMeta } {
  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows as unknown[][], ODL_HEADERS, 3);
  if (headerIdx < 0) throw new Error('ODL headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const uat: UatRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !sanitizeText(row[headers.indexOf('TicketID')])) continue;
    const obj = rowToObject(headers, row);
    const id = sanitizeText(obj['TicketID']);
    if (!id) continue;

    const { status, open } = mapOdlStatus(sanitizeText(obj['Status']));
    const submittedAt = excelSerialToIso(obj['Submittedon']) || '1970-01-01';
    const updatedAt = excelSerialToIso(obj['LastUpdate']) || submittedAt;

    uat.push({
      id,
      subject: sanitizeText(obj['Subject']),
      area: sanitizeText(obj['ProductArea']),
      cr: sanitizeText(obj['Change Request']) || 'N/A',
      priority: sanitizeText(obj['odlPriorityDescription']) || 'Unassigned',
      clientPriority: sanitizeText(obj['Client_Priority']),
      submitter: sanitizeText(obj['Submittedby']),
      submittedAt,
      updatedAt,
      status,
      open,
      source: 'odl-file',
    });
  }

  const name = path.basename(filePath);
  return {
    uat,
    file: {
      name,
      ext: 'XLSX',
      project: 'DLM',
      rows: uat.length,
      status: 'parsed',
      detectedType: 'odl',
      source: 'file',
    },
  };
}
