import type { IntegrationsConfig } from '../config/loadIntegrations';
import { getAuthHeader } from '../config/loadIntegrations';
import { fetchWithTimeout, safeApiError } from '../utils/fetchWithTimeout';
import { mapIssueType, isoDateFromApi } from '../utils/jiraHelpers';
import type { IssueRow } from '../types/dataset';
import { emptyDataset } from '../types/dataset';
import { deriveArea } from '../utils/deriveArea';
import { mapJiraStatus, projectFromKey, sanitizeText } from '../utils/excel';

const MAX_PAGES = 500;

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

export async function fetchJiraIssues(cfg: IntegrationsConfig['jira']): Promise<{ issues: IssueRow[]; error?: string }> {
  if (!cfg.enabled) return { issues: [] };
  const authHeader = getAuthHeader(cfg.auth);
  if (!authHeader) return { issues: [], error: 'JIRA credentials not configured' };
  const sessionHeader = jiraSessionHeader(cfg);

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
        body: JSON.stringify({ jql: cfg.jql, startAt, maxResults, fields: cfg.fields }),
      });
    } catch (err) {
      return { issues, error: `JIRA API timeout: ${(err as Error).message}` };
    }

    const data = await parseJiraResponse(res);
    if (data.error) return { issues, error: data.error };

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
    ds.files.push({ name: 'jira-api', ext: 'API', project: issues[0]?.project || 'DLM', rows: issues.length, status: 'parsed', detectedType: 'jira', source: 'jira-api' });
    ds.projects = [...new Set(issues.map((i) => i.project))];
  }
  return ds;
}
