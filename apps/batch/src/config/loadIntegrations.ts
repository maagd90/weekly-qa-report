import fs from 'fs';
import path from 'path';
import type { JiraConnectionInput, QmetryConnectionInput } from '../types/connections';

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
  qmetry: QmetryIntegrationConfig;
}

const DEFAULTS: IntegrationsConfig = {
  jira: {
    enabled: false,
    baseUrl: '',
    searchPath: '/rest/api/2/search',
    auth: { type: 'basic', emailEnv: 'JIRA_EMAIL', tokenEnv: 'JIRA_API_TOKEN' },
    projectKeys: ['DLM'],
    jql: 'project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC',
    pageSize: 100,
    fields: ['summary', 'issuetype', 'status', 'priority', 'assignee', 'created', 'updated', 'resolutiondate'],
    statusDone: ['Done', 'CLOSED', 'Cancel'],
    applicationCiFieldId: null,
  },
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

export function loadIntegrations(configDir: string): IntegrationsConfig {
  const file = path.join(configDir, 'integrations.json');
  if (!fs.existsSync(file)) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      jira: { ...DEFAULTS.jira, ...raw.jira },
      qmetry: { ...DEFAULTS.qmetry, ...raw.qmetry },
    };
  } catch (err) {
    console.error('[integrations] Failed to parse integrations.json:', (err as Error).message);
    return structuredClone(DEFAULTS);
  }
}

export function getBasicAuth(cfg: BasicAuthConfig): string | null {
  const user = cfg.email || cfg.username || (cfg.emailEnv ? process.env[cfg.emailEnv] : undefined);
  const secret = cfg.token || (cfg.tokenEnv ? process.env[cfg.tokenEnv] : undefined);
  if (!user || !secret) return null;
  return Buffer.from(`${user}:${secret}`).toString('base64');
}

export function getAuthHeader(cfg: BasicAuthConfig): string | null {
  const secret = cfg.token || (cfg.tokenEnv ? process.env[cfg.tokenEnv] : undefined);
  if (cfg.type === 'bearer') return secret ? `Bearer ${secret}` : null;
  const basic = getBasicAuth(cfg);
  return basic ? `Basic ${basic}` : null;
}

export function jiraConfigFromConnection(conn: JiraConnectionInput): JiraIntegrationConfig {
  const projectKeys = conn.projectKeys?.filter(Boolean) || [];
  const jql = conn.jql?.trim() || (projectKeys.length
    ? `project in (${projectKeys.join(',')}) AND issuetype in (Story, Bug) ORDER BY updated DESC`
    : 'issuetype in (Story, Bug) ORDER BY updated DESC');
  const deploymentType = conn.deploymentType || 'cloud';
  const authType = conn.authType || 'basic';
  const searchPath = conn.searchPath?.trim() || (deploymentType === 'cloud' ? '/rest/api/3/search' : '/rest/api/2/search');
  return {
    ...DEFAULTS.jira,
    enabled: true,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    searchPath,
    auth: { type: authType, email: conn.email, username: conn.username, token: conn.credential },
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
    auth: { type: 'basic', email: conn.email, token: conn.credential },
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

export function integrationsSummary(configDir: string) {
  const cfg = loadIntegrations(configDir);
  const hasAuth = !!getBasicAuth(cfg.qmetry.auth) || !!getEncodedAuth(cfg.qmetry.authEncodedEnv);
  return {
    jira: { enabled: cfg.jira.enabled, baseUrl: cfg.jira.baseUrl, configured: !!getAuthHeader(cfg.jira.auth) },
    qmetry: {
      enabled: cfg.qmetry.enabled,
      baseUrl: cfg.qmetry.baseUrl,
      configured: hasAuth,
      cycleIds: cfg.qmetry.cycleIds.length,
      projectId: cfg.qmetry.projectId,
    },
  };
}
