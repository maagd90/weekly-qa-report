import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Dataset } from '../types/dataset';
import type { UserConnections } from '../types/connections';
import { emptyDataset } from '../types/dataset';
import { loadIntegrations, jiraConfigFromConnection, qmetryConfigFromConnection } from '../config/loadIntegrations';
import { fetchJiraDataset, fetchJiraIssues } from '../integrations/jiraClient';
import { fetchQmetryDataset, fetchQmetryExecutions } from '../integrations/qmetryClient';
import { parseAllFiles, discoverInputFiles } from '../parse/dispatcher';
import { mergeDatasets } from '../merge/mergeDataset';

async function buildJiraConnectionDataset(configDir: string, connections?: UserConnections): Promise<Dataset[]> {
  const parts: Dataset[] = [];
  if (connections?.jira?.length) {
    for (const conn of connections.jira) {
      const jiraCfg = jiraConfigFromConnection(conn);
      const { issues, error } = await fetchJiraIssues(jiraCfg);
      const ds = emptyDataset();
      ds.issues = issues;
      ds.meta.integrations.jira = true;
      ds.meta.fetchedAt = new Date().toISOString();
      if (error) ds.meta.warnings.push(`[${conn.name}] ${error}`);
      if (issues.length) {
        ds.files.push({
          name: `jira-api:${conn.name}`,
          ext: 'API',
          project: issues[0]?.project || conn.projectKeys?.[0] || 'UNKNOWN',
          rows: issues.length,
          status: 'parsed',
          detectedType: 'jira',
          source: 'jira-api',
        });
        ds.projects = [...new Set(issues.map((i) => i.project))];
      }
      parts.push(ds);
    }
  } else {
    const cfg = loadIntegrations(configDir);
    if (cfg.jira.enabled) parts.push(await fetchJiraDataset(cfg));
  }
  return parts;
}

async function buildQmetryConnectionDataset(configDir: string, connections?: UserConnections): Promise<Dataset[]> {
  const parts: Dataset[] = [];
  if (connections?.qmetry?.length) {
    for (const conn of connections.qmetry) {
      const qmetryCfg = qmetryConfigFromConnection(conn);
      const { executions, error } = await fetchQmetryExecutions(qmetryCfg);
      const ds = emptyDataset();
      ds.executions = executions;
      ds.meta.integrations.qmetry = true;
      ds.meta.fetchedAt = new Date().toISOString();
      if (error) ds.meta.warnings.push(`[${conn.name}] ${error}`);
      if (executions.length) {
        ds.files.push({
          name: `qmetry-api:${conn.name}`,
          ext: 'API',
          project: executions[0]?.project || conn.projectKey,
          rows: executions.length,
          status: 'parsed',
          detectedType: 'zephyr',
          source: 'qmetry-api',
        });
        ds.projects = [...new Set(executions.map((e) => e.project))];
      }
      parts.push(ds);
    }
  } else {
    const cfg = loadIntegrations(configDir);
    if (cfg.qmetry.enabled) parts.push(await fetchQmetryDataset(cfg));
  }
  return parts;
}

export async function buildDataset(inputDir: string, configDir: string, connections?: UserConnections): Promise<Dataset> {
  const parts: Dataset[] = [
    ...(await buildJiraConnectionDataset(configDir, connections)),
    ...(await buildQmetryConnectionDataset(configDir, connections)),
  ];
  const files = discoverInputFiles(inputDir);
  if (files.length) parts.push(parseAllFiles(files));
  return mergeDatasets(parts);
}

export function computeFingerprint(inputDir: string, configDir: string, connections?: UserConnections): string {
  const parts: string[] = [];
  const intFile = path.join(configDir, 'integrations.json');
  if (fs.existsSync(intFile)) parts.push(`int:${fs.statSync(intFile).mtimeMs}`);
  parts.push(JSON.stringify(loadIntegrations(configDir)));
  parts.push(`conn:${JSON.stringify(connections || {})}`);
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
  fs.writeFileSync(path.join(outputDir, 'dataset-fingerprint.json'), JSON.stringify({ fingerprint, savedAt: new Date().toISOString() }, null, 2));
}

export function loadRawDataset(outputDir: string): Dataset | null {
  const file = path.join(outputDir, 'raw-dataset.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Dataset;
}

export function loadFingerprint(outputDir: string): string | null {
  const file = path.join(outputDir, 'dataset-fingerprint.json');
  if (!fs.existsSync(file)) return null;
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { fingerprint: string }).fingerprint;
}
