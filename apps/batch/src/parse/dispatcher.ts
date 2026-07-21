import fs from 'fs';
import path from 'path';
import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { readWorkbookRows } from '../utils/readWorkbook';
import { isExecutionExportFile, parseExecutionExportFromRows } from './parseExecutionExport';
import { isJiraExport, parseJiraFromRows } from './parseJira';
import { isOdlFile, parseOdlFromRows } from './parseOdl';
import { mergeDatasets } from '../merge/mergeDataset';
import { excelSerialToIso, sanitizeText } from '../utils/excel';
import { mapIssueType } from '../utils/jiraHelpers';

export type FileFormat = 'xlsx' | 'unknown';

export interface ImportFileInspection {
  fileName: string;
  sheetName: string;
  detectedType: 'test-execution' | 'jira' | 'odl' | 'unknown';
  rowsFound: number;
  importedRows: number;
  rejectedRows: number;
  rejections: ImportRowRejection[];
  warnings: string[];
  errors: string[];
}

export interface ImportRowRejection {
  rowNumber: number;
  reference: string;
  reason: string;
}

export interface InspectedImportFile {
  dataset: Dataset;
  inspection: ImportFileInspection;
}

const SHEET_PREFS: Record<string, string[]> = {
  odl: [],
  jira: ['general_report', 'Jira'],
  execution: ['Data'],
};

export function detectFormat(filename: string): FileFormat {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.xlsx' || ext === '.xls' ? 'xlsx' : 'unknown';
}

export function discoverInputFiles(inputDir: string): string[] {
  if (!fs.existsSync(inputDir)) return [];
  return fs.readdirSync(inputDir)
    .filter((f) => !f.startsWith('.') && f !== 'README.md')
    .map((f) => path.join(inputDir, f))
    .filter((p) => fs.statSync(p).isFile());
}

function routeParse(rows: unknown[][], fileName: string, warnings: string[]): Dataset {
  const ds = emptyDataset();
  if (isOdlFile(rows)) {
    const { uat, file } = parseOdlFromRows(rows, fileName, warnings);
    ds.uat = uat;
    ds.files.push(file);
    return ds;
  }
  if (isJiraExport(rows)) {
    const { issues, file } = parseJiraFromRows(rows, fileName, warnings);
    ds.issues = issues;
    ds.files.push(file);
    return ds;
  }
  if (isExecutionExportFile(rows)) {
    const { executions, file } = parseExecutionExportFromRows(rows, fileName);
    ds.executions = executions;
    ds.files.push(file);
    return ds;
  }
  warnings.push(`Unknown spreadsheet format: ${fileName}`);
  return ds;
}

function nonEmptyRow(row: unknown[]): boolean {
  return row.some((cell) => cell !== '' && cell !== null && cell !== undefined);
}

function detectedType(rows: unknown[][]): ImportFileInspection['detectedType'] {
  if (isOdlFile(rows)) return 'odl';
  if (isJiraExport(rows)) return 'jira';
  if (isExecutionExportFile(rows)) return 'test-execution';
  return 'unknown';
}

function headerIndex(rows: unknown[][], type: ImportFileInspection['detectedType']): number {
  const includes = (row: unknown[], required: string[]) => {
    const cells = row.map((cell) => String(cell ?? '').trim());
    return required.every((header) => cells.includes(header));
  };
  if (type === 'odl') return rows.findIndex((row) => includes(row, ['TicketID', 'odlPriorityDescription', 'Status']));
  if (type === 'test-execution') return rows.findIndex((row) => includes(row, ['Test Cycle Key', 'Testcase/Teststep Execution Result']));
  if (type === 'jira') {
    return rows.findIndex((row) => {
      const cells = row.map((cell) => String(cell ?? '').trim());
      return cells.includes('Summary') && (cells.includes('Key') || cells.includes('Issue key'));
    });
  }
  return -1;
}

