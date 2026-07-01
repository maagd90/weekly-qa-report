import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';

function pickNewer<T extends { updatedAt?: string | null }>(a: T, b: T): T {
  const da = a.updatedAt || '';
  const db = b.updatedAt || '';
  return db > da ? b : a;
}

export function mergeDatasets(parts: Dataset[]): Dataset {
  const base = emptyDataset();
  if (!parts.length) return base;

  const execMap = new Map<string, Dataset['executions'][0]>();
  const issueMap = new Map<string, Dataset['issues'][0]>();
  const uatMap = new Map<string, Dataset['uat'][0]>();
  const projectSet = new Set<string>();
  const files = [...base.files];
  const warnings: string[] = [];
  const sourceFiles: string[] = [];

  for (const part of parts) {
    warnings.push(...part.meta.warnings);
    sourceFiles.push(...part.meta.sourceFiles);
    files.push(...part.files);

    for (const e of part.executions) {
      projectSet.add(e.project);
      const key = `${e.caseKey}|${e.cycleKey}|${e.executedAt || ''}|${e.tester || ''}`;
      const existing = execMap.get(key);
      execMap.set(key, existing ? pickNewer(existing, e) : e);
    }
    for (const i of part.issues) {
      projectSet.add(i.project);
      const existing = issueMap.get(i.key);
      issueMap.set(i.key, existing ? pickNewer(existing, i) : i);
    }
    for (const u of part.uat) {
      const existing = uatMap.get(u.id);
      uatMap.set(u.id, existing ? pickNewer(existing, u) : u);
    }
    if (part.meta.integrations.jira) base.meta.integrations.jira = true;
    if (part.meta.integrations.qmetry) base.meta.integrations.qmetry = true;
    if (part.meta.fetchedAt) base.meta.fetchedAt = part.meta.fetchedAt;
  }

  base.executions = [...execMap.values()];
  base.issues = [...issueMap.values()];
  base.uat = [...uatMap.values()];
  base.projects = [...projectSet].sort();
  base.files = files;
  base.meta.warnings = warnings;
  base.meta.sourceFiles = sourceFiles;
  base.meta.parsedAt = new Date().toISOString();
  return base;
}
