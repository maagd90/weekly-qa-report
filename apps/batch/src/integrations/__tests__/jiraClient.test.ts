import assert from 'assert';
import { buildScopedJql } from '../jiraClient';

function main(): void {
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

  console.log('jiraClient tests passed');
}

main();
