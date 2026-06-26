import * as XLSX from 'xlsx';
import { readFirstSheetRows } from './excelParser';

export function parseCsvBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return readFirstSheetRows(buffer);
}

export function parseCsvFile(filePath: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const fs = require('fs') as typeof import('fs');
  return parseCsvBuffer(fs.readFileSync(filePath));
}

export function parseTsvBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const text = buffer.toString('utf8');
  const wb = XLSX.read(text, { type: 'string', FS: '\t' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
