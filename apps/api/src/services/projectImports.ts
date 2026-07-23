import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  canonicalProjectKey,
  emptyDataset,
  executionIdentity,
  inspectImportFile,
  inspectWorkbookColumns,
  issueIdentity,
  mergeDatasets,
  normalizeProjectPrimaryKey,
  normalizeSourceProjectKey,
  parseMappedWorkbook,
  projectSourceKeys,
  readJsonFile,
  uatIdentity,
} from 'qa-dashboard-batch';
import type {
  Dataset,
  MappedColumnDefinition,
  MappedImportProfile,
  RuntimePaths,
  WorkbookColumnInspection,
} from 'qa-dashboard-batch';
import { normalizeDatasetProjectOwnership } from './projectConnections';

export interface ProjectRecord {
  id: string;
  key: string;
  /** External JIRA/QMetry keys consolidated into this dashboard workspace. */
  sourceKeys: string[];
  name: string;
  capabilities?: ProjectCapabilities;
  tabs: ProjectTabConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCapabilities {
  vendorPortal: boolean;
  wonderMilesExport: boolean;
}

export interface ProjectTabConfig {
  id: string;
  label: string;
  enabled: boolean;
  rendererType: 'generic-table';
  mappings: MappedImportProfile[];
  activeMappingVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DedicatedTabInput {
  enabled: boolean;
  label?: string;
}

export interface ProjectTabRow {
  id: string;
  projectId: string;
  tabId: string;
  importProfileVersion: number;
  sourceFileId: string;
  sourceFile: string;
  sourceRow: number;
  importedAt: string;
  values: Record<string, string | number | boolean | null>;
}

export interface ProjectTabDataset {
  projectId: string;
  tabId: string;
  mappingVersion?: number;
  rows: ProjectTabRow[];
  sourceFiles: Array<{ fileId: string; filename: string; rows: number }>;
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
  detectedType?: 'test-execution' | 'jira' | 'odl' | 'mapped' | 'unknown';
  headerSignature?: string;
  mappingStatus?: 'required' | 'mapped' | 'not-required';
  tabId?: string;
  mappingVersion?: number;
  rows?: number;
  lastSyncId?: string;
  lastSyncedAt?: string;
}

export interface ImportRecordCounts {
  executions: number;
  stories: number;
  bugs: number;
  vendorBugs: number;
  customRows: number;
}

export interface ImportFileReport {
  fileId: string;
  filename: string;
  detectedType: 'test-execution' | 'jira' | 'odl' | 'mapped' | 'unknown';
  sheet: string;
  totalRowsFound: number;
  successfullyImportedRows: number;
  createdRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
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
  rowCounts: { executions: number; issues: number; uat: number; generic: number };
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

function normalizeSourceKeys(primaryKey: string, values?: string[], previousPrimaryKey?: string): string[] {
  const aliases = (values || [])
    .map(normalizeSourceProjectKey)
    .filter((key) => key && key !== 'ALL' && key !== previousPrimaryKey && key !== primaryKey);
  return [primaryKey, ...unique(aliases).sort()];
}

function inferredCapabilities(project: Pick<ProjectRecord, 'key' | 'sourceKeys'>): ProjectCapabilities {
  const sourceKeys = new Set(projectSourceKeys(project));
  return {
    vendorPortal: project.key === 'DLM',
    wonderMilesExport: project.key === 'DTTRV' || sourceKeys.has('DP') || sourceKeys.has('DTTRV'),
  };
}

function normalizeTab(tab: ProjectTabConfig): ProjectTabConfig {
  const mappings = Array.isArray(tab.mappings) ? tab.mappings : [];
  const activeMappingVersion = mappings.some((mapping) => mapping.version === tab.activeMappingVersion)
    ? tab.activeMappingVersion
    : mappings[mappings.length - 1]?.version;
  return {
    ...tab,
    enabled: tab.enabled !== false,
    rendererType: 'generic-table',
    mappings,
    ...(activeMappingVersion ? { activeMappingVersion } : {}),
  };
}

function normalizedProject(project: ProjectRecord): ProjectRecord {
  const key = normalizeProjectPrimaryKey(project.key) || project.key;
  const sourceKeys = normalizeSourceKeys(key, project.sourceKeys);
  return {
    ...project,
    key,
    sourceKeys,
    capabilities: { ...inferredCapabilities({ key, sourceKeys }), ...(project.capabilities || {}) },
    tabs: Array.isArray(project.tabs) ? project.tabs.map(normalizeTab) : [],
  };
}

function validateProjectKeys(key: string, sourceKeys: string[]): void {
  for (const candidate of sourceKeys) {
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(candidate) || candidate === 'all') {
      throw new Error('Project and associated source keys must contain 2-32 letters, numbers, underscores, or hyphens.');
    }
  }
  if (!sourceKeys.includes(key)) throw new Error(`Associated source keys must include the primary project key ${key}.`);
}

function assertUniqueSourceKeys(projects: ProjectRecord[], candidate: ProjectRecord): void {
  const existing = new Map<string, ProjectRecord>();
  for (const project of projects) {
    if (project.id === candidate.id) continue;
    for (const key of project.sourceKeys) existing.set(key, project);
  }
  const duplicate = candidate.sourceKeys.find((key) => existing.has(key));
  if (duplicate) {
    throw new Error(`Source key ${duplicate} is already assigned to project ${existing.get(duplicate)!.key}.`);
  }
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
    customRows: 0,
  };
}

function rowCounts(dataset: Dataset, generic = 0): ProjectSyncReport['rowCounts'] {
  return { executions: dataset.executions.length, issues: dataset.issues.length, uat: dataset.uat.length, generic };
}

function tabLabel(value?: string): string {
  const label = (value || '').trim();
  if (label.length < 2 || label.length > 80) throw new Error('Dedicated tab name must contain 2-80 characters.');
  return label;
}

function createTab(input: DedicatedTabInput): ProjectTabConfig {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    label: tabLabel(input.label),
    enabled: input.enabled,
    rendererType: 'generic-table',
    mappings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateMappedColumns(
  inspection: WorkbookColumnInspection,
  columns: MappedColumnDefinition[],
  uniqueKey: string,
): MappedColumnDefinition[] {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 200) {
    throw new Error('Map between 1 and 200 source columns.');
  }
  const sourceHeaders = new Set(inspection.headers.map((header) => header.toLocaleLowerCase()));
  const fieldKeys = new Set<string>();
  const mappedHeaders = new Set<string>();
  const normalized = columns.map((column) => {
    const fieldKey = String(column.fieldKey || '').trim();
    const sourceHeader = String(column.sourceHeader || '').trim();
    const label = String(column.label || '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(fieldKey)) {
      throw new Error(`Column key "${fieldKey}" must start with a lowercase letter and use only lowercase letters, numbers, or underscores.`);
    }
    if (fieldKeys.has(fieldKey)) throw new Error(`Column key "${fieldKey}" is mapped more than once.`);
    if (!sourceHeaders.has(sourceHeader.toLocaleLowerCase())) throw new Error(`Source column "${sourceHeader}" is not present in the selected file.`);
    if (mappedHeaders.has(sourceHeader.toLocaleLowerCase())) throw new Error(`Source column "${sourceHeader}" is mapped more than once.`);
    if (label.length < 1 || label.length > 80) throw new Error('Every mapped column needs a label of 1-80 characters.');
    if (!['text', 'number', 'date', 'boolean'].includes(column.type)) throw new Error(`Unsupported type for ${label}.`);
    fieldKeys.add(fieldKey);
    mappedHeaders.add(sourceHeader.toLocaleLowerCase());
    return {
      fieldKey,
      sourceHeader,
      label,
      type: column.type,
      visible: column.visible !== false,
      filterable: column.filterable !== false,
      searchable: column.searchable !== false,
      required: Boolean(column.required),
    };
  });
  if (!fieldKeys.has(uniqueKey)) throw new Error('Choose one mapped column as the unique record key.');
  if (!normalized.some((column) => column.visible)) throw new Error('At least one mapped column must be visible.');
  return normalized;
}

function targetSchemaSignature(columns: MappedColumnDefinition[], uniqueKey: string): string {
  return JSON.stringify({
    uniqueKey,
    columns: [...columns]
      .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey))
      .map(({ fieldKey, label, type, visible, filterable, searchable, required }) => ({
        fieldKey,
        label,
        type,
        visible,
        filterable,
        searchable,
        required: Boolean(required),
      })),
  });
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

