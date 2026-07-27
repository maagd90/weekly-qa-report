import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { UatPage } from '../../../pages/UatPage.tsx';

const dashboard: DashboardPayload = {
  scope: { startDate: '2026-07-01', endDate: '2026-07-31', search: '', result: 'all', project: 'VENDOR', projects: ['VENDOR'] },
  overview: { totalCases: 0, executed: 0, passRate: 0, failed: 0, blocked: 0, resultMix: [], byMonth: [], chartSeries: { resultMix: [] } },
  testers: [],
  cycles: [],
  cyclesByPassPctAsc: [],
  storyBug: { story: 0, bug: 0, storyOpen: 0, storyDone: 0, bugOpen: 0, bugDone: 0 },
  traceability: [],
  workItems: [],
  defectBacklog: { openTotal: 0, byPriority: [], topPriorities: [], byOwner: [] },
  uat: {
    total: 3,
    open: 2,
    closed: 1,
    closureRate: 33,
    urgentOpen: 0,
    byStatus: [{ status: 'Pending', count: 1 }, { status: 'In Testing', count: 1 }, { status: 'Closed', count: 1 }],
    byPriority: [{ priority: 'High', count: 2 }, { priority: 'Low', count: 1 }],
    byArea: [{ area: 'Payments', count: 3 }],
    bySubmitter: [{ name: 'QA One', count: 3 }],
    byReportedPhase: [
      { category: 'phase1-uat', label: 'Phase 1 UAT', environment: 'UAT', count: 1, open: 1, closed: 0 },
      { category: 'phase2-uat', label: 'Phase 2 UAT', environment: 'UAT', count: 0, open: 0, closed: 0 },
      { category: 'production', label: 'Production', environment: 'PROD', count: 1, open: 0, closed: 1 },
      { category: 'unclassified', label: 'Unclassified', environment: 'Unknown', count: 1, open: 1, closed: 0 },
    ],
    rows: [
      { id: 'VP-1', subject: 'UAT payment', area: 'Payments', cr: 'CR-1', priority: 'High', clientPriority: 'Urgent', status: 'Pending', submitter: 'QA One', updatedBy: 'Vendor User', submittedAt: '2026-07-10', updatedAt: '2026-07-13', note: 'Vendor supplied a retest build', reportedPhase: 'phase1-uat', sourceFile: 'private.xlsx' },
      { id: 'VP-2', subject: 'INC production', area: 'Payments', cr: 'CR-2', priority: 'Low', status: 'Closed', submitter: 'QA One', submittedAt: '2026-07-11', updatedAt: '2026-07-11', reportedPhase: 'production', sourceFile: 'private.xlsx' },
      { id: 'VP-3', subject: '', area: 'Payments', cr: '', priority: 'High', status: 'In Testing', submitter: 'QA One', submittedAt: '', updatedAt: '2026-07-12', reportedPhase: 'unclassified', sourceFile: 'private.xlsx' },
    ],
  },
  files: [],
  meta: { generatedAt: '2026-07-23T08:00:00.000Z', parsedAt: '2026-07-23T07:00:00.000Z', fetchedAt: null, warnings: [] },
};

const html = renderToStaticMarkup(<UatPage dashboard={dashboard} kpiStyle="editorial" searchQuery="" />);
assert.match(html, /UAT Bugs · 1/);
assert.match(html, /Production Bugs · 1/);
assert.match(html, /Unclassified · 1/);
assert.match(html, /aria-label="Status"/);
assert.match(html, /Pending \(1\)/);
assert.match(html, /aria-label="Search anything"/);
assert.match(html, />Advanced Search</);
assert.doesNotMatch(html, /aria-label="JQL-style query"/);

const headers = ['Ticket', 'Subject', 'Area', 'Change Request', 'Priority', 'Status', 'By', 'Submitted', 'Updated', 'Note'];
let previous = -1;
for (const header of headers) {
  const index = html.indexOf(`>${header}</th>`);
  assert.ok(index > previous, `${header} must appear in the agreed header order`);
  previous = index;
}
assert.doesNotMatch(html, />Source file<\/th>/i);
assert.doesNotMatch(html, />Phase \/ Env<\/th>/i);
const emptyHtml = renderToStaticMarkup(<UatPage dashboard={dashboard} kpiStyle="editorial" searchQuery="no-visible-match" />);
assert.match(html, /most recently updated first/);
assert.match(html, /Vendor supplied a retest build/);
assert.match(html, /aria-label="View details for Vendor Portal bug VP-1"/);
assert.match(html, /tabindex="0"/);
assert.match(emptyHtml, /colspan="10"/i);

console.log('Vendor Portal page rendering tests passed');
