import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { dedupeDataset } from './dedupeDataset';

export function mergeDatasets(parts: Dataset[]): Dataset {
  const base = emptyDataset();
  if (!parts.length) return base;

  const projectSet = new Set<string>();
  const files = [...base.files];
  const warnings: string[] = [];
  const sourceFiles: string[] = [];

  for (const part of parts) {
    base.executions.push(...part.executions);
    base.issues.push(...part.issues);
    base.uat.push(...part.uat);
    warnings.push(...part.meta.warnings);
    sourceFiles.push(...part.meta.sourceFiles);
    files.push(...part.files);
    for (const p of part.projects) projectSet.add(p);
    if (part.meta.integrations.jira) base.meta.integrations.jira = true;
    if (part.meta.integrations.qmetry) base.meta.integrations.qmetry = true;
    if (part.meta.fetchedAt) base.meta.fetchedAt = part.meta.fetchedAt;
  }

  base.projects = [...projectSet].sort();
  base.files = files;
  base.meta.warnings = warnings;
  base.meta.sourceFiles = [...new Set(sourceFiles)];
  base.meta.parsedAt = new Date().toISOString();
  return dedupeDataset(base);
}
