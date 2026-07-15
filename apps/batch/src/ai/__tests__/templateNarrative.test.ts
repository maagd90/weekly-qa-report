import assert from 'assert';
import { generateTemplateNarrative, type TemplateNarrativeMetrics } from '../templateNarrative';

const resultMix = [
  { code: 'PASS', label: 'Passed', count: 10, pct: 59, color: '#14892C' },
  { code: 'FAIL', label: 'Failed', count: 2, pct: 12, color: '#D04437' },
  { code: 'BLOCKED', label: 'Blocked', count: 5, pct: 29, color: '#CCC' },
  { code: 'NE', label: 'Not Executed', count: 3, pct: 15, color: '#205081' },
  { code: 'NA', label: 'Not Applicable', count: 0, pct: 0, color: '#F5A623' },
];

const metrics: TemplateNarrativeMetrics = {
  get_result_mix: resultMix,
  get_tester_stats: [
    { name: 'Muhammad Annus', executed: 17, pass: 10, fail: 2, blocked: 5, na: 0, passPct: 59 },
  ],
  get_cycle_health: [
    { key: 'NOT-STARTED', name: 'Not Started Cycle', total: 41, pass: 0, fail: 0, blocked: 0, ne: 41, na: 0, passPct: 0, coverage: 0, status: 'Not Started' },
    { key: 'AT-RISK', name: 'Active At Risk Cycle', total: 17, pass: 10, fail: 2, blocked: 5, ne: 0, na: 0, passPct: 59, coverage: 100, status: 'At Risk' },
  ],
  get_story_bug_split: { story: 1, bug: 3, storyOpen: 0, storyDone: 1, bugOpen: 2, bugDone: 1 },
  get_defect_backlog: {
    openTotal: 2,
    byPriority: [],
    topPriorities: [
      { priority: 'High', open: 2, total: 2 },
      { priority: 'Low', open: 0, total: 3 },
    ],
    byOwner: [
      { name: 'Nobody', open: 0 },
      { name: 'Sara', open: 2 },
    ],
  },
  get_traceability: [
    { area: 'Payments', stories: 1, done: 1, open: 0, bugs: 0, openBugs: 0, completion: 100, status: 'Verified' },
  ],
  get_uat_summary: { total: 4, open: 4, closed: 0, closureRate: 0 },
};

function main(): void {
  const filter = { startDate: '2026-07-01', endDate: '2026-07-14', project: 'DLM', result: 'all' as const };
  const full = generateTemplateNarrative(metrics, filter, 'full');

  assert.match(full, /Full QA summary/);
  assert.match(full, /Quality Assurance member/);
  assert.match(full, /17 executions with an Executed By value/);
  assert.doesNotMatch(full, /\btester(?:s)?\b/i, 'user-facing narrative must use Quality Assurance terminology');
  assert.match(full, /Active At Risk Cycle.*10 of 17 executed cases passed/);
  assert.doesNotMatch(full, /lowest pass rate.*Not Started Cycle/i, 'Not Started cycles must not be treated as 0% executed cycles');
  assert.match(full, /1 story and 3 bugs \(2 open\)/);
  assert.doesNotMatch(full, /story \(0 open\)/);
  assert.doesNotMatch(full, /Low: 0|Nobody/);
  assert.match(full, /UAT recorded 4 items this period: 4 open\./);
  assert.doesNotMatch(full, /0 closed|0% closure rate/);

  const cycles = generateTemplateNarrative(metrics, filter, 'cycles');
  assert.match(cycles, /Cycle Health QA summary/);
  assert.match(cycles, /Active At Risk Cycle/);
  assert.doesNotMatch(cycles, /JIRA activity|defect|UAT|Quality Assurance member/i, 'cycle reports must only include execution and cycle content');

  const defects = generateTemplateNarrative(metrics, filter, 'defects');
  assert.match(defects, /Defect QA summary/);
  assert.match(defects, /JIRA activity|defect/);
  assert.doesNotMatch(defects, /pass rate|test cycle|Quality Assurance member/i, 'defect reports must omit execution and people sections');

  const qualityAssurance = generateTemplateNarrative(metrics, filter, 'testers');
  assert.match(qualityAssurance, /Quality Assurance Performance QA summary/);
  assert.match(qualityAssurance, /Quality Assurance member/);
  assert.doesNotMatch(qualityAssurance, /JIRA activity|test cycle|UAT/i);

  const zeroOnly = generateTemplateNarrative({
    get_result_mix: [{ code: 'PASS', label: 'Passed', count: 0, pct: 0, color: '#14892C' }],
    get_defect_backlog: { openTotal: 0, byPriority: [], topPriorities: [], byOwner: [] },
    get_uat_summary: { total: 0, open: 0, closed: 0 },
  }, filter, 'full');
  assert.match(zeroOnly, /Not available: insufficient data/);
  assert.doesNotMatch(zeroOnly, /No .* recorded|0 failed|0 blocked/);

  console.log('template narrative tests passed');
}

main();
