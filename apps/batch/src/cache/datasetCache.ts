import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ApiFetchScope, Dataset } from '../types/dataset';
import type { UserConnections } from '../types/connections';
import { emptyDataset } from '../types/dataset';
import { loadIntegrations, jiraConfigFromConnection, qmetryConfigFromConnection, configuredJiraProfiles } from '../config/loadIntegrations';
import { fetchJiraDataset, fetchJiraIssues } from '../integrations/jiraClient';
import { fetchQmetryDataset, fetchQmetryExecutions } from '../integrations/qmetryClient';
import { parseAllFiles, discoverInputFiles } from '../parse/dispatcher';
import { mergeDatasets } from '../merge/mergeDataset';
import { canonicalProjectKey, canonicalProjectOrUndefined } from '../projects/projectKey';

export interface BuildDatasetOptions {
  apiScope?: ApiFetchScope;
  liveSync?: boolean;
  includeFiles?: boolean;
}

function cleanApiScope(scope?: ApiFetchScope): ApiFetchScope | undefined {
  if (!scope) return undefined;
  const next: ApiFetchScope = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(scope.startDate || '')) next.startDate = scope.startDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(scope.endDate || '')) next.endDate = scope.endDate;
  const project = canonicalProjectOrUndefined(scope.project);
  if (project) next.project = project;
  return next.startDate || next.endDate || next.project ? next : undefined;
}

function liveSyncEnabled(options?: BuildDatasetOptions): boolean {
  return options?.liveSync !== false;
}

function jiraProjectMatches(keys: string[] | undefined, scope?: ApiFetchScope): boolean {
  const selected = canonicalProjectOrUndefined(scope?.project);
  if (!selected) return true;
  return (keys || []).some((key) => canonicalProjectKey(key) === selected);
}

function qmetryProjectMatches(key: string | undefined, scope?: ApiFetchScope): boolean {
  const selected = canonicalProjectOrUndefined(scope?.project);
  if (!selected) return true;
  return canonicalProjectKey(key) === selected;
}

async function buildJiraConnectionDataset(configDir: string, connections?: UserConnections, options?: BuildDatasetOptions): Promise<Dataset[]> {
  const parts: Dataset[] = [];
  const apiScope = cleanApiScope(options?.apiScope);
  if (!liveSyncEnabled(options)) return parts;
  if (connections?.jira?.length) {
    for (const conn of connections.jira) {
      if (conn.enabled === false || conn.syncIssues === false) continue;
      if (!jiraProjectMatches(conn.projectKeys, apiScope)) continue;
      const jiraCfg = jiraConfigFromConnection(conn);
      const { issues, error, jql } = await fetchJiraIssues(jiraCfg, apiScope);
      const ds = emptyDataset();
      ds.issues = issues;
      ds.meta.integrations.jira = true;
      ds.meta.fetchedAt = new Date().toISOString();
      if (error) ds.meta.warnings.push(`[${conn.name}] ${error}`);
      if (apiScope?.startDate || apiScope?.endDate) ds.meta.sourceFiles.push(`jira-api:${conn.name}:overview-date-search:${apiScope.startDate || 'any'}:${apiScope.endDate || 'any'}`);
      if (jql && (apiScope?.startDate || apiScope?.endDate)) ds.meta.warnings.push(`[${conn.name}] JIRA API date search applied from selected dates.`);
      if (issues.length) {
        ds.files.push({ name: `jira-api:${conn.name}`, ext: 'API', project: issues[0]?.project || conn.projectKeys?.[0] || 'UNKNOWN', rows: issues.length, status: 'parsed', detectedType: 'jira', source: 'jira-api' });
        ds.projects = [...new Set(issues.map((i) => canonicalProjectKey(i.project)))];
      }
      parts.push(ds);
    }
  } else {
    const cfg = loadIntegrations(configDir);
    const profiles = configuredJiraProfiles(cfg);
    for (const profile of profiles) {
      if (!jiraProjectMatches(profile.projectKeys, apiScope)) continue;
      parts.push(await fetchJiraDataset({ ...cfg, jira: profile }, apiScope));
    }
  }
  return parts;
}

