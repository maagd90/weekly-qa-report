import assert from 'assert';
import type { ExecutionRow, IssueRow } from '../../types/dataset';
import {
  datesMatchApiScope,
  executionMatchesApiScope,
  issueMatchesApiScope,
  projectMatchesApiScope,
  validIsoDate,
} from '../scopeMatching';

const issue: IssueRow = {
  project: 'DLM',
  key: 'DLM-1',
  area: 'Booking',
  issueType: 'Bug',
  status: 'open',
  priority: 'High',
  assignee: 'Quality Assurance',
  createdAt: '2026-06-20',
  updatedAt: '2026-07-10',
  resolvedAt: null,
  source: 'jira-api',
};

const execution: ExecutionRow = {
  project: 'DLM',
  cycleKey: 'DLM-TR-55',
  cycleName: 'Manual Flight entry flows',
  caseKey: 'DLM-TC-1',
  result: 'PASS',
  tester: 'Quality Assurance',
  executedAt: '2026-07-14',
  updatedAt: '2026-07-14',
  source: 'qmetry',
};

function main(): void {
  assert.equal(validIsoDate(' 2026-07-14 '), '2026-07-14');
  assert.equal(validIsoDate('14/Jul/2026'), undefined);
  assert.equal(validIsoDate(undefined), undefined);

  assert.equal(projectMatchesApiScope('DN4 FT', { project: 'DLM' }), true, 'known aliases must canonicalize');
  assert.equal(projectMatchesApiScope('DP', { project: 'DLM' }), false);
  assert.equal(projectMatchesApiScope('DP'), true, 'an absent project scope must not filter rows');

  assert.equal(datesMatchApiScope(['2026-07-01'], { startDate: '2026-07-01', endDate: '2026-07-14' }), true, 'lower bound is inclusive');
  assert.equal(datesMatchApiScope(['2026-07-14'], { startDate: '2026-07-01', endDate: '2026-07-14' }), true, 'upper bound is inclusive');
  assert.equal(datesMatchApiScope(['2026-06-30', null], { startDate: '2026-07-01' }), false);
  assert.equal(datesMatchApiScope([null, 'not-a-date'], { endDate: '2026-07-14' }), false, 'missing dates cannot satisfy a bounded scope');
  assert.equal(datesMatchApiScope([null]), true, 'dates are irrelevant when no date bounds exist');

  assert.equal(issueMatchesApiScope(issue, { project: 'DLM', startDate: '2026-07-01', endDate: '2026-07-14' }), true, 'any relevant issue activity date may satisfy the range');
  assert.equal(issueMatchesApiScope(issue, { project: 'DLM', startDate: '2026-07-11' }), false);
  assert.equal(issueMatchesApiScope(issue, { project: 'DP', startDate: '2026-07-01' }), false);

  assert.equal(executionMatchesApiScope(execution, { project: 'DLM', startDate: '2026-07-14', endDate: '2026-07-14' }), true);
  assert.equal(executionMatchesApiScope(execution, { project: 'DLM', endDate: '2026-07-13' }), false);
  assert.equal(executionMatchesApiScope(execution), true);

  console.log('API scope matching tests passed');
}

main();
