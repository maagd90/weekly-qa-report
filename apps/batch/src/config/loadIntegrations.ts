import fs from 'fs';
import path from 'path';

export interface JiraIntegrationConfig {
  enabled: boolean;
  baseUrl: string;
  searchPath: string;
  auth: { type: 'basic'; emailEnv: string; tokenEnv: string };
  projectKeys: string[];
  jql: string;
  pageSize: number;
  fields: string[];
  statusDone: string[];
}

export interface QmetryIntegrationConfig {
  enabled: boolean;
  baseUrl: string;
  apiPrefix: string;
  auth: { type: 'basic'; emailEnv: string; tokenEnv: string };
  /** Optional env var with pre-encoded Basic auth value (matches Java QmetryPublisher) */
  authEncodedEnv: string;
  /** JIRA-style project key for display (e.g. DLM) */
  projectKey: string;
  /** Numeric QMetry project ID (e.g. "23000") — used to discover test cycles */
  projectId: string | null;
  testCyclesSearchPath: string | null;
  testCyclesSearchBody: Record<string, unknown> | null;
  testCasesSearchPath: string;
  testCasesSearchBody: Record<string, unknown> | null;
  /** Use POST with JSON body for test case search (Emirates QMetry pattern) */
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

export function getBasicAuth(cfg: { emailEnv: string; tokenEnv: string }): string | null {
  const email = process.env[cfg.emailEnv];
  const token = process.env[cfg.tokenEnv];
  if (!email || !token) return null;
  return Buffer.from(`${email}:${token}`).toString('base64');
}

/** Pre-encoded "Basic xxx" or raw base64 token from env (Java automation.qmetry.encoded.authorization pattern) */
export function getEncodedAuth(envKey: string): string | null {
  const val = process.env[envKey];
  if (!val) return null;
  return val.trim();
}

export function integrationsSummary(configDir: string) {
  const cfg = loadIntegrations(configDir);
  const hasAuth = !!getBasicAuth(cfg.qmetry.auth) || !!getEncodedAuth(cfg.qmetry.authEncodedEnv);
  return {
    jira: { enabled: cfg.jira.enabled, baseUrl: cfg.jira.baseUrl, configured: !!getBasicAuth(cfg.jira.auth) },
    qmetry: {
      enabled: cfg.qmetry.enabled,
      baseUrl: cfg.qmetry.baseUrl,
      configured: hasAuth,
      cycleIds: cfg.qmetry.cycleIds.length,
      projectId: cfg.qmetry.projectId,
    },
  };
}
