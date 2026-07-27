import crypto from 'crypto';
import path from 'path';
import {
  canonicalProjectKey,
  normalizeProjectPrimaryKey,
  normalizeSourceProjectKey,
  projectSourceKeys,
  readJsonFile,
} from 'qa-dashboard-batch';
import type { CanonicalProjectKey, RuntimePaths, SourceProjectKey } from 'qa-dashboard-batch';
import { now, unique, writeJsonAtomic } from './shared';
import type {
  DedicatedTabInput,
  ProjectCapabilities,
  ProjectRecord,
  ProjectRegistryFile,
  ProjectTabConfig,
} from './types';

function normalizeSourceKeys(primaryKey: CanonicalProjectKey, values?: string[], previousPrimaryKey?: CanonicalProjectKey): SourceProjectKey[] {
  const primaryAsSourceKey = primaryKey as unknown as SourceProjectKey;
  const previousAsSourceKey = previousPrimaryKey as unknown as SourceProjectKey | undefined;
  const aliases = (values || [])
    .map(normalizeSourceProjectKey)
    .filter((key) => key && key !== 'ALL' && key !== previousAsSourceKey && key !== primaryAsSourceKey);
  return [primaryAsSourceKey, ...unique(aliases).sort()];
}

function inferredCapabilities(project: Pick<ProjectRecord, 'key' | 'sourceKeys'>): ProjectCapabilities {
  const sourceKeys = new Set(projectSourceKeys(project));
  return {
    vendorPortal: project.key === ('DLM' as CanonicalProjectKey),
    wonderMilesExport: project.key === ('DTTRV' as CanonicalProjectKey)
      || sourceKeys.has('DP' as SourceProjectKey)
      || sourceKeys.has('DTTRV' as SourceProjectKey),
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

/**
 * Owns the project registry file: the CRUD lifecycle and invariants of
 * `ProjectRecord`s (keys, source keys, capabilities, dedicated tabs). Does
 * not know about staged files, sync reports, or dataset caches - those are
 * the responsibility of `ImportFileManager` and `SyncReportStore`, wired
 * together by the `ProjectImportStore` facade.
 */
export class ProjectRegistry {
  private readonly projectsFile: string;

  constructor(paths: RuntimePaths) {
    this.projectsFile = path.join(paths.configDir, 'projects.json');
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
      const keyAsSourceKey = key as unknown as SourceProjectKey;
      if (!key || key === 'all' || existing.has(keyAsSourceKey)) continue;
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
      existing.set(keyAsSourceKey, project);
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
  }): { previous: ProjectRecord; updated: ProjectRecord } {
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
    return { previous: current, updated };
  }

  /** Replaces one project record in place (e.g. after a tab mapping change). */
  replaceProject(project: ProjectRecord): void {
    const projects = this.listProjects();
    const index = projects.findIndex((candidate) => candidate.id === project.id);
    if (index < 0) throw new Error('Project not found.');
    projects[index] = project;
    this.saveProjects(projects);
  }

  /** Validates the typed deletion confirmation and returns the project if it matches. */
  verifyDeletionConfirmation(projectId: string, confirmationKey?: string): ProjectRecord {
    const project = this.getProject(projectId);
    if (normalizeProjectPrimaryKey(confirmationKey) !== project.key) {
      throw new Error(`Project deletion confirmation must match project key ${project.key}.`);
    }
    return project;
  }

  removeProject(projectId: string): void {
    this.saveProjects(this.listProjects().filter((candidate) => candidate.id !== projectId));
  }

  private saveProjects(projects: ProjectRecord[]): void {
    writeJsonAtomic(this.projectsFile, { projects });
  }
}
