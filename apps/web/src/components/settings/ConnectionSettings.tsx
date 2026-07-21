import React, { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isBlankJiraConnection, isBlankQmetryConnection } from '../../lib/connectionValidation';
import {
  jiraProjectJql,
  jqlProjectKeys,
  normalizeSourceProjectKey,
  projectSourceKeys,
  uniqueSourceProjectKeys,
} from '../../lib/projectKeys';
import type { JiraConnectionInput, QmetryConnectionInput } from 'qa-dashboard-batch';
import type { ProjectRecord } from '../../lib/api';
import { batchApi, newConnectionId } from '../../lib/api';

export const fieldClass = 'min-h-11 w-full border border-qa-border bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa sm:min-h-0';
export const labelClass = 'block text-[10.5px] font-mono-qa uppercase tracking-wide text-qa-muted-light mb-1';

export function parseSourceKeys(value: string): string[] {
  return uniqueSourceProjectKeys(value.split(/[,/\s]+/));
}

export function validateProjectJql(jql: string | undefined, projectKeys: string[]): string {
  const normalized = (jql || '').trim() || jiraProjectJql(projectKeys);
  const configured = jqlProjectKeys(normalized);
  const allowed = new Set(projectKeys);
  if (configured.length !== projectKeys.length || configured.some((key) => !allowed.has(key))) {
    throw new Error(`JIRA JQL must be scoped to all configured source keys: ${projectKeys.join(', ')}.`);
  }
  return normalized;
}

export function rewriteProjectJql(jql: string | undefined, previousKeys: string[], nextKeys: string[]): string {
  const current = (jql || '').trim() || jiraProjectJql(previousKeys);
  const nextScope = nextKeys.length === 1 ? `project = ${nextKeys[0]}` : `project in (${nextKeys.join(', ')})`;
  const projectClause = /\bproject\s*(?:=\s*(?:["'][^"']+["']|[A-Z0-9_-]+)|in\s*\([^)]+\))/i;
  return projectClause.test(current) ? current.replace(projectClause, nextScope) : jiraProjectJql(nextKeys);
}

export type TestResult = { ok: boolean; count?: number; executions?: number; issues?: number; uat?: number; error?: string };

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  return <div><label htmlFor={inputId} className={labelClass}>{label}</label><input id={inputId} className={fieldClass} {...props} /></div>;
}

