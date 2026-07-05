import type { IntegrationsConfig } from '../config/loadIntegrations';
import { getAuthHeader } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError } from '../utils/fetchWithTimeout';
import { mapIssueType, isoDateFromApi } from '../utils/jiraHelpers';
import type { IssueRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { deriveArea } from '../utils/deriveArea';
import { mapJiraStatus, projectFromKey, sanitizeText } from '../utils/excel';

const MAX_PAGES = 500;

export async function fetchJiraIssues(cfg: IntegrationsConfig['jira']): Promise<{ issues: IssueRow[]; error?: string }> {
  if (!cfg.enabled) return { issues: [] };
  const authHeader = getAuthHeader(cfg.auth);
  if (!authHeader) return { issues: [], error: 'JIRA credentials not configured' };

  const issues: IssueRow[] = [];
  let startAt = 0;
  const maxResults = cfg.pageSize;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `${cfg.baseUrl}${cfg.searchPath}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jql: cfg.jql, startAt, maxResults, fields: cfg.fields }),
      });
    } catch (err) {
      return { issues, error: `JIRA API timeout: ${(err as Error).message}` };
    }
    if (!res.ok) {
      const body = await res.text();
      return { issues, error: safeApiError('JIRA API', res.status, body) };
    }
    const data = await res.json() as { issues?: Record<string, unknown>[]; total?: number };
    const batch = data.issues || [];
    for (const item of batch) {
      const fields = (item.fields || {}) as Record<string, unknown>;
      const key = sanitizeText(item.key);
      const issueType = mapIssueType(fields.issuetype);
      if (!key || !issueType) continue;
      const createdAt = isoDateFromApi(fields.created);
      if (!createdAt) continue;
      const summary = sanitizeText(fields.summary);
      issues.push({
        project: projectFromKey(key),
        key,
        area: deriveArea(summary),
        issueType,
        status: mapJiraStatus(sanitizeText((fields.status as { name?: string })?.name), cfg.statusDone),
        priority: sanitizeText((fields.priority as { name?: string })?.name) || 'Medium',
        assignee: sanitizeText((fields.assignee as { displayName?: string })?.displayName) || 'Unassigned',
        createdAt,
        resolvedAt: fields.resolutiondate ? isoDateFromApi(fields.resolutiondate) : null,
        updatedAt: isoDateFromApi(fields.updated) || createdAt,
        source: 'jira-api',
      });
    }
    startAt += batch.length;
    pages++;
    if (!batch.length || startAt >= (data.total || 0)) break;
  }
  if (pages >= MAX_PAGES) return { issues, error: 'JIRA API pagination limit reached' };
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