function renameDatasetProject(dataset: Dataset, previousKey: string, nextKey: string): Dataset {
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

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export class ProjectImportStore {
  private readonly projectsFile: string;
  private readonly manifestFile: string;
  private readonly projectsInputDir: string;
  private readonly projectCacheDir: string;
  private readonly projectTabCacheDir: string;
  private readonly syncReportDir: string;
  private readonly importedCacheFile: string;
  private readonly liveCacheFile: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(paths: RuntimePaths) {
    this.projectsFile = path.join(paths.configDir, 'projects.json');
    this.manifestFile = path.join(paths.configDir, 'project-imports.json');
    this.projectsInputDir = path.join(paths.inputDir, 'projects');
    this.projectCacheDir = path.join(paths.outputDir, 'import-projects');
    this.projectTabCacheDir = path.join(paths.outputDir, 'import-project-tabs');
    this.syncReportDir = path.join(paths.outputDir, 'import-sync');
    this.importedCacheFile = path.join(paths.outputDir, 'raw-dataset.imported.json');
    this.liveCacheFile = path.join(paths.outputDir, 'raw-dataset.live.json');
    [this.projectsInputDir, this.projectCacheDir, this.projectTabCacheDir, this.syncReportDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  }

  listProjects(): ProjectRecord[] {
    const stored = [...(readJsonFile<ProjectRegistryFile>(this.projectsFile)?.projects || [])];
    const normalized = stored.map(normalizedProject);
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) this.saveProjects(normalized);
    return normalized.sort((left, right) => left.name.localeCompare(right.name));
  }

  ensureProjectsForKeys(keys: string[]): ProjectRecord[] {
    const registry = this.listProjects();
    const existing = new Map(registry.flatMap((project) => project.sourceKeys.map((key) => [key, project] as const)));
    let changed = false;
    for (const rawKey of keys) {
      const key = canonicalProjectKey(rawKey);
      if (!key || key === 'all' || existing.has(key)) continue;
      const timestamp = now();
      const sourceKeys = normalizeSourceKeys(key, [normalizeSourceProjectKey(rawKey)]);
      const project: ProjectRecord = {
        id: crypto.randomUUID(),
        key,
        sourceKeys,
        name: key,
        capabilities: inferredCapabilities({ key, sourceKeys }),
        tabs: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      registry.push(project);
      existing.set(key, project);
      changed = true;
    }
    if (changed) this.saveProjects(registry);
    return registry.sort((left, right) => left.name.localeCompare(right.name));
  }

  createProject(input: {
    key?: string;
    sourceKeys?: string[];
    name?: string;
    capabilities?: Partial<ProjectCapabilities>;
    dedicatedTab?: DedicatedTabInput;
  }): ProjectRecord {
    const key = normalizeProjectPrimaryKey(input.key);
    const sourceKeys = normalizeSourceKeys(key, input.sourceKeys);
    const name = (input.name || '').trim();
    validateProjectKeys(key, sourceKeys);
    if (name.length < 2 || name.length > 100) throw new Error('Project name must contain 2-100 characters.');
    const projects = this.listProjects();
    const timestamp = now();
    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      key,
      sourceKeys,
      name,
      capabilities: { ...inferredCapabilities({ key, sourceKeys }), ...(input.capabilities || {}) },
      tabs: input.dedicatedTab?.enabled ? [createTab(input.dedicatedTab)] : [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertUniqueSourceKeys(projects, project);
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

  updateProject(projectId: string, input: {
    key?: string;
    sourceKeys?: string[];
    name?: string;
    capabilities?: Partial<ProjectCapabilities>;
    dedicatedTab?: DedicatedTabInput;
  }): ProjectRecord {
    const projects = this.listProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error('Project not found.');
    const current = projects[index];
    const key = input.key === undefined ? current.key : normalizeProjectPrimaryKey(input.key);
    const sourceKeys = normalizeSourceKeys(key, input.sourceKeys === undefined ? current.sourceKeys : input.sourceKeys, current.key !== key ? current.key : undefined);
    const name = input.name === undefined ? current.name : input.name.trim();
    validateProjectKeys(key, sourceKeys);
    if (name.length < 2 || name.length > 100) throw new Error('Project name must contain 2-100 characters.');
    let tabs = current.tabs || [];
    if (input.dedicatedTab) {
      const existing = tabs[0];
      if (input.dedicatedTab.enabled && !existing) {
        tabs = [createTab(input.dedicatedTab)];
      } else if (existing) {
        tabs = [{
          ...existing,
          enabled: input.dedicatedTab.enabled,
          label: input.dedicatedTab.label === undefined ? existing.label : tabLabel(input.dedicatedTab.label),
          updatedAt: now(),
        }, ...tabs.slice(1)];
      }
    }
    const updated = {
      ...current,
      key,
      sourceKeys,
      name,
      capabilities: input.capabilities === undefined
        ? (current.capabilities || inferredCapabilities(current))
        : { ...(current.capabilities || inferredCapabilities(current)), ...input.capabilities },
      tabs,
      updatedAt: now(),
    };
    assertUniqueSourceKeys(projects, updated);
    projects[index] = updated;
    this.saveProjects(projects);

    const projectDataset = this.loadProjectDataset(projectId);
    if (projectDataset && current.key !== key) this.saveProjectDataset(projectId, renameDatasetProject(projectDataset, current.key, key));
    if (current.key !== key) this.renameProjectInLiveCache(current.key, key);
    this.normalizeLiveCacheProjectOwnership();
    this.updateProjectSyncReports(updated);
    this.rebuildAggregateDataset();
    return updated;
  }

  deleteProject(projectId: string, confirmationKey?: string): ProjectDeletionResult {
    const project = this.getProject(projectId);
    if (normalizeProjectPrimaryKey(confirmationKey) !== project.key) {
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
    const projectTabDirectory = this.projectTabDirectory(projectId);
    if (fs.existsSync(projectTabDirectory)) fs.rmSync(projectTabDirectory, { recursive: true, force: true });

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
    this.removeProjectFromLiveCache(project.sourceKeys);
    this.rebuildAggregateDataset();
    return { project, filesDeleted: projectFiles.length, syncReportsDeleted };
  }

  listFiles(projectId: string): ProjectFileRecord[] {
    this.getProject(projectId);
    return this.loadManifest().files
      .filter((file) => file.projectId === projectId)
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  }

  inspectFile(projectId: string, fileId: string): WorkbookColumnInspection {
    const record = this.listFiles(projectId).find((file) => file.id === fileId);
    if (!record) throw new Error('File not found in the selected project.');
    return inspectWorkbookColumns(this.projectFilePath(record));
  }

  saveFileMapping(
    projectId: string,
    fileId: string,
    input: { tabId?: string; columns?: MappedColumnDefinition[]; uniqueKey?: string },
  ): { project: ProjectRecord; file: ProjectFileRecord; mapping: MappedImportProfile } {
    const projects = this.listProjects();
    const projectIndex = projects.findIndex((candidate) => candidate.id === projectId);
    if (projectIndex < 0) throw new Error('Project not found.');
    const project = projects[projectIndex];
    const tabIndex = project.tabs.findIndex((tab) => tab.id === input.tabId);
    if (tabIndex < 0 || !project.tabs[tabIndex].enabled) throw new Error('Select an enabled tab owned by this project.');

    const manifest = this.loadManifest();
    const file = manifest.files.find((candidate) => candidate.id === fileId && candidate.projectId === projectId);
    if (!file) throw new Error('File not found in the selected project.');
    const inspection = inspectWorkbookColumns(this.projectFilePath(file));
    const uniqueKey = String(input.uniqueKey || '').trim();
    const columns = validateMappedColumns(inspection, input.columns || [], uniqueKey);
    const tab = project.tabs[tabIndex];
    const otherSourceSchema = [...tab.mappings]
      .reverse()
      .find((candidate) => candidate.headerSignature !== inspection.headerSignature);
    if (
      otherSourceSchema
      && targetSchemaSignature(otherSourceSchema.columns, otherSourceSchema.uniqueKey) !== targetSchemaSignature(columns, uniqueKey)
    ) {
      throw new Error(
        'This tab already combines another source layout. Map this file to the same project column keys, labels, types, visibility, filters, search settings, and unique key.',
      );
    }
    const nextVersion = Math.max(0, ...tab.mappings.map((mapping) => mapping.version)) + 1;
    const mapping: MappedImportProfile = {
      version: nextVersion,
      headerSignature: inspection.headerSignature,
      columns,
      uniqueKey,
      createdAt: now(),
    };
    project.tabs[tabIndex] = {
      ...tab,
      mappings: [...tab.mappings, mapping],
      activeMappingVersion: mapping.version,
      updatedAt: now(),
    };
    project.updatedAt = now();
    projects[projectIndex] = project;
    this.saveProjects(projects);

    for (const candidate of manifest.files) {
      const sameProjectSchema = candidate.projectId === projectId
        && candidate.headerSignature === inspection.headerSignature
        && (!candidate.tabId || candidate.tabId === tab.id);
      if (!sameProjectSchema) continue;
      candidate.tabId = tab.id;
      candidate.mappingVersion = mapping.version;
      candidate.mappingStatus = 'mapped';
      candidate.headerSignature = inspection.headerSignature;
      candidate.detectedType = 'mapped';
      candidate.status = 'staged';
    }
    this.saveManifest(manifest);
    return { project, file, mapping };
  }

  getTabData(projectId: string, tabId: string): { project: ProjectRecord; tab: ProjectTabConfig; dataset: ProjectTabDataset } {
    const project = this.getProject(projectId);
    const tab = project.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !tab.enabled) throw new Error('Project tab not found or disabled.');
    return {
      project,
      tab,
      dataset: readJsonFile<ProjectTabDataset>(this.projectTabCachePath(projectId, tabId)) || {
        projectId,
        tabId,
        mappingVersion: tab.activeMappingVersion,
        rows: [],
        sourceFiles: [],
        updatedAt: now(),
      },
    };
  }

  /**
   * Returns only Story/Bug rows parsed from files uploaded to one project.
   * Live JIRA rows are deliberately impossible in this view, which keeps
   * project-specific export tabs independent from connection synchronization.
   */
  uploadedIssueDataset(projectId: string): Dataset {
    const project = this.getProject(projectId);
    const stored = this.loadProjectDataset(projectId) || emptyDataset();
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
    const project = this.getProject(projectId);
    const cleanedName = safeOriginalName(originalName);
    const ext = path.extname(cleanedName).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') throw new Error('Only .xlsx and .xls files are allowed.');
    const id = crypto.randomUUID();
    const storedName = `${Date.now()}-${id}${ext}`;
    const directory = this.projectDirectory(projectId);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, storedName);
    fs.writeFileSync(filePath, buffer);
    let inspection: WorkbookColumnInspection | undefined;
    try {
      inspection = inspectWorkbookColumns(filePath);
    } catch {
      // Detailed parse errors are returned during reconciliation/inspection.
    }
    const reusableMappings = inspection
      ? project.tabs.flatMap((tab) => {
        if (!tab.enabled) return [];
        const mapping = [...tab.mappings]
          .reverse()
          .find((candidate) => candidate.headerSignature === inspection!.headerSignature);
        return mapping ? [{ tab, mapping }] : [];
      })
      : [];
    const reusable = reusableMappings.length === 1 ? reusableMappings[0] : undefined;
    const record: ProjectFileRecord = {
      id,
      projectId,
      originalName: cleanedName,
      storedName,
      size: buffer.length,
      uploadedAt: now(),
      status: 'staged',
      detectedType: reusable ? 'mapped' : inspection?.detectedType,
      headerSignature: inspection?.headerSignature,
      mappingStatus: reusable
        ? 'mapped'
        : inspection?.detectedType === 'unknown'
          ? 'required'
          : 'not-required',
      ...(reusable ? { tabId: reusable.tab.id, mappingVersion: reusable.mapping.version } : {}),
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
    const previousTabDatasets = new Map(project.tabs.map((tab) => [
      tab.id,
      readJsonFile<ProjectTabDataset>(this.projectTabCachePath(projectId, tab.id)),
    ]));
    const previousGenericRows = new Map([...previousTabDatasets].map(([tabId, dataset]) => [
      tabId,
      new Map((dataset?.rows || []).map((row) => [row.id, JSON.stringify(row.values)])),
    ]));
    const genericSeen = new Map(project.tabs.map((tab) => [tab.id, new Set<string>()]));
    const genericRows = new Map(project.tabs.map((tab) => [tab.id, [] as ProjectTabRow[]]));
    const genericFiles = new Map(project.tabs.map((tab) => [tab.id, [] as ProjectTabDataset['sourceFiles']]));
    const parts: Dataset[] = [];
    const fileReports: ImportFileReport[] = [];
    const manifest = this.loadManifest();

    for (const record of records) {
      const filePath = this.projectFilePath(record);
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

      const report: ImportFileReport = {
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
      writeJsonAtomic(this.projectTabCachePath(projectId, tab.id), dataset);
    }
    const projectDataset = mergeDatasets(parts);
    this.saveProjectDataset(projectId, projectDataset);
    this.rebuildAggregateDataset();
    this.saveManifest(manifest);

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
    this.getProject(projectId);
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

  private projectDirectory(projectId: string): string {
    return path.join(this.projectsInputDir, projectId);
  }

  private projectFilePath(record: Pick<ProjectFileRecord, 'projectId' | 'storedName'>): string {
    return path.join(this.projectDirectory(record.projectId), record.storedName);
  }

  private projectTabDirectory(projectId: string): string {
    return path.join(this.projectTabCacheDir, projectId);
  }

  private projectTabCachePath(projectId: string, tabId: string): string {
    return path.join(this.projectTabDirectory(projectId), `${path.basename(tabId)}.json`);
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

  private removeProjectFromLiveCache(projectKeys: string[]): void {
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

  private renameProjectInLiveCache(previousKey: string, nextKey: string): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    writeJsonAtomic(this.liveCacheFile, renameDatasetProject(live, previousKey, nextKey));
  }

  private normalizeLiveCacheProjectOwnership(): void {
    const live = readJsonFile<Dataset>(this.liveCacheFile);
    if (!live) return;
    writeJsonAtomic(this.liveCacheFile, normalizeDatasetProjectOwnership(live, this.listProjects()));
  }

  private updateProjectSyncReports(project: ProjectRecord): void {
    for (const filename of fs.readdirSync(this.syncReportDir)) {
      if (!filename.endsWith('.json')) continue;
      const reportPath = path.join(this.syncReportDir, filename);
      const report = readJsonFile<ProjectSyncReport>(reportPath);
      if (report?.project.id !== project.id) continue;
      writeJsonAtomic(reportPath, { ...report, project: { id: project.id, key: project.key, name: project.name } });
    }
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
