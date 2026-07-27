import { emptyDataset } from 'qa-dashboard-batch';
import type { Dataset, MappedColumnDefinition, MappedImportProfile, RuntimePaths, WorkbookColumnInspection } from 'qa-dashboard-batch';
import { ImportFileManager } from './ImportFileManager';
import { ProjectRegistry } from './ProjectRegistry';
import { renameDatasetProject, SyncReportStore } from './SyncReportStore';
import type {
  DedicatedTabInput,
  ProjectCapabilities,
  ProjectDeletionResult,
  ProjectFileRecord,
  ProjectRecord,
  ProjectSyncReport,
  ProjectTabConfig,
  ProjectTabDataset,
} from './types';

/**
 * Facade over the project-import subsystem. Composes three focused
 * collaborators - `ProjectRegistry` (project CRUD), `ImportFileManager`
 * (staged files + tab mappings), and `SyncReportStore` (sync execution +
 * dataset caches) - and orchestrates the cross-cutting workflows (rename,
 * delete, uploaded-issue view) that necessarily touch more than one of
 * them. Callers should keep depending on this single class; the split is
 * an internal implementation detail.
 */
export class ProjectImportStore {
  private readonly registry: ProjectRegistry;
  private readonly files: ImportFileManager;
  private readonly sync: SyncReportStore;

  constructor(paths: RuntimePaths) {
    this.registry = new ProjectRegistry(paths);
    this.files = new ImportFileManager(paths, this.registry);
    this.sync = new SyncReportStore(paths, this.registry, this.files);
  }

  listProjects(): ProjectRecord[] {
    return this.registry.listProjects();
  }

  ensureProjectsForKeys(keys: string[]): ProjectRecord[] {
    return this.registry.ensureProjectsForKeys(keys);
  }

  createProject(input: {
    key?: string;
    sourceKeys?: string[];
    name?: string;
    capabilities?: Partial<ProjectCapabilities>;
    dedicatedTab?: DedicatedTabInput;
  }): ProjectRecord {
    const project = this.registry.createProject(input);
    this.files.ensureProjectDirectory(project.id);
    return project;
  }

  getProject(projectId: string): ProjectRecord {
    return this.registry.getProject(projectId);
  }

  updateProject(projectId: string, input: {
    key?: string;
    sourceKeys?: string[];
    name?: string;
    capabilities?: Partial<ProjectCapabilities>;
    dedicatedTab?: DedicatedTabInput;
  }): ProjectRecord {
    const { previous, updated } = this.registry.updateProject(projectId, input);
    if (previous.key !== updated.key) {
      const projectDataset = this.sync.getProjectDataset(projectId);
      if (projectDataset) this.sync.saveProjectDataset(projectId, renameDatasetProject(projectDataset, previous.key, updated.key));
      this.sync.renameProjectInLiveCache(previous.key, updated.key);
    }
    this.sync.normalizeLiveCacheProjectOwnership();
    this.sync.updateProjectSyncReports(updated);
    this.sync.rebuildAggregateDataset();
    return updated;
  }

  deleteProject(projectId: string, confirmationKey?: string): ProjectDeletionResult {
    const project = this.registry.verifyDeletionConfirmation(projectId, confirmationKey);
    const filesDeleted = this.files.purgeProjectFiles(projectId);
    this.sync.purgeProjectCache(projectId);
    const syncReportsDeleted = this.sync.purgeProjectSyncReports(projectId);
    this.registry.removeProject(projectId);
    this.sync.removeProjectFromLiveCache(project.sourceKeys);
    this.sync.rebuildAggregateDataset();
    return { project, filesDeleted, syncReportsDeleted };
  }

  listFiles(projectId: string): ProjectFileRecord[] {
    return this.files.listFiles(projectId);
  }

  inspectFile(projectId: string, fileId: string): WorkbookColumnInspection {
    return this.files.inspectFile(projectId, fileId);
  }

  saveFileMapping(
    projectId: string,
    fileId: string,
    input: { tabId?: string; columns?: MappedColumnDefinition[]; uniqueKey?: string },
  ): { project: ProjectRecord; file: ProjectFileRecord; mapping: MappedImportProfile } {
    return this.files.saveFileMapping(projectId, fileId, input);
  }

  getTabData(projectId: string, tabId: string): { project: ProjectRecord; tab: ProjectTabConfig; dataset: ProjectTabDataset } {
    return this.files.getTabData(projectId, tabId);
  }

  /**
   * Returns only Story/Bug rows parsed from files uploaded to one project.
   * Live JIRA rows are deliberately impossible in this view, which keeps
   * project-specific export tabs independent from connection synchronization.
   */
  uploadedIssueDataset(projectId: string): Dataset {
    const project = this.registry.getProject(projectId);
    const stored = this.sync.getProjectDataset(projectId) || emptyDataset();
    const issues = stored.issues.filter((row) => row.source === 'jira-file');
    return {
      ...stored,
      executions: [],
      issues,
      uat: [],
      projects: [project.key],
      files: stored.files.filter((file) => file.source === 'file' && file.detectedType === 'jira'),
      meta: {
        ...stored.meta,
        integrations: { jira: false, qmetry: false },
      },
    };
  }

  stageFile(projectId: string, originalName: string, buffer: Buffer): ProjectFileRecord {
    return this.files.stageFile(projectId, originalName, buffer);
  }

  deleteFile(projectId: string, fileId: string): ProjectFileRecord {
    return this.files.deleteFile(projectId, fileId);
  }

  syncProject(projectId: string, initiatedBy = 'Local user'): ProjectSyncReport {
    return this.sync.syncProject(projectId, initiatedBy);
  }

  syncProjectSerialized(projectId: string, initiatedBy = 'Local user'): Promise<ProjectSyncReport> {
    return this.sync.syncProjectSerialized(projectId, initiatedBy);
  }

  getSyncReport(projectId: string, syncId: string): ProjectSyncReport {
    return this.sync.getSyncReport(projectId, syncId);
  }

  reconciliationCsv(projectId: string, syncId: string): string {
    return this.sync.reconciliationCsv(projectId, syncId);
  }
}
