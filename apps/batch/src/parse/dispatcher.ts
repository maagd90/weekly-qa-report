import fs from 'fs';
import path from 'path';
import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { readWorkbookRows } from '../utils/readWorkbook';
import { isExecutionExportFile, parseExecutionExportFromRows } from './parseExecutionExport';
import { isJiraExport, parseJiraFromRows } from './parseJira';
import { isOdlFile, parseOdlFromRows } from './parseOdl';
import { mergeDatasets } from '../merge/mergeDataset';
import { canonicalProjectKey } from '../projects/projectKey';

export type FileFormat = 'xlsx' | 'unknown';

const SHEET_PREFS: Record<string, string[]> = {
  odl: [],
  jira: ['general_report', 'Jira'],
  execution: ['Data'],
};

interface ImportAssignment {
  project: string;
  assignedAt?: string;
  originalName?: string;
}

type ImportAssignments = Record<string, ImportAssignment>;

const ASSIGNMENTS_FILE = '.project-assignments.json';

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

function readAssignments(inputDir: string): ImportAssignments {
  const assignmentPath = path.join(inputDir, ASSIGNMENTS_FILE);
  if (!fs.existsSync(assignmentPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(assignmentPath, 'utf8')) as ImportAssignments;
  } catch (err) {
    console.error(`[parse] Failed to read ${ASSIGNMENTS_FILE}:`, (err as Error).message);
    return {};
  }
}

function applyProjectAssignment(dataset: Dataset, filePath: string): Dataset {
  const fileName = path.basename(filePath);
  const assignment = readAssignments(path.dirname(filePath))[fileName];
  const project = canonicalProjectKey(assignment?.project);
  if (!project || project === 'all') return dataset;

  dataset.executions = dataset.executions.map((row) => ({ ...row, project }));
  dataset.issues = dataset.issues.map((row) => ({ ...row, project }));
  dataset.uat = dataset.uat.map((row) => ({ ...row, project }));
  dataset.files = dataset.files.map((file) => ({ ...file, project }));
  dataset.projects = [project];
  return dataset;
}

export function parseFile(filePath: string): Dataset {
  const format = detectFormat(filePath);
  const fileName = path.basename(filePath);
  const ds = emptyDataset();
  ds.meta.sourceFiles.push(filePath);

  if (format !== 'xlsx') {
    ds.meta.warnings.push(`Unsupported format: ${fileName}`);
    return ds;
  }

  try {
    const { rows } = readWorkbookRows(filePath, [
      ...SHEET_PREFS.odl,
      ...SHEET_PREFS.jira,
      ...SHEET_PREFS.execution,
    ]);
    const parsed = routeParse(rows, fileName, ds.meta.warnings);
    ds.executions = parsed.executions;
    ds.issues = parsed.issues;
    ds.uat = parsed.uat;
    ds.files = parsed.files;
    return applyProjectAssignment(ds, filePath);
  } catch (err) {
    console.error(`[parse] Failed to read ${fileName}:`, (err as Error).message);
    ds.meta.warnings.push(`Failed to parse ${fileName}: ${(err as Error).message}`);
  }
  return ds;
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
