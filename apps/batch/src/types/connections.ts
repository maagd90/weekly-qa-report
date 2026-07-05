export type JiraDeploymentType = 'cloud' | 'on-prem';
export type JiraAuthType = 'basic' | 'bearer';

export interface JiraConnectionInput {
  id: string;
  name: string;
  baseUrl: string;
  deploymentType?: JiraDeploymentType;
  authType?: JiraAuthType;
  email: string;
  username?: string;
  apiToken?: string;
  credential?: string;
  cookie?: string;
  jiraSessionId?: string;
  jiraXsrfToken?: string;
  searchPath?: string;
  projectKeys: string[];
  jql?: string;
  applicationCiFieldId?: string;
}

export interface QmetryConnectionInput {
  id: string;
  name: string;
  baseUrl: string;
  email: string;
  apiToken?: string;
  credential?: string;
  projectKey: string;
  projectId?: string;
  cycleIds?: string[];
  folderId?: string;
}

export interface UserConnections {
  jira: JiraConnectionInput[];
  qmetry: QmetryConnectionInput[];
}

export function emptyConnections(): UserConnections {
  return { jira: [], qmetry: [] };
}
