import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { isZephyrFile, parseZephyr } from './parseZephyr';
import { isJiraExport, parseJira } from './parseJira';
import { isOdlFile, parseOdl } from './parseOdl';
import { mergeDatasets } from '../merge/mergeDataset';

export type FileFormat = 'xlsx' | 'unknown';

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

export function parseFile(filePath: string): Dataset {
  const format = detectFormat(filePath);
  if (format !== 'xlsx') {
    const ds = emptyDataset();
    ds.meta.warnings.push(`Unsupported format: ${path.basename(filePath)}`);
    ds.meta.sourceFiles.push(filePath);
    return ds;
  }

  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];

  const ds = emptyDataset();
  ds.meta.sourceFiles.push(filePath);

  if (isOdlFile(rows)) {
    const { uat, file } = parseOdl(filePath);
    ds.uat = uat;
    ds.files.push(file);
    return ds;
  }
  if (isJiraExport(rows)) {
    const { issues, file } = parseJira(filePath);
    ds.issues = issues;
    ds.files.push(file);
    return ds;
  }
  if (isZephyrFile(rows)) {
    const { executions, file } = parseZephyr(filePath);
    ds.executions = executions;
    ds.files.push(file);
    return ds;
  }

  ds.meta.warnings.push(`Unknown xlsx format: ${path.basename(filePath)}`);
  return ds;
}

export function parseAllFiles(filePaths: string[]): Dataset {
  const parts = filePaths.map(parseFile);
  return mergeDatasets(parts);
}

export function sniffFileType(filePath: string): 'zephyr' | 'jira' | 'odl' | 'unknown' {
  try {
    const buffer = fs.readFileSync(filePath);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][];
    if (isOdlFile(rows)) return 'odl';
    if (isJiraExport(rows)) return 'jira';
    if (isZephyrFile(rows)) return 'zephyr';
  } catch { /* ignore */ }
  return 'unknown';
}
