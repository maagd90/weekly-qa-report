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
  parseMappedWorkbook,
  readJsonFile,
  uatIdentity,
} from 'qa-dashboard-batch';
import type { Dataset, RuntimePaths } from 'qa-dashboard-batch';
import { normalizeDatasetProjectOwnership } from '../projectConnections';
import { csvCell, now, unique, writeJsonAtomic } from './shared';
import type { ImportFileManager } from './ImportFileManager';
import type { ProjectRegistry } from './ProjectRegistry';
import type { ImportRecordCounts, ProjectRecord, ProjectSyncReport, ProjectTabDataset, ProjectTabRow } from './types';

function datasetCounts(dataset: Dataset): ImportRecordCounts {
  return {
    executions: dataset.executions.length,
    stories: dataset.issues.filter((row) => row.issueType === 'Story').length,
    bugs: dataset.issues.filter((row) => row.issueType === 'Bug').length,
    vendorBugs: dataset.uat.length,
    customRows: 0,
  };
}

function rowCounts(dataset: Dataset, generic = 0): ProjectSyncReport['rowCounts'] {
  return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, generic };
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
    issues: dataset.issues.map((row) => ({ ...row, project: project.key, sourceFile: filename })),
    uat: dataset.uat.map((row) => ({ ...row, project: project.key, sourceFile: filename })),
    projects: dataset.executions.length || dataset.issues.length || dataset.uat.length ? [project.key] : [],
    files: dataset.files.map((file) => ({ ...file, name: filename, project: project.key })),
  };
  return { dataset: normalized, reassignedRows };
}

export function renameDatasetProject(dataset: Dataset, previousKey: string, nextKey: string): Dataset {
  const isRenamedProject = (value?: string) => canonicalProjectKey(value) === previousKey;
  return {
    ...dataset,
    executions: dataset.executions.map((row) => isRenamedProject(row.project) ? { ...row, project: nextKey } : row),
    issues: dataset.issues.map((row) => isRenamedProject(row.project) ? { ...row, project: nextKey } : row),
    uat: dataset.uat.map((row) => isRenamedProject(row.project) ? { ...row, project: nextKey } : row),
    files: dataset.files.map((file) => isRenamedProject(file.project) ? { ...file, project: nextKey } : file),
    projects: unique(dataset.projects.map((key) => canonicalProjectKey(key) === previousKey ? nextKey : canonicalProjectKey(key))),
    meta: { ...dataset.meta, parsedAt: now() },
  };
}

/**
 * Owns sync execution, reconciliation reports, and the dataset caches
 * (per-project, per-tab, aggregate, and live) that sync produces. Reads
 * project records via `ProjectRegistry` and staged files via
 * `ImportFileManager`, but neither of those know this store exists.
 */
