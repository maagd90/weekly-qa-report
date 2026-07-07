import fs from 'fs';
import path from 'path';
import type { JiraConnectionInput, QmetryConnectionInput } from '../types/connections';

const JIRA_SEARCH_PATH = '/rest/api/2/search';
const QMETRY_TEST_CYCLES_SEARCH_PATH = '/testcycles/search';
const QMETRY_TEST_CASE_FIELDS = 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedBy,build';

const DEFAULT_JIRA_FIELDS = [
  'summary', 'description', 'assignee', 'status', 'priority', 'issuetype',
  'created', 'updated', 'resolution', 'resolutiondate', 'resolved', 'reporter',
  'labels', 'components', 'fixVersions', 'customfield_10020', 'customfield_10016', 'customfield_10028',
];

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
  cookie?: string;
  jiraSessionId?: string;
  jiraXsrfToken?: string;
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

interface RuntimeConfig {
  jira?: {
    enabled?: boolean;
    deploymentType?: 'cloud' | 'on-prem';
    baseUrl?: string;
    searchPath?: string;
    email?: string;
    apiToken?: string;
    onPremSecret?: string;
    sessionHeader?: string;
    sessionId?: string;
    xsrfToken?: string;
    projectKeys?: string[];
    jql?: string;
    applicationCiFieldId?: string;
  };
  qmetry?: {
    enabled?: boolean;
    baseUrl?: string;
    apiPrefix?: string;
    basicAuth?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
    projectId?: string;
    folderId?: string;
  };
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
  fields: DEFAULT_JIRA_FIELDS,
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
    testCyclesSearchPath: QMETRY_TEST_CYCLES_SEARCH_PATH,
    testCyclesSearchBody: null,
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCasesSearchBody: null,
    usePostSearch: true,
    testCaseFields: QMETRY_TEST_CASE_FIELDS,
    cycleIds: [],
    pageSize: 50,
    maxPages: 200,
  },
};

function mergeJira(raw: Partial<JiraIntegrationConfig> | undefined, idx = 0): JiraIntegrationConfig {
  const cfg = { ...DEFAULT_JIRA, ...(raw || {}) };
  return { ...cfg, name: cfg.name || `JIRA ${idx + 1}`, searchPath: cfg.searchPath || JIRA_SEARCH_PATH, fields: cfg.fields?.length ? cfg.fields : DEFAULT_JIRA_FIELDS };
}

function cleanQmetryTestCaseFields(fields?: string): string {
  const values = (fields || QMETRY_TEST_CASE_FIELDS).split(',').map((f) => f.trim()).filter(Boolean);
  const supported = values.filter((f) => !/^(executedOn|lastModified)$/i.test(f));
  return supported.length ? [...new Set(supported)].join(',') : QMETRY_TEST_CASE_FIELDS;
}

function mergeQmetry(raw: Partial<QmetryIntegrationConfig> | undefined): QmetryIntegrationConfig {
  const cfg = { ...DEFAULTS.qmetry, ...(raw || {}) };
  return {
    ...cfg,
    testCyclesSearchPath: cfg.testCyclesSearchPath || QMETRY_TEST_CYCLES_SEARCH_PATH,
    testCasesSearchPath: cfg.testCasesSearchPath || DEFAULTS.qmetry.testCasesSearchPath,
    testCaseFields: cleanQmetryTestCaseFields(cfg.testCaseFields),
    cycleIds: Array.isArray(cfg.cycleIds) ? cfg.cycleIds : [],
    usePostSearch: true,
  };
}

function readRuntimeConfig(configDir: string): RuntimeConfig {
  const file = path.join(configDir, 'runtime.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeConfig;
  } catch {
    return {};
  }
}

function qmetryRuntimeSearchBody(projectId: string | null, folderId?: string): Record<string, unknown> | null {
  if (!projectId && !folderId?.trim()) return null;
  const filter: Record<string, unknown> = {};
  if (projectId) filter.projectId = /^\d+$/.test(projectId) ? Number(projectId) : projectId;
  if (folderId?.trim()) filter.folderId = folderId.trim();
  return { filter };
}

function runtimeJiraOverride(runtime: RuntimeConfig): Partial<JiraIntegrationConfig> {
  const jira = runtime.jira || {};
  const secret = jira.onPremSecret || jira.apiToken;
  return {
    ...(jira.enabled !== undefined ? { enabled: jira.enabled } : {}),
    ...(jira.deploymentType ? { deploymentType: jira.deploymentType } : {}),
    ...(jira.baseUrl ? { baseUrl: jira.baseUrl } : {}),
    ...(jira.searchPath ? { searchPath: jira.searchPath } : {}),
    ...(jira.projectKeys?.length ? { projectKeys: jira.projectKeys } : {}),
    ...(jira.jql ? { jql: jira.jql } : {}),
    ...(jira.sessionHeader ? { cookie: jira.sessionHeader } : {}),
    ...(jira.sessionId ? { jiraSessionId: jira.sessionId } : {}),
    ...(jira.xsrfToken ? { jiraXsrfToken: jira.xsrfToken } : {}),
    ...(jira.applicationCiFieldId ? { applicationCiFieldId: jira.applicationCiFieldId } : {}),
    ...(jira.email || secret ? { auth: { type: 'basic' as const, email: jira.email, token: secret } } : {}),
  };
}

