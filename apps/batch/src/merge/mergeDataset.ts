import type { Dataset, ExecutionRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';

function pickNewer<T extends { updatedAt?: string | null }>(a: T, b: T): T {
  const da = a.updatedAt || '';
  const db = b.updatedAt || '';
  return db >= da ? b : a;
}

function executionIdentity(row: ExecutionRow): string {
  const caseKey = row.caseKey || 'NO_CASE_KEY';
  const cycleKey = row.cycleKey || 'NO_CYCLE_KEY';
  const tester = row.tester || 'NO_TESTER';

  // Test execution exports are frequently uploaded again as the week progresses.
  // Keep one latest row per test case + cycle, instead of counting the same case again
  // just because it came from another upload or has a newer execution date.
  if (row.caseKey && row.cycleKey) return `${row.project}|${caseKey}|${cycleKey}`;

  return `${row.project}|${caseKey}|${cycleKey}|${tester}|${row.executedAt || ''}`;
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
      const key = executionIdentity(e);
      const existing = execMap.get(key);
      execMap.set(key, existing ? pickNewer(existing, e) : e);
    }
    for (const i of part.issues) {
      projectSet.add(i.project);
      const existing = issueMap.get(i.key);
      issueMap.set(i.key, existing ? pickNewer(existing, i) : i);
    }
    for (const u of part.uat) {
      projectSet.add(u.project);
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
  base.meta.sourceFiles = [...new Set(sourceFiles)];
  base.meta.parsedAt = new Date().toISOString();
  return base;
}
