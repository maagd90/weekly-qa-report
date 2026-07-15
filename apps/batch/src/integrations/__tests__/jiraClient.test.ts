import assert from 'assert';
import { buildScopedJql, fetchJiraIssues } from '../jiraClient';
import type { JiraIntegrationConfig } from '../../config/loadIntegrations';

async function main(): Promise<void> {
  const base = 'project = DLM AND issuetype in (Story, Bug) ORDER BY updated DESC';
  const scoped = buildScopedJql(base, { startDate: '2025-12-03', endDate: '2026-07-11', project: 'DLM' });

  assert.match(scoped, /\(created >= "2025-12-03" AND created <= "2026-07-11 23:59"\)/);
  assert.match(scoped, /\(updated >= "2025-12-03" AND updated <= "2026-07-11 23:59"\)/);
  assert.match(scoped, /\(resolutiondate >= "2025-12-03" AND resolutiondate <= "2026-07-11 23:59"\)/);
  assert.match(scoped, / OR /, 'created, updated and resolution date ranges must use A2 OR semantics');
  assert.doesNotMatch(scoped, /created >=[^)]*OR updated >=/, 'lower bounds must not be grouped independently from upper bounds');
  assert.ok(scoped.endsWith('ORDER BY updated DESC'));

  const startOnly = buildScopedJql(base, { startDate: '2025-12-03' });
  assert.match(startOnly, /created >= "2025-12-03"/);
  assert.doesNotMatch(startOnly, /created <=/);

  const unchanged = buildScopedJql(base, {});
  assert.equal(unchanged, base);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      issues: [{
        key: 'DLM-123',
        fields: {
          summary: 'Global DMC - complete JIRA story summary retained for traceability',
          issuetype: { name: 'Story' },
          status: { name: 'In Progress' },
          priority: { name: 'High' },
          assignee: { displayName: 'QA Owner' },
          created: '2026-07-01T09:00:00.000+0400',
          updated: '2026-07-02T09:00:00.000+0400',
          resolutiondate: null,
        },
      }],
      total: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const cfg: JiraIntegrationConfig = {
      enabled: true,
      baseUrl: 'https://jira.example.test',
      searchPath: '/rest/api/2/search',
      auth: { type: 'basic', email: 'qa@example.test', token: 'token' },
      projectKeys: ['DLM'],
      jql: base,
      pageSize: 100,
      fields: ['summary', 'issuetype', 'status', 'priority', 'assignee', 'created', 'updated', 'resolutiondate'],
      statusDone: ['Done'],
      applicationCiFieldId: null,
    };
    const result = await fetchJiraIssues(cfg);
    assert.equal(result.error, undefined);
    assert.equal(result.issues[0]?.summary, 'Global DMC - complete JIRA story summary retained for traceability');
    assert.equal(result.issues[0]?.area, 'Global DMC', 'feature area remains independently derived from the complete summary');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('jiraClient tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
