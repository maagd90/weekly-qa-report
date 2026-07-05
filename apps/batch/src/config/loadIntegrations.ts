import fs from 'fs';
import path from 'path';
import type { JiraConnectionInput, QmetryConnectionInput } from '../types/connections';

const JIRA_SEARCH_PATH = '/rest/api/2/search';

export interface BasicAuthConfig {
  type: 'basic' | 'bearer';
  emailEnv?: string;
  tokenEnv?: string;
  email?: string;
  username?: string;
  token?: string;
}

export interface JiraIntegrationConfig {
  enabled: boolean;
  name?: string;
  deploymentType?: 'cloud' | 'on-prem';
  baseUrl: string;
  searchPath: string;
  auth: BasicAuthConfig;
  projectKeys: string[];
  jql: string;
  pageSize: number;
  fields: string[];
  statusDone: string[];
  applicationCiFieldId: string | null;
}

export interface QmetryIntegrationConfig {
  enabled: boolean;
  baseUrl: string;
  apiPrefix: string;
  auth: BasicAuthConfig;
  authEncodedEnv: string;
  projectKey: string;
  projectId: string | null;
  testCyclesSearchPath: string | null;
  testCyclesSearchBody: Record<string, unknown> | null;
  testCasesSearchPath: string;
  testCasesSearchBody: Record<string, unknown> | null;
  usePostSearch: boolean;
  testCaseFields: string;
  cycleIds: string[];
  pageSize: number;
  maxPages: number;
}

export interface IntegrationsConfig {
  jira: JiraIntegrationConfig;
  jiraProfiles: JiraIntegrationConfig[];
  qmetry: QmetryIntegrationConfig;
}

const DEFAULT_JIRA: JiraIntegrationConfig = {
  enabled: false,
  name: 'Default JIRA',
  deploymentType: 'on-prem',
  baseUrl: '',
  searchPath: JIRA_SEARCH_PATH,
  auth: { type: 'basic', emailEnv: 'JIRA_EMAIL', tokenEnv: 'JIRA_API_TOKEN' },
  projectKeys: ['DLM'],
  jql: 'project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC',
  pageSize: 100,
  fields: ['summary', 'issuetype', 'status', 'priority', 'assignee', 'created', 'updated', 'resolutiondate'],
  statusDone: ['Done', 'CLOSED', 'Cancel'],
  applicationCiFieldId: null,
};

const DEFAULTS: IntegrationsConfig = {
  jira: DEFAULT_JIRA,
  jiraProfiles: [],
  qmetry: {
    enabled: false,
    baseUrl: '',
    apiPrefix: '/rest/qtm4j/ui/latest',
    auth: { type: 'basic', emailEnv: 'JIRA_EMAIL', tokenEnv: 'JIRA_API_TOKEN' },
    authEncodedEnv: 'QMETRY_BASIC_AUTH',
    projectKey: 'DLM',
    projectId: null,
    testCyclesSearchPath: '/projects/{projectId}/testcycles/search',
    testCyclesSearchBody: null,
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCasesSearchBody: { filter: { filter: { folderId: -1 } } },
    usePostSearch: true,
    testCaseFields: 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedOn,executedBy,lastModified,build',
    cycleIds: [],
    pageSize: 50,
    maxPages: 200,
  },
};

function mergeJira(raw: Partial<JiraIntegrationConfig> | undefined, idx = 0): JiraIntegrationConfig {
  const cfg = { ...DEFAULT_JIRA, ...(raw || {}) };
  return { ...cfg, name: cfg.name || `JIRA ${idx + 1}`, searchPath: cfg.searchPath || JIRA_SEARCH_PATH };
}

export function loadIntegrations(configDir: string): IntegrationsConfig {
  const file = path.join(configDir, 'integrations.json');
  if (!fs.existsSync(file)) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      jira: mergeJira(raw.jira),
      jiraProfiles: Array.isArray(raw.jiraProfiles) ? raw.jiraProfiles.map((p: Partial<JiraIntegrationConfig>, i: number) => mergeJira(p, i)) : [],
      qmetry: { ...DEFAULTS.qmetry, ...raw.qmetry },
    };
  } catch (err) {
    console.error('[integrations] Failed to parse integrations.json:', (err as Error).message);
    return structuredClone(DEFAULTS);
  }
}

function configuredUser(cfg: BasicAuthConfig): string | undefined {
  return cfg.email || cfg.username || (cfg.emailEnv ? process.env[cfg.emailEnv] : undefined);
}

