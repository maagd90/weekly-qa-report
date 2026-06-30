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
  projectKey: string;
  testCyclesSearchPath: string | null;
  testCasesSearchPath: string;
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
    baseUrl: 'https://jiraagile.emirates.com',
    searchPath: '/rest/api/2/search',
    auth: { type: 'basic', emailEnv: 'JIRA_EMAIL', tokenEnv: 'JIRA_API_TOKEN' },
    projectKeys: ['DLM'],
    jql: 'project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC',
    pageSize: 100,
    fields: ['summary', 'issuetype', 'status', 'priority', 'assignee', 'created', 'updated', 'resolutiondate'],
    statusDone: ['Done', 'CLOSED', 'Cancel', 'Closed'],
  },
  qmetry: {
    enabled: false,
    baseUrl: 'https://jiraagile.emirates.com',
    apiPrefix: '/rest/qtm4j/ui/latest',
    auth: { type: 'basic', emailEnv: 'JIRA_EMAIL', tokenEnv: 'JIRA_API_TOKEN' },
    projectKey: 'DLM',
    testCyclesSearchPath: null,
    testCasesSearchPath: '/testcycles/{cycleId}/testcases/search',
    testCaseFields: 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedOn,executedBy,lastModified,build',
    cycleIds: [],
    pageSize: 50,
    maxPages: 200,
  },
};

export function loadIntegrations(configDir: string): IntegrationsConfig {
  const file = path.join(configDir, 'integrations.json');
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      jira: { ...DEFAULTS.jira, ...raw.jira },
      qmetry: { ...DEFAULTS.qmetry, ...raw.qmetry },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getBasicAuth(cfg: { emailEnv: string; tokenEnv: string }): string | null {
  const email = process.env[cfg.emailEnv];
  const token = process.env[cfg.tokenEnv];
  if (!email || !token) return null;
  return Buffer.from(`${email}:${token}`).toString('base64');
}

export function integrationsSummary(configDir: string) {
  const cfg = loadIntegrations(configDir);
  return {
    jira: { enabled: cfg.jira.enabled, baseUrl: cfg.jira.baseUrl, configured: !!getBasicAuth(cfg.jira.auth) },
    qmetry: { enabled: cfg.qmetry.enabled, baseUrl: cfg.qmetry.baseUrl, configured: !!getBasicAuth(cfg.qmetry.auth), cycleIds: cfg.qmetry.cycleIds.length },
  };
}
