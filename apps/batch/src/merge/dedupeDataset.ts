import type { Dataset, ExecutionRow, IssueRow, UatRow, DataSource } from '../types/dataset';
import { canonicalProjectKey } from '../projects/projectKey';

export interface DedupeStats {
  executions: number;
  issues: number;
  uat: number;
}

type AnyRow = Record<string, unknown>;

const EMPTY_STATS: DedupeStats = { executions: 0, issues: 0, uat: 0 };

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function canonicalProject(value: unknown): string {
  return canonicalProjectKey(clean(value)) || clean(value).toUpperCase() || 'UNKNOWN';
}

function sourceRank(source?: DataSource): number {
  if (source === 'qmetry' || source === 'jira-api') return 3;
  if (source === 'test-execution-file' || source === 'jira-file' || source === 'odl-file') return 1;
  return 0;
}

function dateScore(row: AnyRow): string {
  return clean(row.updatedAt) || clean(row.executedAt) || clean(row.resolvedAt) || clean(row.createdAt) || clean(row.submittedAt);
}

function looksLikeRawLogin(value: unknown): boolean {
  const s = clean(value);
  return /^s\d{5,}$/i.test(s) || /^JIRAUSER\d+$/i.test(s);
}

function completenessScore(row: AnyRow): number {
  let score = 0;
  const tester = row.tester ?? row.assignee ?? row.submitter;
  if (clean(tester)) score += 1;
  if (clean(tester) && !looksLikeRawLogin(tester)) score += 2;
  if (clean(row.area)) score += 1;
  if (clean(row.priority)) score += 1;
  if (clean(row.summary) || clean(row.subject)) score += 1;
  return score;
}

function pickWinner<T extends { source: DataSource }>(current: T, candidate: T): T {
  const sourceDelta = sourceRank(candidate.source) - sourceRank(current.source);
  if (sourceDelta > 0) return candidate;
  if (sourceDelta < 0) return current;

  const currentDate = dateScore(current as AnyRow);
  const candidateDate = dateScore(candidate as AnyRow);
  if (candidateDate > currentDate) return candidate;
  if (candidateDate < currentDate) return current;

  const completenessDelta = completenessScore(candidate as AnyRow) - completenessScore(current as AnyRow);
  if (completenessDelta > 0) return candidate;
  if (completenessDelta < 0) return current;

  return candidate;
}

function normalizeExecution(row: ExecutionRow): ExecutionRow {
  return { ...row, project: canonicalProject(row.project) };
}

function normalizeIssue(row: IssueRow): IssueRow {
  return { ...row, project: canonicalProject(row.project) };
}

function normalizeUat(row: UatRow): UatRow {
  return { ...row, project: canonicalProject(row.project) };
}

function firstValue(row: AnyRow, keys: string[]): string {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return '';
}

export function executionIdentity(row: ExecutionRow): string {
  const anyRow = row as unknown as AnyRow;
  const project = canonicalProject(row.project);
  const executionId = firstValue(anyRow, ['testCaseExecutionId', 'executionId', 'testRunId', 'runId', 'executionKey']);
  if (executionId) return `${project}|execution|${executionId}`;

  const cycle = firstValue(anyRow, ['cycleId', 'testCycleId', 'cycleKey']) || 'NO_CYCLE';
  const caseKey = clean(row.caseKey) || firstValue(anyRow, ['testCaseKey', 'issueKey']) || 'NO_CASE';
  const version = firstValue(anyRow, ['versionNo', 'version', 'testCaseVersion']) || 'NO_VERSION';
  const environment = firstValue(anyRow, ['environment', 'env']) || 'NO_ENV';

  return `${project}|cycle-case|${cycle}|${caseKey}|${version}|${environment}`;
}

export function issueIdentity(row: IssueRow): string {
  return `${canonicalProject(row.project)}|issue|${clean(row.key).toUpperCase() || 'NO_KEY'}`;
}

export function uatIdentity(row: UatRow): string {
  const anyRow = row as unknown as AnyRow;
  const project = canonicalProject(row.project);
  const id = clean(row.id) || firstValue(anyRow, ['key', 'reference', 'ticketId']);
  if (id) return `${project}|uat|${id}`;
  return `${project}|uat|${clean(row.subject).toUpperCase() || 'NO_SUBJECT'}|${clean(row.submittedAt) || clean(row.updatedAt)}`;
}

function dedupeRows<T extends { source: DataSource }>(rows: T[], identity: (row: T) => string): { rows: T[]; dropped: number } {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = identity(row);
    const existing = map.get(key);
    map.set(key, existing ? pickWinner(existing, row) : row);
  }
  return { rows: [...map.values()], dropped: rows.length - map.size };
}

export function dedupeDataset(dataset: Dataset): Dataset {
  const executions = dedupeRows(dataset.executions.map(normalizeExecution), executionIdentity);
  const issues = dedupeRows(dataset.issues.map(normalizeIssue), issueIdentity);
  const uat = dedupeRows(dataset.uat.map(normalizeUat), uatIdentity);
  const deduped: DedupeStats = {
    executions: executions.dropped,
    issues: issues.dropped,
    uat: uat.dropped,
  };
  const projects = [...new Set([
    ...dataset.projects.map(canonicalProject),
    ...executions.rows.map((r) => canonicalProject(r.project)),
    ...issues.rows.map((r) => canonicalProject(r.project)),
    ...uat.rows.map((r) => canonicalProject(r.project)),
  ].filter(Boolean))].sort();

  return {
    ...dataset,
    executions: executions.rows,
    issues: issues.rows,
    uat: uat.rows,
    projects,
    meta: {
      ...dataset.meta,
      deduped,
    },
  };
}

export function emptyDedupeStats(): DedupeStats {
  return { ...EMPTY_STATS };
}
