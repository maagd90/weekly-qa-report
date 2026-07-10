import axios from 'axios';
import { getJiraConnections, getQmetryConnections } from './api';

export interface LegacyInputFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface LegacyFilesResult {
  files: LegacyInputFile[];
  count: number;
  hasLegacyOutput: boolean;
  hasLegacyLiveCache?: boolean;
  rowCounts: { executions: number; issues: number; uat: number };
}

export interface LegacyMigrationResult {
  ok: boolean;
  project: string;
  migrated: string[];
  sourceProjects?: string[];
  rowCounts: { executions: number; issues: number; uat: number };
  removedLegacyOutputs?: string[];
  warnings?: string[];
  error?: string;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || err.message || 'Legacy data migration failed';
  }
  return err instanceof Error ? err.message : 'Legacy data migration failed';
}

function connectionHeaders(): Record<string, string> {
  const connections = { jira: getJiraConnections(), qmetry: getQmetryConnections() };
  return connections.jira.length || connections.qmetry.length
    ? { 'x-user-connections': JSON.stringify(connections) }
    : {};
}

export const legacyMigrationApi = {
  list: () => axios.get<LegacyFilesResult>('/api/input/legacy-files').then((response) => response.data),
  migrate: (project: string) => axios.post<LegacyMigrationResult>('/api/input/migrate-legacy', { project }, {
    timeout: 180_000,
    headers: connectionHeaders(),
  })
    .then((response) => response.data)
    .catch((err) => { throw new Error(errorMessage(err)); }),
};