function collectRejections(rows: unknown[][], type: ImportFileInspection['detectedType'], header: number): ImportRowRejection[] {
  const rejections: ImportRowRejection[] = [];
  const headers = header >= 0 ? rows[header].map((cell) => sanitizeText(cell)) : [];
  const value = (row: unknown[], name: string) => {
    const index = headers.indexOf(name);
    return index >= 0 ? row[index] : '';
  };
  const reject = (rowIndex: number, reference: unknown, reason: string) => {
    rejections.push({ rowNumber: rowIndex + 1, reference: sanitizeText(reference) || 'N/A', reason });
  };

  for (let index = header >= 0 ? header + 1 : 0; index < rows.length; index++) {
    const row = rows[index];
    if (!nonEmptyRow(row)) continue;
    if (type === 'test-execution') {
      const caseKey = value(row, 'Test Case Key');
      const cycleKey = value(row, 'Test Cycle Key');
      if (!sanitizeText(caseKey) && !sanitizeText(cycleKey)) reject(index, '', 'Both Test Case Key and Test Cycle Key are empty.');
      continue;
    }
    if (type === 'jira') {
      const key = value(row, headers.includes('Key') ? 'Key' : 'Issue key');
      if (!sanitizeText(key)) {
        reject(index, '', 'Issue key is empty.');
      } else if (!mapIssueType(value(row, 'Issue Type'))) {
        reject(index, key, 'Issue Type is missing or unsupported; expected Story or Bug.');
      } else if (!excelSerialToIso(value(row, 'Created'))) {
        reject(index, key, 'Created date is missing or invalid.');
      }
      continue;
    }
    if (type === 'odl') {
      const ticketId = value(row, 'TicketID');
      if (!sanitizeText(ticketId)) {
        reject(index, '', 'TicketID is empty.');
      } else if (!excelSerialToIso(value(row, 'Submittedon')) && !excelSerialToIso(value(row, 'LastUpdate'))) {
        reject(index, ticketId, 'Both Submittedon and LastUpdate are missing or invalid.');
      }
      continue;
    }
    const reference = row.find((cell) => sanitizeText(cell));
    reject(index, reference, 'Spreadsheet headers do not match a supported import type.');
  }
  return rejections;
}

/**
 * Reads and parses one spreadsheet while retaining reconciliation facts that
 * are normally lost after the rows are converted into the canonical dataset.
 */
export function inspectImportFile(filePath: string): InspectedImportFile {
  const fileName = path.basename(filePath);
  const dataset = emptyDataset();
  dataset.meta.sourceFiles.push(filePath);
  const base: ImportFileInspection = {
    fileName,
    sheetName: '',
    detectedType: 'unknown',
    rowsFound: 0,
    importedRows: 0,
    rejectedRows: 0,
    rejections: [],
    warnings: [],
    errors: [],
  };

  if (detectFormat(filePath) !== 'xlsx') {
    const message = `Unsupported format: ${fileName}`;
    dataset.meta.warnings.push(message);
    return { dataset, inspection: { ...base, warnings: [message], errors: [message] } };
  }

  try {
    const { sheetName, rows } = readWorkbookRows(filePath, [
      ...SHEET_PREFS.odl,
      ...SHEET_PREFS.jira,
      ...SHEET_PREFS.execution,
    ]);
    const type = detectedType(rows);
    const start = headerIndex(rows, type);
    const rowsFound = rows.slice(start >= 0 ? start + 1 : 0).filter(nonEmptyRow).length;
    const parsed = routeParse(rows, fileName, dataset.meta.warnings);
    dataset.executions = parsed.executions;
    dataset.issues = parsed.issues;
    dataset.uat = parsed.uat;
    dataset.files = parsed.files;
    const importedRows = dataset.executions.length + dataset.issues.length + dataset.uat.length;
    const rejections = collectRejections(rows, type, start);
    const rejectedRows = rejections.length;
    const errors = type === 'unknown' ? [`Unknown spreadsheet format: ${fileName}`] : [];
    return {
      dataset,
      inspection: {
        ...base,
        sheetName,
        detectedType: type,
        rowsFound,
        importedRows,
        rejectedRows,
        rejections,
        warnings: [...dataset.meta.warnings],
        errors,
      },
    };
  } catch (err) {
    const message = `Failed to parse ${fileName}: ${(err as Error).message}`;
    console.error(`[parse] ${message}`);
    dataset.meta.warnings.push(message);
    return { dataset, inspection: { ...base, warnings: [message], errors: [message] } };
  }
}

export function parseFile(filePath: string): Dataset {
  return inspectImportFile(filePath).dataset;
}

export function parseAllFiles(filePaths: string[]): Dataset {
  const parts = filePaths.map(parseFile);
  return mergeDatasets(parts);
}

export function sniffFileType(filePath: string): 'test-execution' | 'jira' | 'odl' | 'unknown' {
  try {
    const { rows } = readWorkbookRows(filePath, ['general_report', 'Jira', 'Data']);
    if (isOdlFile(rows)) return 'odl';
    if (isJiraExport(rows)) return 'jira';
    if (isExecutionExportFile(rows)) return 'test-execution';
  } catch (err) {
    console.error(`[sniff] ${path.basename(filePath)}:`, (err as Error).message);
  }
  return 'unknown';
}