function runtimeQmetryOverride(runtime: RuntimeConfig): Partial<QmetryIntegrationConfig> {
  const qmetry = runtime.qmetry || {};
  const projectId = qmetry.projectId?.trim() || null;
  return {
    ...(qmetry.enabled !== undefined ? { enabled: qmetry.enabled } : {}),
    ...(qmetry.baseUrl ? { baseUrl: qmetry.baseUrl } : {}),
    ...(qmetry.apiPrefix ? { apiPrefix: qmetry.apiPrefix } : {}),
    ...(qmetry.projectKey ? { projectKey: qmetry.projectKey } : {}),
    ...(projectId ? { projectId } : {}),
    ...(qmetry.basicAuth || qmetry.email || qmetry.apiToken ? { auth: { type: 'basic' as const, email: qmetry.email, token: qmetry.basicAuth || qmetry.apiToken }, authEncodedEnv: '' } : {}),
    ...(projectId || qmetry.folderId ? { testCyclesSearchBody: qmetryRuntimeSearchBody(projectId, qmetry.folderId) } : {}),
  };
}

export function loadIntegrations(configDir: string): IntegrationsConfig {
  const runtime = readRuntimeConfig(configDir);
  const file = path.join(configDir, 'integrations.json');
  if (!fs.existsSync(file)) {
    return {
      jira: mergeJira({ ...runtimeJiraOverride(runtime) }),
      jiraProfiles: [],
      qmetry: mergeQmetry({ ...runtimeQmetryOverride(runtime) }),
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      jira: mergeJira({ ...raw.jira, ...runtimeJiraOverride(runtime) }),
      jiraProfiles: Array.isArray(raw.jiraProfiles) ? raw.jiraProfiles.map((p: Partial<JiraIntegrationConfig>, i: number) => mergeJira(p, i)) : [],
      qmetry: mergeQmetry({ ...raw.qmetry, ...runtimeQmetryOverride(runtime) }),
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

function connectionSecret(conn: { apiToken?: string; credential?: string }): string { return conn.apiToken || conn.credential || ''; }

export function jiraConfigFromConnection(conn: JiraConnectionInput): JiraIntegrationConfig {
  const projectKeys = conn.projectKeys?.filter(Boolean) || [];
  const jql = conn.jql?.trim() || (projectKeys.length ? `project in (${projectKeys.join(',')}) AND issuetype in (Story, Bug) ORDER BY updated DESC` : 'issuetype in (Story, Bug) ORDER BY updated DESC');
  const deploymentType = conn.deploymentType || 'on-prem';
  return {
    ...DEFAULT_JIRA,
    enabled: true,
    name: conn.name,
    deploymentType,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    searchPath: conn.searchPath?.trim() || JIRA_SEARCH_PATH,
    auth: { type: conn.authType || 'basic', email: conn.email, username: conn.username, token: connectionSecret(conn) },
    cookie: conn.cookie,
    jiraSessionId: conn.jiraSessionId,
    jiraXsrfToken: conn.jiraXsrfToken,
    projectKeys,
    jql,
    applicationCiFieldId: conn.applicationCiFieldId || null,
  };
}

function qmetryCycleSearchBody(projectId: string | null, folderId?: string): Record<string, unknown> | null {
  if (!projectId && !folderId?.trim()) return null;
  const filter: Record<string, unknown> = {};
  if (projectId) filter.projectId = /^\d+$/.test(projectId) ? Number(projectId) : projectId;
  if (folderId?.trim()) filter.folderId = folderId.trim();
  return { filter };
}

export function qmetryConfigFromConnection(conn: QmetryConnectionInput): QmetryIntegrationConfig {
  const projectId = conn.projectId?.trim() || null;
  return {
    ...DEFAULTS.qmetry,
    ...(conn as unknown as Partial<QmetryIntegrationConfig>),
    enabled: true,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    auth: { type: 'basic', email: conn.email, token: connectionSecret(conn) },
    authEncodedEnv: '',
    projectKey: conn.projectKey,
    projectId,
    testCyclesSearchPath: QMETRY_TEST_CYCLES_SEARCH_PATH,
    testCyclesSearchBody: qmetryCycleSearchBody(projectId, conn.folderId),
    cycleIds: [],
    testCasesSearchBody: null,
    testCaseFields: cleanQmetryTestCaseFields((conn as unknown as Partial<QmetryIntegrationConfig>).testCaseFields || DEFAULTS.qmetry.testCaseFields),
    usePostSearch: true,
  };
}

export function getEncodedAuth(envKey: string): string | null { const val = process.env[envKey]; return val ? val.trim() : null; }

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
