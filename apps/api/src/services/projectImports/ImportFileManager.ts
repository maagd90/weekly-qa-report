import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { inspectWorkbookColumns, readJsonFile } from 'qa-dashboard-batch';
import type { MappedColumnDefinition, MappedImportProfile, RuntimePaths, WorkbookColumnInspection } from 'qa-dashboard-batch';
import { now, writeJsonAtomic } from './shared';
import type { ProjectRegistry } from './ProjectRegistry';
import type { ProjectFileRecord, ProjectFilesManifest, ProjectRecord, ProjectTabConfig, ProjectTabDataset } from './types';

function safeOriginalName(value: string): string {
  const name = path.basename(value).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return name || 'import.xlsx';
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

/**
 * Owns everything about a project's staged spreadsheet files: the file
 * manifest, on-disk storage, column mapping, and per-tab dataset caches.
 * Reads project records through `ProjectRegistry` and writes tab-mapping
 * changes back through it, but has no knowledge of sync reports or the
 * aggregate/live dataset caches (see `SyncReportStore`).
 */
export class ImportFileManager {
  private readonly manifestFile: string;
  private readonly projectsInputDir: string;
  private readonly projectTabCacheDir: string;

  constructor(paths: RuntimePaths, private readonly registry: ProjectRegistry) {
    this.manifestFile = path.join(paths.configDir, 'project-imports.json');
    this.projectsInputDir = path.join(paths.inputDir, 'projects');
    this.projectTabCacheDir = path.join(paths.outputDir, 'import-project-tabs');
    [this.projectsInputDir, this.projectTabCacheDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  }

  ensureProjectDirectory(projectId: string): void {
    fs.mkdirSync(this.projectDirectory(projectId), { recursive: true });
  }

  listFiles(projectId: string): ProjectFileRecord[] {
    this.registry.getProject(projectId);
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
    const project = this.registry.getProject(projectId);
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
    this.registry.replaceProject(project);

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
    const project = this.registry.getProject(projectId);
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

  stageFile(projectId: string, originalName: string, buffer: Buffer): ProjectFileRecord {
    const project = this.registry.getProject(projectId);
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
    this.registry.getProject(projectId);
    const manifest = this.loadManifest();
    const index = manifest.files.findIndex((file) => file.id === fileId && file.projectId === projectId);
    if (index < 0) throw new Error('File not found in the selected project.');
    const [record] = manifest.files.splice(index, 1);
    const filePath = path.join(this.projectDirectory(projectId), record.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.saveManifest(manifest);
    return record;
  }

  /** Removes all staged files, the manifest entries, and cached tab data for a deleted project. */
  purgeProjectFiles(projectId: string): number {
    const manifest = this.loadManifest();
    const projectFiles = manifest.files.filter((file) => file.projectId === projectId);
    manifest.files = manifest.files.filter((file) => file.projectId !== projectId);
    this.saveManifest(manifest);

    const projectDirectory = this.projectDirectory(projectId);
    if (fs.existsSync(projectDirectory)) fs.rmSync(projectDirectory, { recursive: true, force: true });
    const projectTabDirectory = this.projectTabDirectory(projectId);
    if (fs.existsSync(projectTabDirectory)) fs.rmSync(projectTabDirectory, { recursive: true, force: true });

    return projectFiles.length;
  }

  projectFilePath(record: Pick<ProjectFileRecord, 'projectId' | 'storedName'>): string {
    return path.join(this.projectDirectory(record.projectId), record.storedName);
  }

  projectTabCachePath(projectId: string, tabId: string): string {
    return path.join(this.projectTabDirectory(projectId), `${path.basename(tabId)}.json`);
  }

  loadManifest(): ProjectFilesManifest {
    return readJsonFile<ProjectFilesManifest>(this.manifestFile) || { files: [] };
  }

  saveManifest(manifest: ProjectFilesManifest): void {
    writeJsonAtomic(this.manifestFile, manifest);
  }

  private projectDirectory(projectId: string): string {
    return path.join(this.projectsInputDir, projectId);
  }

  private projectTabDirectory(projectId: string): string {
    return path.join(this.projectTabCacheDir, projectId);
  }
}