export function SyncBox({ label, note, checked, disabled, onChange }: { label: string; note?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`inline-flex items-start gap-2 text-[12.5px] text-qa-ink ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#b95c00]" /><span><span className="font-semibold">{label}</span>{note && <span className="block text-[11px] text-qa-muted-light mt-0.5">{note}</span>}</span></label>;
}

export function DeploymentBox({ label, name, checked, onSelect }: { label: string; name: string; checked: boolean; onSelect: () => void }) {
  return <label className="inline-flex items-center gap-2 text-[12.5px] text-qa-ink"><input type="radio" name={name} checked={checked} onChange={onSelect} className="h-4 w-4 accent-[#b95c00]" /><span className="font-semibold">{label}</span></label>;
}

export function blankJiraConnection(project: ProjectRecord): JiraConnectionInput {
  const sourceKeys = projectSourceKeys(project);
  return { id: newConnectionId(), workspaceProjectId: project.id, workspaceProjectKey: project.key, name: `${project.key} JIRA`, baseUrl: '', enabled: true, syncIssues: true, deploymentType: 'on-prem', authType: 'basic', email: '', username: '', apiToken: '', credential: '', cookie: '', jiraSessionId: '', jiraXsrfToken: '', searchPath: '/rest/api/2/search', projectKeys: sourceKeys, jql: jiraProjectJql(sourceKeys), applicationCiFieldId: '' };
}

export function blankQmetryConnection(project: ProjectRecord): QmetryConnectionInput {
  return { id: newConnectionId(), workspaceProjectId: project.id, workspaceProjectKey: project.key, name: `${project.key} QMetry`, baseUrl: '', enabled: true, syncExecutions: true, email: '', apiToken: '', credential: '', sessionHeader: '', sessionId: '', xsrfToken: '', projectKey: project.key, projectId: '', folderId: '', cycleIds: [] };
}

export function jiraProject(conn: JiraConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => projectSourceKeys(project).some((key) => conn.projectKeys?.map(normalizeSourceProjectKey).includes(key)));
}

export function qmetryProject(conn: QmetryConnectionInput, projects: ProjectRecord[]): ProjectRecord | undefined {
  return projects.find((project) => project.id === conn.workspaceProjectId)
    || projects.find((project) => projectSourceKeys(project).includes(normalizeSourceProjectKey(conn.projectKey)));
}

export function jiraConnectionForProject(project: ProjectRecord, connections: JiraConnectionInput[], projects: ProjectRecord[]): JiraConnectionInput {
  return connections.find((connection) => jiraProject(connection, projects)?.id === project.id) || blankJiraConnection(project);
}

export function qmetryConnectionForProject(project: ProjectRecord, connections: QmetryConnectionInput[], projects: ProjectRecord[]): QmetryConnectionInput {
  return connections.find((connection) => qmetryProject(connection, projects)?.id === project.id) || blankQmetryConnection(project);
}

export function JiraConnectionCard({ conn, onChange, project }: { conn: JiraConnectionInput; onChange: (next: JiraConnectionInput) => void; project: ProjectRecord }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const selectedProject = project;
  const enabled = conn.enabled !== false;
  const syncIssues = conn.syncIssues !== false;
  const deploymentType = conn.deploymentType || 'on-prem';
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('jira', { ...conn, enabled, syncIssues, deploymentType }), onSuccess: (r) => setTestResult(r) });

  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <div className="flex flex-wrap gap-5 mb-4 p-3 border border-qa-border bg-white">
        <SyncBox label="Enable this JIRA connection" checked={enabled} onChange={(checked) => onChange({ ...conn, enabled: checked })} />
        <SyncBox label="Sync JIRA tickets / bugs & stories" note="Required for story, bug, defect, assignee, and traceability metrics." checked={syncIssues} disabled={!enabled} onChange={(checked) => onChange({ ...conn, syncIssues: checked })} />
      </div>
      <div className="mb-4 p-3 border border-qa-border bg-white">
        <div className="font-mono-qa text-[10.5px] uppercase tracking-wide text-qa-muted-light mb-2">JIRA deployment type</div>
        <div className="flex flex-wrap gap-5">
          <DeploymentBox name={`jira-deployment-${conn.id}`} label="On-premises" checked={deploymentType === 'on-prem'} onSelect={() => onChange({ ...conn, deploymentType: 'on-prem', authType: 'basic' })} />
          <DeploymentBox name={`jira-deployment-${conn.id}`} label="On-cloud / JIRA Cloud" checked={deploymentType === 'cloud'} onSelect={() => onChange({ ...conn, deploymentType: 'cloud', authType: 'basic' })} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2">
        <Field label="Dashboard project" value={`${selectedProject.key} — ${selectedProject.name}`} readOnly />
        <Field label="JIRA source project keys" value={projectSourceKeys(selectedProject).join(', ')} readOnly />
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label={deploymentType === 'cloud' ? 'Email / Username' : 'Username'} value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value, username: e.target.value })} />
        <Field label={deploymentType === 'cloud' ? 'API token / Auth value' : 'Auth value'} type={showSecret ? 'text' : 'password'} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="REST search path" value={conn.searchPath || '/rest/api/2/search'} onChange={(e) => onChange({ ...conn, searchPath: e.target.value })} />
        <Field label="Application CI field" placeholder="customfield_12345" value={conn.applicationCiFieldId || ''} onChange={(e) => onChange({ ...conn, applicationCiFieldId: e.target.value })} />
        <Field label="Session header" type={showSecret ? 'text' : 'password'} value={conn.cookie || ''} onChange={(e) => onChange({ ...conn, cookie: e.target.value })} />
        <Field label="Session ID" type={showSecret ? 'text' : 'password'} value={conn.jiraSessionId || ''} onChange={(e) => onChange({ ...conn, jiraSessionId: e.target.value })} />
        <Field label="Security token" type={showSecret ? 'text' : 'password'} value={conn.jiraXsrfToken || ''} onChange={(e) => onChange({ ...conn, jiraXsrfToken: e.target.value })} />
      </div>
      <label className={labelClass}>Project-scoped JQL</label>
      <textarea className="w-full border border-qa-border bg-white px-2.5 py-1.5 text-[12.5px] font-mono-qa min-h-[82px]" value={conn.jql || ''} onChange={(event) => onChange({ ...conn, jql: event.target.value })} />
      <p className="text-[10.5px] text-qa-muted-light mt-1 mb-0">Editable for testing custom filters. The project clause must include every configured source key: <code>{projectSourceKeys(selectedProject).join(', ')}</code>.</p>
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test JIRA'}</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} sample rows)` : testResult.error}</span>}</div>
    </div>
  );
}

