import crypto from 'crypto';
import path from 'path';
import { readWorkbookRows } from '../utils/readWorkbook';
import { excelSerialToIso, sanitizeText } from '../utils/excel';
import { sniffFileType } from './dispatcher';

export type MappedColumnType = 'text' | 'number' | 'date' | 'boolean';

export interface MappedColumnDefinition {
  fieldKey: string;
  sourceHeader: string;
  label: string;
  type: MappedColumnType;
  visible: boolean;
  filterable: boolean;
  searchable: boolean;
  required?: boolean;
}

export interface MappedImportProfile {
  version: number;
  headerSignature: string;
  columns: MappedColumnDefinition[];
  uniqueKey: string;
  createdAt: string;
}

export interface WorkbookColumnInspection {
  fileName: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  headerSignature: string;
  detectedType: 'test-execution' | 'jira' | 'odl' | 'unknown';
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
}

export interface MappedImportRow {
  sourceRow: number;
  sourceRecordId: string;
  values: Record<string, string | number | boolean | null>;
}

export interface MappedImportParseResult {
  inspection: WorkbookColumnInspection;
  rows: MappedImportRow[];
  rejections: Array<{ rowNumber: number; reference: string; reason: string }>;
}

function nonEmptyRow(row: unknown[]): boolean {
  return row.some((cell) => cell !== '' && cell !== null && cell !== undefined);
}

function stableHeaderSignature(headers: string[]): string {
  return crypto
    .createHash('sha256')
    .update(headers.map((header) => header.trim().toLocaleLowerCase()).join('\u001f'))
    .digest('hex');
}

function findHeaderRow(rows: unknown[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const values = rows[index].map(sanitizeText).filter(Boolean);
    const unique = new Set(values.map((value) => value.toLocaleLowerCase()));
    const score = unique.size === values.length ? values.length : 0;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

function inspectedRows(filePath: string): { sheetName: string; rows: unknown[][]; headerRow: number; headers: string[] } {
  const { sheetName, rows } = readWorkbookRows(filePath, ['general_report', 'Jira', 'Data']);
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) throw new Error('No usable header row was found in the spreadsheet.');
  const headers = rows[headerRow].map(sanitizeText);
  const duplicate = headers.find((header, index) =>
    header && headers.findIndex((candidate) => candidate.toLocaleLowerCase() === header.toLocaleLowerCase()) !== index);
  if (duplicate) throw new Error(`The spreadsheet contains the duplicate header "${duplicate}". Rename duplicate columns before mapping.`);
  if (headers.filter(Boolean).length < 1) throw new Error('The spreadsheet header row is empty.');
  return { sheetName, rows, headerRow, headers };
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return sanitizeText(value);
}

export function inspectWorkbookColumns(filePath: string): WorkbookColumnInspection {
  const { sheetName, rows, headerRow, headers } = inspectedRows(filePath);
  const activeHeaders = headers.filter(Boolean);
  const dataRows = rows.slice(headerRow + 1).filter(nonEmptyRow);
  return {
    fileName: path.basename(filePath),
    sheetName,
    headerRow: headerRow + 1,
    headers: activeHeaders,
    headerSignature: stableHeaderSignature(activeHeaders),
    detectedType: sniffFileType(filePath),
    rowCount: dataRows.length,
    sampleRows: dataRows.slice(0, 5).map((row) => Object.fromEntries(
      headers.flatMap((header, index) => header ? [[header, displayCell(row[index])]] : []),
    )),
  };
}

function mappedValue(raw: unknown, type: MappedColumnType): string | number | boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'date') return excelSerialToIso(raw);
  if (type === 'number') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(value) ? value : null;
  }
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const value = sanitizeText(raw).toLocaleLowerCase();
    if (['true', 'yes', 'y', '1'].includes(value)) return true;
    if (['false', 'no', 'n', '0'].includes(value)) return false;
    return null;
  }
  return displayCell(raw);
}

export function parseMappedWorkbook(filePath: string, profile: MappedImportProfile): MappedImportParseResult {
  const inspection = inspectWorkbookColumns(filePath);
  if (inspection.headerSignature !== profile.headerSignature) {
    throw new Error('The file headers do not match the saved mapping profile. Inspect and map this schema before publishing it.');
  }
  const { rows, headerRow, headers } = inspectedRows(filePath);
  const headerLookup = new Map(headers.flatMap((header, index) => header ? [[header.toLocaleLowerCase(), index] as const] : []));
  const missingHeaders = profile.columns.filter((column) => !headerLookup.has(column.sourceHeader.toLocaleLowerCase()));
  if (missingHeaders.length) {
    throw new Error(`Mapped source columns are missing: ${missingHeaders.map((column) => column.sourceHeader).join(', ')}.`);
  }

  const parsed: MappedImportRow[] = [];
  const rejections: MappedImportParseResult['rejections'] = [];
  const seen = new Set<string>();
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!nonEmptyRow(row)) continue;
    const values: MappedImportRow['values'] = {};
    let invalidColumn: MappedColumnDefinition | undefined;
    for (const column of profile.columns) {
      const raw = row[headerLookup.get(column.sourceHeader.toLocaleLowerCase())!];
      const value = mappedValue(raw, column.type);
      values[column.fieldKey] = value;
      if (
        column.type !== 'text'
        && raw !== null
        && raw !== undefined
        && sanitizeText(raw) !== ''
        && value === null
      ) {
        invalidColumn = column;
      }
    }
    const identityValue = values[profile.uniqueKey];
    if (invalidColumn) {
      rejections.push({
        rowNumber: index + 1,
        reference: displayCell(identityValue) || 'N/A',
        reason: `${invalidColumn.label} is not a valid ${invalidColumn.type} value.`,
      });
      continue;
    }
    const requiredMissing = profile.columns.find((column) =>
      column.required && (values[column.fieldKey] === null || values[column.fieldKey] === ''));
    if (requiredMissing) {
      rejections.push({
        rowNumber: index + 1,
        reference: displayCell(identityValue) || 'N/A',
        reason: `${requiredMissing.label} is required.`,
      });
      continue;
    }
    if (identityValue === null || identityValue === '') {
      rejections.push({ rowNumber: index + 1, reference: 'N/A', reason: 'The configured unique record column is empty.' });
      continue;
    }
    const sourceRecordId = String(identityValue).trim();
    const normalizedIdentity = sourceRecordId.toLocaleLowerCase();
    if (seen.has(normalizedIdentity)) {
      rejections.push({ rowNumber: index + 1, reference: sourceRecordId, reason: 'Duplicate unique record value in this file.' });
      continue;
    }
    seen.add(normalizedIdentity);
    parsed.push({ sourceRow: index + 1, sourceRecordId, values });
  }
  return { inspection, rows: parsed, rejections };
}