function configuredSecret(cfg: BasicAuthConfig): string | undefined {
  return cfg.token || (cfg.tokenEnv ? process.env[cfg.tokenEnv] : undefined);
}

function normalizeAuthorizationHeader(secret: string | undefined): string | null {
  const token = (secret || '').trim();
  if (!token) return null;
  if (/^(basic|bearer)\s+/i.test(token)) return token;
  return null;
}

export function getBasicAuth(cfg: BasicAuthConfig): string | null {
  const directHeader = normalizeAuthorizationHeader(configuredSecret(cfg));
  if (directHeader?.toLowerCase().startsWith('basic ')) return directHeader.slice(6).trim();
  const user = configuredUser(cfg);
  const secret = configuredSecret(cfg);
  if (!user && secret && /^[A-Za-z0-9+/=]+$/.test(secret.trim())) return secret.trim();
  if (!user || !secret) return null;
  return Buffer.from(`${user}:${secret}`).toString('base64');
}

export function getAuthHeader(cfg: BasicAuthConfig): string | null {
  const secret = configuredSecret(cfg);
  const directHeader = normalizeAuthorizationHeader(secret);
  if (directHeader) return directHeader;
  if (cfg.type === 'bearer') return secret ? `Bearer ${secret.trim()}` : null;
  const basic = getBasicAuth(cfg);
  return basic ? `Basic ${basic}` : null;
}

function connectionSecret(conn: { apiToken?: string; credential?: string }): string {
  return conn.apiToken || conn.credential || '';
}

export function jiraConfigFromConnection(conn: JiraConnectionInput): JiraIntegrationConfig {
  const projectKeys = conn.projectKeys?.filter(Boolean) || [];
  const jql = conn.jql?.trim() || (projectKeys.length ? `project in (${projectKeys.join(',')}) AND issuetype in (Story, Bug) ORDER BY updated DESC` : 'issuetype in (Story, Bug) ORDER BY updated DESC');
  const deploymentType = conn.deploymentType || 'cloud';
  return {
    ...DEFAULT_JIRA,
    enabled: true,
    name: conn.name,
    deploymentType,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    searchPath: conn.searchPath?.trim() || JIRA_SEARCH_PATH,
    auth: { type: conn.authType || 'basic', email: conn.email, username: conn.username, token: connectionSecret(conn) },
    projectKeys,
    jql,
    applicationCiFieldId: conn.applicationCiFieldId || null,
  };
}

export function qmetryConfigFromConnection(conn: QmetryConnectionInput): QmetryIntegrationConfig {
  return {
    ...DEFAULTS.qmetry,
    enabled: true,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    auth: { type: 'basic', email: conn.email, token: connectionSecret(conn) },
    authEncodedEnv: '',
    projectKey: conn.projectKey,
    projectId: conn.projectId || null,
    cycleIds: conn.cycleIds?.filter(Boolean) || [],
    testCasesSearchBody: conn.folderId ? { filter: { filter: { folderId: conn.folderId } } } : DEFAULTS.qmetry.testCasesSearchBody,
  };
}

export function getEncodedAuth(envKey: string): string | null {
  const val = process.env[envKey];
  return val ? val.trim() : null;
}

export function configuredJiraProfiles(cfg: IntegrationsConfig): JiraIntegrationConfig[] {
  return cfg.jiraProfiles.length ? cfg.jiraProfiles.filter((p) => p.enabled) : (cfg.jira.enabled ? [cfg.jira] : []);
}

export function integrationsSummary(configDir: string) {
  const cfg = loadIntegrations(configDir);
  const profiles = configuredJiraProfiles(cfg);
  const hasAuth = !!getBasicAuth(cfg.qmetry.auth) || !!getEncodedAuth(cfg.qmetry.authEncodedEnv);
  return {
    jira: { enabled: profiles.length > 0, baseUrl: profiles.map((p) => p.baseUrl).filter(Boolean).join(', '), configured: profiles.some((p) => !!getAuthHeader(p.auth)), profiles: profiles.map((p) => ({ name: p.name, deploymentType: p.deploymentType, baseUrl: p.baseUrl, projectKeys: p.projectKeys })) },
    qmetry: { enabled: cfg.qmetry.enabled, baseUrl: cfg.qmetry.baseUrl, configured: hasAuth, cycleIds: cfg.qmetry.cycleIds.length, projectId: cfg.qmetry.projectId },
  };
}
