import path from 'path';
import type { UatRow, FileMeta } from '../types/dataset';
import { excelSerialToIso, findHeaderRow, rowToObject, sanitizeText } from '../utils/excel';
import { readWorkbookRows } from '../utils/readWorkbook';

const ODL_HEADERS = ['TicketID', 'odlPriorityDescription', 'Status'];
const SCAN = 8;
const CLOSED = ['closed'];

export function isOdlFile(rows: unknown[][]): boolean {
  return findHeaderRow(rows, ODL_HEADERS, SCAN) >= 0;
}

function mapOdlStatus(status: string): { status: string; open: boolean } {
  const s = sanitizeText(status);
  const open = !CLOSED.some((c) => c.toLowerCase() === s.toLowerCase());
  return { status: s, open };
}

export function parseOdlFromRows(
  rows: unknown[][],
  fileName: string,
  warnings: string[] = [],
): { uat: UatRow[]; file: FileMeta } {
  const headerIdx = findHeaderRow(rows, ODL_HEADERS, SCAN);
  if (headerIdx < 0) throw new Error('ODL headers not found');

  const headers = (rows[headerIdx] as unknown[]).map((h) => sanitizeText(h));
  const uat: UatRow[] = [];
  let rowsWithoutAnyDate = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || !sanitizeText(row[headers.indexOf('TicketID')])) continue;
    const obj = rowToObject(headers, row);
    const id = sanitizeText(obj['TicketID']);
    if (!id) continue;

    const submittedDate = excelSerialToIso(obj['Submittedon']);
    const updatedDate = excelSerialToIso(obj['LastUpdate']);
    // Production exports sometimes omit Submittedon while still supplying a
    // valid LastUpdate. Use that real activity date instead of dropping the
    // row and flooding the UI with one warning per ticket.
    const submittedAt = submittedDate || updatedDate;
    if (!submittedAt) {
      rowsWithoutAnyDate += 1;
      continue;
    }
    const { status, open } = mapOdlStatus(sanitizeText(obj['Status']));
    const cr = sanitizeText(obj['Change Request']) || 'N/A';
    const project = 'DLM';

    uat.push({
      id,
      subject: sanitizeText(obj['Subject']),
      area: sanitizeText(obj['ProductArea']),
      cr,
      priority: sanitizeText(obj['odlPriorityDescription']) || 'Unassigned',
      clientPriority: sanitizeText(obj['Client_Priority']),
      submitter: sanitizeText(obj['Submittedby']),
      submittedAt,
      updatedAt: updatedDate || submittedAt,
      status,
      open,
      project,
      source: 'odl-file',
      sourceFile: fileName,
    });
  }

  if (rowsWithoutAnyDate > 0) {
    warnings.push(`[technical] ${fileName}: ${rowsWithoutAnyDate} Vendor Portal row${rowsWithoutAnyDate === 1 ? '' : 's'} skipped because both Submittedon and LastUpdate were empty.`);
  }

  return {
    uat,
    file: {
      name: fileName,
      ext: 'XLSX',
      project: uat[0]?.project || 'DLM',
      rows: uat.length,
      status: 'parsed',
      detectedType: 'odl',
      source: 'file',
    },
  };
}

export function parseOdl(filePath: string, warnings: string[] = []): { uat: UatRow[]; file: FileMeta } {
  const { rows } = readWorkbookRows(filePath);
  return parseOdlFromRows(rows, path.basename(filePath), warnings);
}
