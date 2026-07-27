import type { CanonicalProjectKey, MappedImportProfile, SourceProjectKey } from 'qa-dashboard-batch';

export interface ProjectRecord {
  id: string;
  key: CanonicalProjectKey;
  /** External JIRA/QMetry keys consolidated into this dashboard workspace. */
  sourceKeys: SourceProjectKey[];
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

export interface ProjectRegistryFile { projects: ProjectRecord[] }
export interface ProjectFilesManifest { files: ProjectFileRecord[] }
