import fs from 'fs';
import path from 'path';
import type { Dataset } from '../types/dataset';
import { parseExcelBuffer, readFirstSheetRows } from './excelParser';
import { parseCsvBuffer, parseTsvBuffer } from './csvParser';
import { parseJsonBuffer } from './jsonParser';
import { extractPdfRows, pdfRowsToObjects } from './pdfParser';
import { parseXmlBuffer } from './xmlParser';
import { isTemplateHeaders, isJiraExport, autoDetectMapping } from '../jira/detect';
import { loadMappingForFile, applyColumnMapping } from '../jira/mapping';
import { normalizeJiraRows, normalizeWeeklyLogRows } from '../jira/normalize';
import { emptyDataset } from '../types/dataset';
import { basename } from '../utils/helpers';

export type FileFormat = 'xlsx' | 'xls' | 'csv' | 'tsv' | 'json' | 'pdf' | 'xml' | 'unknown';

export function detectFormat(filename: string): FileFormat {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, FileFormat> = {
    '.xlsx': 'xlsx', '.xls': 'xls', '.csv': 'csv', '.tsv': 'tsv',
    '.json': 'json', '.pdf': 'pdf', '.xml': 'xml',
  };
  return map[ext] || 'unknown';
}

export interface ParseOptions {
  configDir: string;
  customMapping?: Record<string, string>;
  weekYear?: number;
  weekNumber?: number;
}

export async function parseFile(filePath: string, options: ParseOptions): Promise<Dataset> {
  const format = detectFormat(filePath);
  const buffer = fs.readFileSync(filePath);
  const name = basename(filePath);

  if (format === 'xlsx' || format === 'xls') {
    const templateTry = parseExcelBuffer(buffer, filePath);
    if (templateTry.weeklyLog.length > 0 || templateTry.resources.length > 0) {
      return templateTry;
    }
    const { headers, rows } = readFirstSheetRows(buffer);
    return rowsToDataset(headers, rows, filePath, options);
  }

  if (format === 'csv') {
    const { headers, rows } = parseCsvBuffer(buffer);
    return rowsToDataset(headers, rows, filePath, options);
  }

  if (format === 'tsv') {
    const { headers, rows } = parseTsvBuffer(buffer);
    return rowsToDataset(headers, rows, filePath, options);
  }

  if (format === 'json') {
    const result = parseJsonBuffer(buffer, filePath);
    if ('weeklyLog' in result) return result as Dataset;
    const { headers, rows } = result as { headers: string[]; rows: Record<string, unknown>[] };
    return rowsToDataset(headers, rows, filePath, options);
  }

  if (format === 'pdf') {
    const { headers, rows } = await extractPdfRows(filePath);
    const rowObjects = pdfRowsToObjects(headers, rows);
    return rowsToDataset(headers, rowObjects, filePath, options);
  }

  if (format === 'xml') {
    const { headers, rows } = parseXmlBuffer(buffer);
    return rowsToDataset(headers, rows, filePath, options);
  }

  const ds = emptyDataset();
  ds.meta.sourceFiles = [filePath];
  ds.meta.warnings.push(`Unsupported format: ${name}`);
  return ds;
}

function rowsToDataset(
  headers: string[],
  rows: Record<string, unknown>[],
  sourceFile: string,
  options: ParseOptions
): Dataset {
  if (isTemplateHeaders(headers)) {
    return normalizeWeeklyLogRows(rows, sourceFile);
  }

  let mapping = options.customMapping;
  if (!mapping) {
    const saved = loadMappingForFile(options.configDir, sourceFile);
    mapping = saved?.mapping || autoDetectMapping(headers);
  }

  const mapped = applyColumnMapping(rows, mapping);
  if (isJiraExport(headers) || Object.keys(mapping).length > 0) {
    return normalizeJiraRows(mapped, sourceFile, options.weekYear, options.weekNumber);
  }

  const ds = emptyDataset();
  ds.meta.sourceFiles = [sourceFile];
  ds.meta.warnings.push(`${basename(sourceFile)}: unknown columns — configure mapping in config/mappings/`);
  return ds;
}

export function discoverInputFiles(inputDir: string): string[] {
  if (!fs.existsSync(inputDir)) return [];
  return fs.readdirSync(inputDir)
    .filter((f) => !f.startsWith('.') && f !== 'README.md')
    .map((f) => path.join(inputDir, f))
    .filter((p) => fs.statSync(p).isFile());
}
