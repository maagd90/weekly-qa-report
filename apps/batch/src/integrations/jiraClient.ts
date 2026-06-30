import type { IssueRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import type { IntegrationsConfig } from '../config/loadIntegrations';
import { getBasicAuth } from '../config/loadIntegrations';
import { deriveArea } from '../utils/deriveArea';
import { mapJiraStatus, projectFromKey, sanitizeText } from '../utils/excel';

function mapIssueType(raw: unknown): 'Story' | 'Bug' | null {
  const name = typeof raw === 'object' && raw !== null && 'name' in raw
    ? (raw as { name?: unknown }).name
    : raw;
  const t = sanitizeText(name);
  if (t === 'Story') return 'Story';
  if (t === 'Bug') return 'Bug';
  return null;
}

function isoDate(raw: unknown): string {
  if (!raw) return '1970-01-01';
  const s = String(raw);
  return s.length >= 10 ? s.slice(0, 10) : '1970-01-01';
}

export async function fetchJiraIssues(cfg: IntegrationsConfig['jira']): Promise<{ issues: IssueRow[]; error?: string }> {
  if (!cfg.enabled) return { issues: [] };
  const auth = getBasicAuth(cfg.auth);
  if (!auth) return { issues: [], error: 'JIRA credentials not configured' };

  const issues: IssueRow[] = [];
  let startAt = 0;
  const maxResults = cfg.pageSize;

  while (true) {
    const url = `${cfg.baseUrl}${cfg.searchPath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql: cfg.jql, startAt, maxResults, fields: cfg.fields }),
    });
    if (!res.ok) {
      return { issues, error: `JIRA API ${res.status}: ${await res.text()}` };
    }
    const data = await res.json() as { issues?: Record<string, unknown>[]; total?: number };
    const batch = data.issues || [];
    for (const item of batch) {
      const fields = (item.fields || {}) as Record<string, unknown>;
      const key = sanitizeText(item.key);
      const issueType = mapIssueType(fields.issuetype);
      if (!key || !issueType) continue;
      const summary = sanitizeText(fields.summary);
      issues.push({
        project: projectFromKey(key),
        key,
        area: deriveArea(summary),
        issueType,
        status: mapJiraStatus(sanitizeText((fields.status as { name?: string })?.name), cfg.statusDone),
        priority: sanitizeText((fields.priority as { name?: string })?.name) || 'Medium',
        assignee: sanitizeText((fields.assignee as { displayName?: string })?.displayName) || 'Unassigned',
        createdAt: isoDate(fields.created),
        resolvedAt: fields.resolutiondate ? isoDate(fields.resolutiondate) : null,
        updatedAt: isoDate(fields.updated),
        source: 'jira-api',
      });
    }
    startAt += batch.length;
    if (!batch.length || startAt >= (data.total || 0)) break;
  }

  return { issues };
}

export async function fetchJiraDataset(cfg: IntegrationsConfig) {
  const ds = emptyDataset();
  const { issues, error } = await fetchJiraIssues(cfg.jira);
  ds.issues = issues;
  ds.meta.integrations.jira = true;
  ds.meta.fetchedAt = new Date().toISOString();
  if (error) ds.meta.warnings.push(error);
  if (issues.length) {
    ds.files.push({
      name: 'jira-api',
      ext: 'API',
      project: issues[0]?.project || 'DLM',
      rows: issues.length,
      status: 'parsed',
      detectedType: 'jira',
      source: 'jira-api',
    });
    ds.projects = [...new Set(issues.map((i) => i.project))];
  }
  return ds;
}