async function buildQmetryConnectionDataset(configDir: string, connections?: UserConnections, options?: BuildDatasetOptions): Promise<Dataset[]> {
  const parts: Dataset[] = [];
  const apiScope = cleanApiScope(options?.apiScope);
  if (!liveSyncEnabled(options)) return parts;
  if (connections?.qmetry?.length) {
    for (const conn of connections.qmetry) {
      if (conn.enabled === false || conn.syncExecutions === false) continue;
      if (!qmetryProjectMatches(conn.projectKey, apiScope)) continue;
      const qmetryCfg = qmetryConfigFromConnection(conn);
      const { executions, error } = await fetchQmetryExecutions(qmetryCfg, apiScope);
      const ds = emptyDataset();
      ds.executions = executions;
      ds.meta.integrations.qmetry = true;
      ds.meta.fetchedAt = new Date().toISOString();
      if (error) ds.meta.warnings.push(`[${conn.name}] ${error}`);
      if (apiScope?.startDate || apiScope?.endDate) ds.meta.sourceFiles.push(`qmetry-api:${conn.name}:overview-date-search:${apiScope.startDate || 'any'}:${apiScope.endDate || 'any'}`);
      if (executions.length) {
        ds.files.push({ name: `qmetry-api:${conn.name}`, ext: 'API', project: executions[0]?.project || conn.projectKey, rows: executions.length, status: 'parsed', detectedType: 'test-execution', source: 'qmetry-api' });
        ds.projects = [...new Set(executions.map((e) => canonicalProjectKey(e.project)))];
      }
      parts.push(ds);
    }
  } else {
    const cfg = loadIntegrations(configDir);
    if (cfg.qmetry.enabled && qmetryProjectMatches(cfg.qmetry.projectKey, apiScope)) parts.push(await fetchQmetryDataset(cfg, apiScope));
  }
  return parts;
}

export async function buildDataset(inputDir: string, configDir: string, connections?: UserConnections, options?: BuildDatasetOptions): Promise<Dataset> {
  const parts: Dataset[] = [
    ...(await buildJiraConnectionDataset(configDir, connections, options)),
    ...(await buildQmetryConnectionDataset(configDir, connections, options)),
  ];
  if (options?.includeFiles !== false) {
    const files = discoverInputFiles(inputDir);
    if (files.length) parts.push(parseAllFiles(files));
  }
  return mergeDatasets(parts);
}

export function computeFingerprint(inputDir: string, configDir: string, connections?: UserConnections, options?: BuildDatasetOptions): string {
  const parts: string[] = [];
  const intFile = path.join(configDir, 'integrations.json');
  if (fs.existsSync(intFile)) parts.push(`int:${fs.statSync(intFile).mtimeMs}`);
  parts.push(JSON.stringify(loadIntegrations(configDir)));
  parts.push(`conn:${JSON.stringify(connections || {})}`);
  parts.push(`apiScope:${JSON.stringify(cleanApiScope(options?.apiScope) || {})}`);
  parts.push(`liveSync:${liveSyncEnabled(options)}`);
  parts.push(`includeFiles:${options?.includeFiles !== false}`);
  if (fs.existsSync(inputDir)) {
    for (const f of fs.readdirSync(inputDir).sort()) {
      if (f.startsWith('.')) continue;
      const p = path.join(inputDir, f);
      if (fs.statSync(p).isFile()) parts.push(`${f}:${fs.statSync(p).mtimeMs}`);
    }
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export function saveRawDataset(outputDir: string, dataset: Dataset, fingerprint: string) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'raw-dataset.json'), JSON.stringify(dataset, null, 2));
  fs.writeFileSync(path.join(outputDir, 'dataset-fingerprint.txt'), fingerprint);
}

export function loadRawDataset(outputDir: string): Dataset | null {
  const file = path.join(outputDir, 'raw-dataset.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Dataset;
}

export function loadFingerprint(outputDir: string): string | null {
  const file = path.join(outputDir, 'dataset-fingerprint.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
