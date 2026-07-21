import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  canonicalProjectKey,
  emptyDataset,
  executionIdentity,
  inspectImportFile,
  issueIdentity,
  mergeDatasets,
  readJsonFile,
  uatIdentity,
} from 'qa-dashboard-batch';
import type { Dataset, RuntimePaths } from 'qa-dashboard-batch';

export interface ProjectRecord {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeletionResult {
  project: ProjectRecord;
  filesDeleted: number;
  syncReportsDeleted: number;
}

export interface ProjectFileRecord {
  id: string;
  projectId: string;
  originalName: string;
  storedName: string;
  size: number;
  uploadedAt: string;
  status: 'staged' | 'synced' | 'error';
  detectedType?: 'test-execution' | 'jira' | 'odl' | 'unknown';
  rows?: number;
  lastSyncId?: string;
  lastSyncedAt?: string;
}

export interface ImportRecordCounts {
  executions: number;
  stories: number;
  bugs: number;
  vendorBugs: number;
}

export interface ImportFileReport {
  fileId: string;
  filename: string;
  detectedType: 'test-execution' | 'jira' | 'odl' | 'unknown';
  sheet: string;
  totalRowsFound: number;
  successfullyImportedRows: number;
  createdRecords: number;
  updatedRecords: number;
  duplicateOrSkippedRows: number;
  rejectedRows: number;
  rejections: Array<{ rowNumber: number; reference: string; reason: string }>;
  warnings: string[];
  errors: string[];
}

export interface ProjectSyncReport {
  id: string;
  project: Pick<ProjectRecord, 'id' | 'key' | 'name'>;
  initiatedBy: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'Successful' | 'Partially Successful' | 'Failed';
  filesProcessed: number;
  previousTotals: ImportRecordCounts;
  newTotals: ImportRecordCounts;
  rowCounts: { executions: number; issues: number; uat: number };
  files: ImportFileReport[];
  warnings: string[];
}

interface ProjectRegistryFile { projects: ProjectRecord[] }
interface ProjectFilesManifest { files: ProjectFileRecord[] }

function now(): string {
  return new Date().toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function safeOriginalName(value: string): string {
  const name = path.basename(value).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return name || 'import.xlsx';
}

function datasetCounts(dataset: Dataset): ImportRecordCounts {
  return {
    executions: dataset.executions.length,
    stories: dataset.issues.filter((row) => row.issueType === 'Story').length,
    bugs: dataset.issues.filter((row) => row.issueType === 'Bug').length,
    vendorBugs: dataset.uat.length,
  };
}

function rowCounts(dataset: Dataset): ProjectSyncReport['rowCounts'] {
  return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length };
}

function normalizeProjectDataset(dataset: Dataset, project: ProjectRecord, filename: string): { dataset: Dataset; reassignedRows: number } {
  const sourceProjects = [
    ...dataset.executions.map((row) => canonicalProjectKey(row.project)),
    ...dataset.issues.map((row) => canonicalProjectKey(row.project)),
    ...dataset.uat.map((row) => canonicalProjectKey(row.project)),
  ];
  const reassignedRows = sourceProjects.filter((key) => key && key !== project.key).length;
  const normalized: Dataset = {
    ...dataset,
    executions: dataset.executions.map((row) => ({ ...row, project: project.key })),
    issues: dataset.issues.map((row) => ({ ...row, project: project.key })),
    uat: dataset.uat.map((row) => ({ ...row, project: project.key, sourceFile: filename })),
    projects: dataset.executions.length || dataset.issues.length || dataset.uat.length ? [project.key] : [],
    files: dataset.files.map((file) => ({ ...file, name: filename, project: project.key })),
  };
  return { dataset: normalized, reassignedRows };
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export class ProjectImportStore {
  private readonly projectsFile: string;
  private readonly manifestFile: string;
  private readonly projectsInputDir: string;
  private readonly projectCacheDir: string;
  private readonly syncReportDir: string;
  private readonly importedCacheFile: string;
  private readonly liveCacheFile: string;

  constructor(paths: RuntimePaths) {
    this.projectsFile = path.join(paths.configDir, 'projects.json');
    this.manifestFile = path.join(paths.configDir, 'project-imports.json');
    this.projectsInputDir = path.join(paths.inputDir, 'projects');
    this.projectCacheDir = path.join(paths.outputDir, 'import-projects');
    this.syncReportDir = path.join(paths.outputDir, 'import-sync');
    this.importedCacheFile = path.join(paths.outputDir, 'raw-dataset.imported.json');
    this.liveCacheFile = path.join(paths.outputDir, 'raw-dataset.live.json');
    [this.projectsInputDir, this.projectCacheDir, this.syncReportDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  }

  listProjects(): ProjectRecord[] {
    return [...(readJsonFile<ProjectRegistryFile>(this.projectsFile)?.projects || [])]
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  ensureProjectsForKeys(keys: string[]): ProjectRecord[] {
    const registry = this.listProjects();
    const existing = new Map(registry.map((project) => [project.key, project]));
    let changed = false;
    for (const rawKey of keys) {
      const key = canonicalProjectKey(rawKey);
      if (!key || key === 'all' || existing.has(key)) continue;
      const timestamp = now();
      const project = { id: crypto.randomUUID(), key, name: key, createdAt: timestamp, updatedAt: timestamp };
      registry.push(project);
      existing.set(key, project);
      changed = true;
    }
    if (changed) this.saveProjects(registry);
    return registry.sort((left, right) => left.name.localeCompare(right.name));
  }

  createProject(input: { key?: string; name?: string }): ProjectRecord {
    const key = canonicalProjectKey(input.key);
    const name = (input.name || '').trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(key) || key === 'all') {
      throw new Error('Project key must contain 2-32 letters, numbers, underscores, or hyphens.');
    }
    if (name.length < 2 || name.length > 100) throw new Error('Project name must contain 2-100 characters.');
    const projects = this.listProjects();
    if (projects.some((project) => project.key === key)) throw new Error(`Project ${key} already exists.`);
    const timestamp = now();
    const project: ProjectRecord = { id: crypto.randomUUID(), key, name, createdAt: timestamp, updatedAt: timestamp };
    projects.push(project);
    this.saveProjects(projects);
    fs.mkdirSync(this.projectDirectory(project.id), { recursive: true });
    return project;
  }

  getProject(projectId: string): ProjectRecord {
    const project = this.listProjects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('Project not found.');
    return project;
  }

  updateProject(projectId: string, input: { name?: string }): ProjectRecord {
    const name = (input.name || '').trim();
    if (name.length < 2 || name.length > 100) throw new Error('Project name must contain 2-100 characters.');
    const projects = this.listProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error('Project not found.');
    const updated = { ...projects[index], name, updatedAt: now() };
    projects[index] = updated;
    this.saveProjects(projects);
    return updated;
  }

  deleteProject(projectId: string, confirmationKey?: string): ProjectDeletionResult {
    const project = this.getProject(projectId);
    if (canonicalProjectKey(confirmationKey) !== project.key) {
      throw new Error(`Project deletion confirmation must match project key ${project.key}.`);
    }

    const manifest = this.loadManifest();
    const projectFiles = manifest.files.filter((file) => file.projectId === projectId);
    manifest.files = manifest.files.filter((file) => file.projectId !== projectId);
    this.saveManifest(manifest);

    const projectDirectory = this.projectDirectory(projectId);
    if (fs.existsSync(projectDirectory)) fs.rmSync(projectDirectory, { recursive: true, force: true });
    const projectCache = this.projectCachePath(projectId);
    if (fs.existsSync(projectCache)) fs.unlinkSync(projectCache);

    let syncReportsDeleted = 0;
    for (const filename of fs.readdirSync(this.syncReportDir)) {
      if (!filename.endsWith('.json')) continue;
      const reportPath = path.join(this.syncReportDir, filename);
      const report = readJsonFile<ProjectSyncReport>(reportPath);
      if (report?.project.id !== projectId) continue;
      fs.unlinkSync(reportPath);
      syncReportsDeleted += 1;
    }

    this.saveProjects(this.listProjects().filter((candidate) => candidate.id !== projectId));
    this.removeProjectFromLiveCache(project.key);
    this.rebuildAggregateDataset();
    return { project, filesDeleted: projectFiles.length, syncReportsDeleted };
  }

  listFiles(projectId: string): ProjectFileRecord[] {
    this.getProject(projectId);
    return this.loadManifest().files
      .filter((file) => file.projectId === projectId)
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  }

  stageFile(projectId: string, originalName: string, buffer: Buffer): ProjectFileRecord {
    this.getProject(projectId);
    const cleanedName = safeOriginalName(originalName);
    const ext = path.extname(cleanedName).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') throw new Error('Only .xlsx and .xls files are allowed.');
    const id = crypto.randomUUID();
    const storedName = `${Date.now()}-${id}${ext}`;
    const directory = this.projectDirectory(projectId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, storedName), buffer);
    const record: ProjectFileRecord = {
      id,
      projectId,
      originalName: cleanedName,
      storedName,
      size: buffer.length,
      uploadedAt: now(),
      status: 'staged',
    };
    const manifest = this.loadManifest();
    manifest.files.push(record);
    this.saveManifest(manifest);
    return record;
  }

  deleteFile(projectId: string, fileId: string): ProjectFileRecord {
    this.getProject(projectId);
    const manifest = this.loadManifest();
    const index = manifest.files.findIndex((file) => file.id === fileId && file.projectId === projectId);
    if (index < 0) throw new Error('File not found in the selected project.');
    const [record] = manifest.files.splice(index, 1);
    const filePath = path.join(this.projectDirectory(projectId), record.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.saveManifest(manifest);
    return record;
  }

  syncProject(projectId: string, initiatedBy = 'Local user'): ProjectSyncReport {
    const project = this.getProject(projectId);
    const records = this.listFiles(projectId);
    const syncId = crypto.randomUUID();
    const startedAt = now();
    const startedMs = Date.now();
    const previousDataset = this.loadProjectDataset(projectId) || emptyDataset();
    const previousRows = {
      executions: new Map(previousDataset.executions.map((row) => [executionIdentity(row), JSON.stringify(row)])),
      issues: new Map(previousDataset.issues.map((row) => [issueIdentity(row), JSON.stringify(row)])),
      uat: new Map(previousDataset.uat.map((row) => [uatIdentity(row), JSON.stringify(row)])),
    };
    const seen = { executions: new Set<string>(), issues: new Set<string>(), uat: new Set<string>() };
    const parts: Dataset[] = [];
    const fileReports: ImportFileReport[] = [];
    const manifest = this.loadManifest();

    for (const record of records) {
      const filePath = path.join(this.projectDirectory(projectId), record.storedName);
      const inspected = inspectImportFile(filePath);
      const normalized = normalizeProjectDataset(inspected.dataset, project, record.originalName);
      const warnings = [...inspected.inspection.warnings];
      if (normalized.reassignedRows > 0) {
        warnings.push(`${normalized.reassignedRows} row(s) were assigned to ${project.key}, the selected owning project.`);
      }
      let createdRecords = 0;
      let updatedRecords = 0;
      let duplicateOrSkippedRows = 0;
      const classify = <T>(rows: T[], identity: (row: T) => string, category: keyof typeof seen) => {
        const accepted: T[] = [];
        for (const row of rows) {
          const id = identity(row);
          if (seen[category].has(id)) {
            duplicateOrSkippedRows += 1;
            continue;
          }
          seen[category].add(id);
          accepted.push(row);
          const previous = previousRows[category].get(id);
          if (previous === undefined) createdRecords += 1;
          else if (previous === JSON.stringify(row)) duplicateOrSkippedRows += 1;
          else updatedRecords += 1;
        }
        return accepted;
      };
      normalized.dataset.executions = classify(normalized.dataset.executions, executionIdentity, 'executions');
      normalized.dataset.issues = classify(normalized.dataset.issues, issueIdentity, 'issues');
      normalized.dataset.uat = classify(normalized.dataset.uat, uatIdentity, 'uat');
      parts.push(normalized.dataset);

      const report: ImportFileReport = {
        fileId: record.id,
        filename: record.originalName,
        detectedType: inspected.inspection.detectedType,
        sheet: inspected.inspection.sheetName,
        totalRowsFound: inspected.inspection.rowsFound,
        successfullyImportedRows: createdRecords + updatedRecords,
        createdRecords,
        updatedRecords,
        duplicateOrSkippedRows,
        rejectedRows: inspected.inspection.rejectedRows,
        rejections: inspected.inspection.rejections,
        warnings: unique(warnings),
        errors: inspected.inspection.errors,
      };
      fileReports.push(report);
      const manifestRecord = manifest.files.find((file) => file.id === record.id && file.projectId === projectId);
      if (manifestRecord) {
        manifestRecord.status = report.errors.length ? 'error' : 'synced';
        manifestRecord.detectedType = report.detectedType;
        manifestRecord.rows = normalized.dataset.executions.length + normalized.dataset.issues.length + normalized.dataset.uat.length;
        manifestRecord.lastSyncId = syncId;
        manifestRecord.lastSyncedAt = now();
      }
    }

    const projectDataset = mergeDatasets(parts);
    this.saveProjectDataset(projectId, projectDataset);
    this.rebuildAggregateDataset();
    this.saveManifest(manifest);

    const warnings = unique(fileReports.flatMap((file) => file.warnings));
    const hasErrors = fileReports.some((file) => file.errors.length > 0);
    const hasRejected = fileReports.some((file) => file.rejectedRows > 0);
    const importedRows = projectDataset.executions.length + projectDataset.issues.length + projectDataset.uat.length;
    const status: ProjectSyncReport['status'] = hasErrors && importedRows === 0
      ? 'Failed'
      : hasErrors || hasRejected || warnings.length
        ? 'Partially Successful'
        : 'Successful';
    const report: ProjectSyncReport = {
      id: syncId,
      project: { id: project.id, key: project.key, name: project.name },
      initiatedBy: initiatedBy.trim() || 'Local user',
      startedAt,
      completedAt: now(),
      durationMs: Date.now() - startedMs,
      status,
      filesProcessed: records.length,
      previousTotals: datasetCounts(previousDataset),
      newTotals: datasetCounts(projectDataset),
      rowCounts: rowCounts(projectDataset),
      files: fileReports,
      warnings,
    };
    writeJsonAtomic(this.reportPath(syncId), report);
    return report;
  }

  getSyncReport(projectId: string, syncId: string): ProjectSyncReport {
    this.getProject(projectId);
    const report = readJsonFile<ProjectSyncReport>(this.reportPath(path.basename(syncId)));
    if (!report || report.project.id !== projectId) throw new Error('Import reconciliation report not found for the selected project.');
    return report;
  }

  reconciliationCsv(projectId: string, syncId: string): string {
    const report = this.getSyncReport(projectId, syncId);
    const headers = ['Project Key', 'Project Name', 'Sync ID', 'Status', 'Filename', 'Detected Type', 'Sheet', 'Rows Found', 'Imported', 'Created', 'Updated', 'Duplicate/Skipped', 'Rejected', 'Rejected Row', 'Reference', 'Rejection Reason', 'Warnings', 'Errors'];
    const rows = report.files.flatMap((file) => {
      const rejections = file.rejections.length ? file.rejections : [{ rowNumber: '', reference: '', reason: '' }];
      return rejections.map((rejection) => [
        report.project.key, report.project.name, report.id, report.status, file.filename, file.detectedType,
        file.sheet, file.totalRowsFound, file.successfullyImportedRows, file.createdRecords, file.updatedRecords,
        file.duplicateOrSkippedRows, file.rejectedRows, rejection.rowNumber, rejection.reference, rejection.reason,
        file.warnings, file.errors,
      ]);
    });
    return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  }

  private projectDirectory(projectId: string): string {
    return path.join(this.projectsInputDir, projectId);
  }

  private reportPath(syncId: string): string {
    return path.join(this.syncReportDir, `${syncId}.json`);
  }

  private projectCachePath(projectId: string): string {
    return path.join(this.projectCacheDir, `${projectId}.json`);
  }

  private loadProjectDataset(projectId: string): Dataset | null {
    return readJsonFile<Dataset>(this.projectCachePath(projectId));
  }

  private saveProjectDataset(projectId: string, dataset: Dataset): void {
    writeJsonAtomic(this.projectCachePath(projectId), dataset);
  }

  private rebuildAggregateDataset(): Dataset {
    const datasets = this.listProjects()
      .map((project) => this.loadProjectDataset(project.id))
      .filter((dataset): dataset is Dataset => Boolean(dataset));
    const aggregate = mergeDatasets(datasets);
    writeJsonAtomic(this.importedCacheFile, aggregate);
    return aggregate;
  }

  private removeProjectFromLiveCache(projectKey: string): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    const belongsToProject = (value?: string) => canonicalProjectKey(value) === projectKey;
    const remaining: Dataset = {
      ...live,
      executions: live.executions.filter((row) => !belongsToProject(row.project)),
      issues: live.issues.filter((row) => !belongsToProject(row.project)),
      uat: live.uat.filter((row) => !belongsToProject(row.project)),
      files: live.files.filter((file) => !belongsToProject(file.project)),
      projects: live.projects.map(canonicalProjectKey).filter((key) => key && key !== projectKey),
      meta: { ...live.meta, parsedAt: now() },
    };
    writeJsonAtomic(this.liveCacheFile, remaining);
  }

  private loadManifest(): ProjectFilesManifest {
    return readJsonFile<ProjectFilesManifest>(this.manifestFile) || { files: [] };
  }

  private saveManifest(manifest: ProjectFilesManifest): void {
    writeJsonAtomic(this.manifestFile, manifest);
  }

  private saveProjects(projects: ProjectRecord[]): void {
    writeJsonAtomic(this.projectsFile, { projects });
  }
}