export class SyncReportStore {
  private readonly projectCacheDir: string;
  private readonly syncReportDir: string;
  private readonly importedCacheFile: string;
  private readonly liveCacheFile: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    paths: RuntimePaths,
    private readonly registry: ProjectRegistry,
    private readonly files: ImportFileManager,
  ) {
    this.projectCacheDir = path.join(paths.outputDir, 'import-projects');
    this.syncReportDir = path.join(paths.outputDir, 'import-sync');
    this.importedCacheFile = path.join(paths.outputDir, 'raw-dataset.imported.json');
    this.liveCacheFile = path.join(paths.outputDir, 'raw-dataset.live.json');
    [this.projectCacheDir, this.syncReportDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  }

  syncProject(projectId: string, initiatedBy = 'Local user'): ProjectSyncReport {
    const project = this.registry.getProject(projectId);
    const records = this.files.listFiles(projectId);
    const syncId = crypto.randomUUID();
    const startedAt = now();
    const startedMs = Date.now();
    const previousDataset = this.getProjectDataset(projectId) || emptyDataset();
    const previousRows = {
      executions: new Map(previousDataset.executions.map((row) => [executionIdentity(row), JSON.stringify(row)])),
      issues: new Map(previousDataset.issues.map((row) => [issueIdentity(row), JSON.stringify(row)])),
      uat: new Map(previousDataset.uat.map((row) => [uatIdentity(row), JSON.stringify(row)])),
    };
    const seen = { executions: new Set<string>(), issues: new Set<string>(), uat: new Set<string>() };
    const previousTabDatasets = new Map(project.tabs.map((tab) => [
      tab.id,
      readJsonFile<ProjectTabDataset>(this.files.projectTabCachePath(projectId, tab.id)),
    ]));
    const previousGenericRows = new Map([...previousTabDatasets].map(([tabId, dataset]) => [
      tabId,
      new Map((dataset?.rows || []).map((row) => [row.id, JSON.stringify(row.values)])),
    ]));
    const genericSeen = new Map(project.tabs.map((tab) => [tab.id, new Set<string>()]));
    const genericRows = new Map(project.tabs.map((tab) => [tab.id, [] as ProjectTabRow[]]));
    const genericFiles = new Map(project.tabs.map((tab) => [tab.id, [] as ProjectTabDataset['sourceFiles']]));
    const parts: Dataset[] = [];
    const fileReports: ProjectSyncReport['files'] = [];
    const manifest = this.files.loadManifest();

    for (const record of records) {
      const filePath = this.files.projectFilePath(record);
      const inspected = inspectImportFile(filePath);
      const normalized = normalizeProjectDataset(inspected.dataset, project, record.originalName);
      const warnings = [...inspected.inspection.warnings];
      const errors = [...inspected.inspection.errors];
      const rejections = [...inspected.inspection.rejections];
      if (normalized.reassignedRows > 0) {
        warnings.push(`${normalized.reassignedRows} row(s) were assigned to ${project.key}, the selected owning project.`);
      }
      let createdRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let duplicateOrSkippedRows = 0;
      let mappedRows = 0;
      let mappedRowsFound = 0;
      let mappedSheet = '';
      const tab = record.tabId ? project.tabs.find((candidate) => candidate.id === record.tabId) : undefined;
      const mapping = tab?.mappings.find((candidate) => candidate.version === record.mappingVersion);
      if (record.tabId && record.mappingVersion && (!tab || !mapping)) {
        errors.push('The file mapping profile is no longer available for its project tab.');
      } else if (tab && mapping) {
        try {
          const parsed = parseMappedWorkbook(filePath, mapping);
          mappedRowsFound = parsed.inspection.rowCount;
          mappedSheet = parsed.inspection.sheetName;
          if (inspected.inspection.detectedType === 'unknown') rejections.length = 0;
          rejections.push(...parsed.rejections);
          const tabSeen = genericSeen.get(tab.id)!;
          const tabRows = genericRows.get(tab.id)!;
          const previous = previousGenericRows.get(tab.id)!;
          for (const mapped of parsed.rows) {
            const id = mapped.sourceRecordId.trim().toLocaleLowerCase();
            if (tabSeen.has(id)) {
              duplicateOrSkippedRows += 1;
              continue;
            }
            tabSeen.add(id);
            tabRows.push({
              id,
              projectId,
              tabId: tab.id,
              importProfileVersion: mapping.version,
              sourceFileId: record.id,
              sourceFile: record.originalName,
              sourceRow: mapped.sourceRow,
              importedAt: record.uploadedAt,
              values: mapped.values,
            });
            const before = previous.get(id);
            if (before === undefined) createdRecords += 1;
            else if (before === JSON.stringify(mapped.values)) unchangedRecords += 1;
            else updatedRecords += 1;
            mappedRows += 1;
          }
          genericFiles.get(tab.id)!.push({ fileId: record.id, filename: record.originalName, rows: mappedRows });
          // A governed mapping is the valid parser for an otherwise-unknown file.
          if (inspected.inspection.detectedType === 'unknown') {
            errors.length = 0;
            warnings.splice(0, warnings.length, ...warnings.filter((warning) => !/unknown spreadsheet format/i.test(warning)));
          }
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
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
          else if (previous === JSON.stringify(row)) unchangedRecords += 1;
          else updatedRecords += 1;
        }
        return accepted;
      };
      normalized.dataset.executions = classify(normalized.dataset.executions, executionIdentity, 'executions');
      normalized.dataset.issues = classify(normalized.dataset.issues, issueIdentity, 'issues');
      normalized.dataset.uat = classify(normalized.dataset.uat, uatIdentity, 'uat');
      parts.push(normalized.dataset);

      const report: ProjectSyncReport['files'][number] = {
        fileId: record.id,
        filename: record.originalName,
        detectedType: mapping ? 'mapped' : inspected.inspection.detectedType,
        sheet: mappedSheet || inspected.inspection.sheetName,
        totalRowsFound: Math.max(mappedRowsFound, inspected.inspection.rowsFound),
        successfullyImportedRows: createdRecords + updatedRecords + unchangedRecords,
        createdRecords,
        updatedRecords,
        unchangedRecords,
        duplicateOrSkippedRows,
        rejectedRows: rejections.length,
        rejections,
        warnings: unique(warnings),
        errors: unique(errors),
      };
      fileReports.push(report);
      const manifestRecord = manifest.files.find((file) => file.id === record.id && file.projectId === projectId);
      if (manifestRecord) {
        manifestRecord.status = report.errors.length ? 'error' : 'synced';
        manifestRecord.detectedType = report.detectedType;
        manifestRecord.rows = normalized.dataset.executions.length + normalized.dataset.issues.length + normalized.dataset.uat.length + mappedRows;
        manifestRecord.lastSyncId = syncId;
        manifestRecord.lastSyncedAt = now();
      }
    }

    let genericTotal = 0;
    for (const tab of project.tabs) {
      const rows = genericRows.get(tab.id) || [];
      genericTotal += rows.length;
      const dataset: ProjectTabDataset = {
        projectId,
        tabId: tab.id,
        mappingVersion: tab.activeMappingVersion,
        rows,
        sourceFiles: genericFiles.get(tab.id) || [],
        updatedAt: now(),
      };
      writeJsonAtomic(this.files.projectTabCachePath(projectId, tab.id), dataset);
    }
    const projectDataset = mergeDatasets(parts);
    this.saveProjectDataset(projectId, projectDataset);
    this.rebuildAggregateDataset();
    this.files.saveManifest(manifest);

    const warnings = unique(fileReports.flatMap((file) => file.warnings));
    const hasErrors = fileReports.some((file) => file.errors.length > 0);
    const hasRejected = fileReports.some((file) => file.rejectedRows > 0);
    const importedRows = projectDataset.executions.length + projectDataset.issues.length + projectDataset.uat.length + genericTotal;
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
      previousTotals: {
        ...datasetCounts(previousDataset),
        customRows: [...previousTabDatasets.values()].reduce((total, dataset) => total + (dataset?.rows.length || 0), 0),
      },
      newTotals: { ...datasetCounts(projectDataset), customRows: genericTotal },
      rowCounts: rowCounts(projectDataset, genericTotal),
      files: fileReports,
      warnings,
    };
    writeJsonAtomic(this.reportPath(syncId), report);
    return report;
  }

  syncProjectSerialized(projectId: string, initiatedBy = 'Local user'): Promise<ProjectSyncReport> {
    const result = this.operationQueue.then(() => this.syncProject(projectId, initiatedBy));
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  getSyncReport(projectId: string, syncId: string): ProjectSyncReport {
    this.registry.getProject(projectId);
    const report = readJsonFile<ProjectSyncReport>(this.reportPath(path.basename(syncId)));
    if (!report || report.project.id !== projectId) throw new Error('Import reconciliation report not found for the selected project.');
    return report;
  }

  reconciliationCsv(projectId: string, syncId: string): string {
    const report = this.getSyncReport(projectId, syncId);
    const headers = ['Project Key', 'Project Name', 'Sync ID', 'Status', 'Filename', 'Detected Type', 'Sheet', 'Rows Found', 'Imported', 'Created', 'Updated', 'Unchanged', 'Duplicate/Skipped', 'Rejected', 'Rejected Row', 'Reference', 'Rejection Reason', 'Warnings', 'Errors'];
    const rows = report.files.flatMap((file) => {
      const rejections = file.rejections.length ? file.rejections : [{ rowNumber: '', reference: '', reason: '' }];
      return rejections.map((rejection) => [
        report.project.key, report.project.name, report.id, report.status, file.filename, file.detectedType,
        file.sheet, file.totalRowsFound, file.successfullyImportedRows, file.createdRecords, file.updatedRecords, file.unchangedRecords,
        file.duplicateOrSkippedRows, file.rejectedRows, rejection.rowNumber, rejection.reference, rejection.reason,
        file.warnings, file.errors,
      ]);
    });
    return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  }

  getProjectDataset(projectId: string): Dataset | null {
    return readJsonFile<Dataset>(this.projectCachePath(projectId));
  }

  saveProjectDataset(projectId: string, dataset: Dataset): void {
    writeJsonAtomic(this.projectCachePath(projectId), dataset);
  }

  purgeProjectCache(projectId: string): void {
    const projectCache = this.projectCachePath(projectId);
    if (fs.existsSync(projectCache)) fs.unlinkSync(projectCache);
  }

  purgeProjectSyncReports(projectId: string): number {
    let syncReportsDeleted = 0;
    for (const filename of fs.readdirSync(this.syncReportDir)) {
      if (!filename.endsWith('.json')) continue;
      const reportPath = path.join(this.syncReportDir, filename);
      const report = readJsonFile<ProjectSyncReport>(reportPath);
      if (report?.project.id !== projectId) continue;
      fs.unlinkSync(reportPath);
      syncReportsDeleted += 1;
    }
    return syncReportsDeleted;
  }

  rebuildAggregateDataset(): Dataset {
    const datasets = this.registry.listProjects()
      .map((project) => this.getProjectDataset(project.id))
      .filter((dataset): dataset is Dataset => Boolean(dataset));
    const aggregate = mergeDatasets(datasets);
    writeJsonAtomic(this.importedCacheFile, aggregate);
    return aggregate;
  }

  removeProjectFromLiveCache(projectKeys: string[]): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    const ownedKeys = new Set(projectKeys.map(canonicalProjectKey));
    const belongsToProject = (value?: string) => ownedKeys.has(canonicalProjectKey(value));
    const remaining: Dataset = {
      ...live,
      executions: live.executions.filter((row) => !belongsToProject(row.project)),
      issues: live.issues.filter((row) => !belongsToProject(row.project)),
      uat: live.uat.filter((row) => !belongsToProject(row.project)),
      files: live.files.filter((file) => !belongsToProject(file.project)),
      projects: live.projects.map(canonicalProjectKey).filter((key) => key && !ownedKeys.has(key)),
      meta: { ...live.meta, parsedAt: now() },
    };
    writeJsonAtomic(this.liveCacheFile, remaining);
  }

  renameProjectInLiveCache(previousKey: string, nextKey: string): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    writeJsonAtomic(this.liveCacheFile, renameDatasetProject(live, previousKey, nextKey));
  }

  normalizeLiveCacheProjectOwnership(): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    writeJsonAtomic(this.liveCacheFile, normalizeDatasetProjectOwnership(live, this.registry.listProjects()));
  }

  updateProjectSyncReports(project: ProjectRecord): void {
    for (const filename of fs.readdirSync(this.syncReportDir)) {
      if (!filename.endsWith('.json')) continue;
      const reportPath = path.join(this.syncReportDir, filename);
      const report = readJsonFile<ProjectSyncReport>(reportPath);
      if (report?.project.id !== project.id) continue;
      writeJsonAtomic(reportPath, { ...report, project: { id: project.id, key: project.key, name: project.name } });
    }
  }

  private reportPath(syncId: string): string {
    return path.join(this.syncReportDir, `${syncId}.json`);
  }

  private projectCachePath(projectId: string): string {
    return path.join(this.projectCacheDir, `${projectId}.json`);
  }
}