export function QmetryConnectionCard({ conn, onChange, project }: { conn: QmetryConnectionInput; onChange: (next: QmetryConnectionInput) => void; project: ProjectRecord }) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const enabled = conn.enabled !== false;
  const syncExecutions = conn.syncExecutions !== false;
  const selectedProject = project;
  const testMutation = useMutation({ mutationFn: () => batchApi.testConnection('qmetry', { ...conn, enabled, syncExecutions, cycleIds: [] }), onSuccess: (r) => setTestResult(r) });
  return (
    <div className="border border-qa-border bg-[#faf8f2] p-3.5 mb-3">
      <p className="text-[12px] text-qa-muted m-0 mb-3">QMetry provides test-execution and cycle data only. Add a matching JIRA connection for the same project if you need stories, bugs, defects, and traceability.</p>
      <div className="flex flex-wrap gap-5 mb-4 p-3 border border-qa-border bg-white">
        <SyncBox label="Enable this QMetry connection" checked={enabled} onChange={(checked) => onChange({ ...conn, enabled: checked, cycleIds: [] })} />
        <SyncBox label="Sync test executions / cycles" checked={syncExecutions} disabled={!enabled} onChange={(checked) => onChange({ ...conn, syncExecutions: checked, cycleIds: [] })} />
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-2.5 sm:grid-cols-2">
        <Field label="Dashboard project" value={`${selectedProject.key} — ${selectedProject.name}`} readOnly />
        <div><label className={labelClass}>QMetry project key</label><select className={fieldClass} value={conn.projectKey} onChange={(event) => onChange({ ...conn, projectKey: event.target.value, cycleIds: [] })}>{projectSourceKeys(selectedProject).map((key) => <option key={key} value={key}>{key}</option>)}</select></div>
        <Field label="Connection name" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Field label="Base URL" placeholder="https://jira.example.com" value={conn.baseUrl} onChange={(e) => onChange({ ...conn, baseUrl: e.target.value })} />
        <Field label="Username" value={conn.email} onChange={(e) => onChange({ ...conn, email: e.target.value })} />
        <Field label="Auth value" type={showSecret ? 'text' : 'password'} value={conn.apiToken || ''} onChange={(e) => onChange({ ...conn, apiToken: e.target.value, credential: e.target.value })} />
        <Field label="Project ID" placeholder="19703" value={conn.projectId || ''} onChange={(e) => onChange({ ...conn, projectId: e.target.value, cycleIds: [] })} />
        <Field label="Folder ID" placeholder="96225" value={conn.folderId || ''} onChange={(e) => onChange({ ...conn, folderId: e.target.value, cycleIds: [] })} />
        <Field label="Session header" type={showSecret ? 'text' : 'password'} value={conn.sessionHeader || ''} onChange={(e) => onChange({ ...conn, sessionHeader: e.target.value, cycleIds: [] })} />
        <Field label="Session ID" type={showSecret ? 'text' : 'password'} value={conn.sessionId || ''} onChange={(e) => onChange({ ...conn, sessionId: e.target.value, cycleIds: [] })} />
        <Field label="Security token" type={showSecret ? 'text' : 'password'} value={conn.xsrfToken || ''} onChange={(e) => onChange({ ...conn, xsrfToken: e.target.value, cycleIds: [] })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5"><button type="button" onClick={() => setShowSecret((v) => !v)} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer">{showSecret ? 'Hide values' : 'Show values'}</button><button type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !enabled} className="font-mono-qa text-[10px] px-3 py-1.5 border border-qa-border bg-white cursor-pointer disabled:opacity-50">{testMutation.isPending ? 'Testing...' : 'Test QMetry'}</button>{testResult && <span className={`min-w-0 break-words font-mono-qa text-[10.5px] ${testResult.ok ? 'text-[#2f6a48]' : 'text-[#a13d2c]'}`}>{testResult.ok ? `OK (${testResult.count ?? 0} test cycles found)` : testResult.error}</span>}</div>
    </div>
  );
}

export function normalizedConnectionsForSave(
  jiraConnections: JiraConnectionInput[],
  qmetryConnections: QmetryConnectionInput[],
  projects: ProjectRecord[],
): { jira: JiraConnectionInput[]; qmetry: QmetryConnectionInput[]; removed: string[] } {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const removed: string[] = [];
  const normalizeJira = (connections: JiraConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.filter((connection) => !isBlankJiraConnection(connection)).flatMap((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || jiraProject(connection, projects);
      if (!project) {
        removed.push(`${connection.name || connection.projectKeys?.[0] || 'Unnamed'} JIRA`);
        return [];
      }
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a JIRA connection. Only one JIRA connection is allowed per project.`);
      assigned.add(project.id);
      const sourceKeys = projectSourceKeys(project);
      return [{ ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, deploymentType: connection.deploymentType || 'on-prem', projectKeys: sourceKeys, jql: validateProjectJql(connection.jql, sourceKeys) }];
    });
  };
  const normalizeQmetry = (connections: QmetryConnectionInput[]) => {
    const assigned = new Set<string>();
    return connections.filter((connection) => !isBlankQmetryConnection(connection)).flatMap((connection) => {
      const project = projectById.get(connection.workspaceProjectId || '') || qmetryProject(connection, projects);
      if (!project) {
        removed.push(`${connection.name || connection.projectKey || 'Unnamed'} QMetry`);
        return [];
      }
      if (assigned.has(project.id)) throw new Error(`Project ${project.key} already has a QMetry connection. Only one QMetry connection is allowed per project.`);
      assigned.add(project.id);
      const normalizedKey = normalizeSourceProjectKey(connection.projectKey);
      const selectedSourceKey = projectSourceKeys(project).includes(normalizedKey) ? normalizedKey : project.key;
      return [{ ...connection, workspaceProjectId: project.id, workspaceProjectKey: project.key, projectKey: selectedSourceKey, cycleIds: [] }];
    });
  };
  return { jira: normalizeJira(jiraConnections), qmetry: normalizeQmetry(qmetryConnections), removed };
}
