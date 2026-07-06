import type { IntegrationsConfig } from '../config/loadIntegrations';
import { getAuthHeader } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError, describeFetchError } from '../utils/fetchWithTimeout';
import { mapIssueType, isoDateFromApi } from '../utils/jiraHelpers';
import type { IssueRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { deriveArea } from '../utils/deriveArea';
import { mapJiraStatus, projectFromKey, sanitizeText } from '../utils/excel';

const MAX_PAGES = 500;

export interface JiraSearchScope {
  startDate?: string;
  endDate?: string;
  project?: string;
}

function cleanHeaderValue(value: string): string {
  return value.replace(/^Cookie:\s*/i, '').trim();
}

function jiraSessionHeader(cfg: IntegrationsConfig['jira']): string | null {
  const uiFull = cfg.cookie;
  const envFull = process.env.JIRA_SESSION_HEADER || process.env.JIRA_COOKIE;
  const full = uiFull || envFull;
  if (full?.trim()) return cleanHeaderValue(full);

  const sessionId = cfg.jiraSessionId?.trim() || process.env.JIRA_SESSION_ID?.trim();
  const xsrf = cfg.jiraXsrfToken?.trim() || process.env.JIRA_XSRF_TOKEN?.trim() || process.env.ATLASSIAN_XSRF_TOKEN?.trim();
  const parts: string[] = [];
  if (sessionId) parts.push(`JSESSIONID=${sessionId}`);
  if (xsrf) parts.push(`atlassian.xsrf.token=${xsrf}`);
  return parts.length ? parts.join('; ') : null;
}

function snippet(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function splitOrderBy(jql: string): { base: string; orderBy: string } {
  const match = jql.match(/\s+ORDER\s+BY\s+[\s\S]*$/i);
  if (!match || match.index === undefined) return { base: jql.trim(), orderBy: '' };
  return { base: jql.slice(0, match.index).trim(), orderBy: match[0].trim() };
}

function quoteJqlDate(date: string, endOfDay = false): string {
  const clean = date.slice(0, 10);
  return endOfDay ? `"${clean} 23:59"` : `"${clean}"`;
}

function normalizeProjectKey(project?: string): string | null {
  const clean = (project || '').trim();
  if (!clean || clean === 'all') return null;
  return /^[A-Z][A-Z0-9_]*$/i.test(clean) ? clean.toUpperCase() : null;
}

function scopedJql(originalJql: string, scope?: JiraSearchScope): string {
  const conditions: string[] = [];
  const project = normalizeProjectKey(scope?.project);
  if (project) conditions.push(`project = ${project}`);
  if (scope?.startDate && scope?.endDate) {
    conditions.push(`updated >= ${quoteJqlDate(scope.startDate)} AND updated <= ${quoteJqlDate(scope.endDate, true)}`);
  }
  if (!conditions.length) return originalJql;

  const { base, orderBy } = splitOrderBy(originalJql || 'ORDER BY updated DESC');
  const scoped = `${base ? `(${base}) AND ` : ''}${conditions.map((c) => `(${c})`).join(' AND ')}`;
  return orderBy ? `${scoped} ${orderBy}` : `${scoped} ORDER BY updated DESC`;
}

async function parseJiraResponse(res: Response): Promise<{ issues?: Record<string, unknown>[]; total?: number; error?: string }> {
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();
  if (!res.ok) return { error: safeApiError('JIRA API', res.status, body) };
  if (!contentType.toLowerCase().includes('application/json')) {
    return { error: `JIRA returned ${contentType || 'non-JSON'} instead of JSON. This usually means the API request was redirected to the login page or blocked by SSO/proxy. Final URL: ${res.url}. Preview: ${snippet(body)}` };
  }
  try {
    return JSON.parse(body) as { issues?: Record<string, unknown>[]; total?: number };
  } catch (err) {
    return { error: `JIRA returned invalid JSON: ${(err as Error).message}. Preview: ${snippet(body)}` };
  }
}

export async function fetchJiraIssues(cfg: IntegrationsConfig['jira'], scope?: JiraSearchScope): Promise<{ issues: IssueRow[]; error?: string; jql?: string }> {
  if (!cfg.enabled) return { issues: [] };
  const authHeader = getAuthHeader(cfg.auth);
  if (!authHeader) return { issues: [], error: 'JIRA credentials not configured' };
  const sessionHeader = jiraSessionHeader(cfg);
  const jql = scopedJql(cfg.jql, scope);

  const issues: IssueRow[] = [];
  let startAt = 0;
  const maxResults = cfg.pageSize;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `${cfg.baseUrl}${cfg.searchPath}`;
    let res: Response;
    try {
      const headers: Record<string, string> = {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (sessionHeader) headers.Cookie = sessionHeader;
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jql, startAt, maxResults, fields: cfg.fields }),
      });
    } catch (err) {
      return { issues, error: `JIRA API request failed: ${describeFetchError(err)}`, jql };
    }

    const data = await parseJiraResponse(res);
    if (data.error) return { issues, error: data.error, jql };

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
  if (pages >= MAX_PAGES) return { issues, error: 'JIRA API pagination limit reached', jql };
  return { issues, jql };
}

export async function fetchJiraDataset(cfg: IntegrationsConfig, scope?: JiraSearchScope) {
  const ds = emptyDataset();
  const { issues, error } = await fetchJiraIssues(cfg.jira, scope);
  ds.issues = issues;
  ds.meta.integrations.jira = true;
  ds.meta.fetchedAt = new Date().toISOString();
  if (error) ds.meta.warnings.push(error);
  if (issues.length) {
    ds.files.push({ name: 'jira-api', ext: 'API', project: issues[0]?.project || 'DLM', rows: issues.length, status: 'parsed', detectedType: 'jira', source: 'jira-api' });
    ds.projects = [...new Set(issues.map((i) => i.project))];
  }
  return ds;
}
