import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Dataset } from '../types/dataset';
import { loadIntegrations } from '../config/loadIntegrations';
import { fetchJiraDataset } from '../integrations/jiraClient';
import { fetchQmetryDataset } from '../integrations/qmetryClient';
import { parseAllFiles, discoverInputFiles } from '../parse/dispatcher';
import { mergeDatasets } from '../merge/mergeDataset';

export async function buildDataset(inputDir: string, configDir: string): Promise<Dataset> {
  const cfg = loadIntegrations(configDir);
  const parts: Dataset[] = [];

  if (cfg.jira.enabled) parts.push(await fetchJiraDataset(cfg));
  if (cfg.qmetry.enabled) parts.push(await fetchQmetryDataset(cfg));

  const files = discoverInputFiles(inputDir);
  if (files.length) parts.push(parseAllFiles(files));

  return mergeDatasets(parts);
}

export function computeFingerprint(inputDir: string, configDir: string): string {
  const parts: string[] = [];
  const intFile = path.join(configDir, 'integrations.json');
  if (fs.existsSync(intFile)) {
    const st = fs.statSync(intFile);
    parts.push(`int:${st.mtimeMs}`);
  }
  parts.push(JSON.stringify(loadIntegrations(configDir)));
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
