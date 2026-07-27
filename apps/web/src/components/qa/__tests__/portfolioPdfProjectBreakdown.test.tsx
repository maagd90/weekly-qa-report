import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DashboardByProject,
  DashboardPayload,
  StructuredReportNarrative,
} from 'qa-dashboard-batch';
import { ReportPrintContent } from '../ReportPrintContent.tsx';

const emptyOverview = { totalCases: 0, executed: 0, passRate: 0, failed: 0, blocked: 0, resultMix: [], byMonth: [], chartSeries: { resultMix: [] } };
const emptyStoryBug = { story: 0, bug: 0, storyOpen: 0, storyDone: 0, bugOpen: 0, bugDone: 0 };
const emptyDefects = { openTotal: 0, byPriority: [], topPriorities: [], byOwner: [] };

function slice(project: string, overrides: Partial<DashboardByProject> = {}): DashboardByProject {
  return {
    project,
    overview: emptyOverview,
    storyBug: emptyStoryBug,
    defectBacklog: emptyDefects,
    cycles: [],
    testers: [],
    traceability: [],
    workItems: [],
    uat: null,
    files: [],
    ...overrides,
  };
}

const vendorSlice = slice('VENDOR', {
  uat: {
    total: 1,
    open: 1,
    closed: 0,
    closureRate: 0,
    urgentOpen: 0,
    byStatus: [{ status: 'Pending', count: 1 }],
    byPriority: [{ priority: 'High', count: 1 }],
    byArea: [{ area: 'Checkout', count: 1 }],
    bySubmitter: [{ name: 'QA One', count: 1 }],
    byReportedPhase: [{ category: 'phase1-uat', label: 'Phase 1 UAT', environment: 'UAT', count: 1, open: 1, closed: 0 }],
    rows: [{ id: 'VP-101', subject: 'UAT issue', area: 'Checkout', cr: 'CR-1', priority: 'High', status: 'Pending', submitter: 'QA One', submittedAt: '2026-07-10', updatedAt: '2026-07-10', reportedPhase: 'phase1-uat', sourceFile: 'vendor.xlsx' }],
  },
  files: [{ name: 'vendor.xlsx', ext: '.xlsx', project: 'VENDOR', rows: 1, status: 'parsed', detectedType: 'odl', source: 'file' }],
});

const travelRow = {
  key: 'TVL-201',
  summary: 'Wonder Miles export bug',
  issueType: 'Bug' as const,
  status: 'open' as const,
  priority: 'High',
  assignee: 'QA Two',
  sprint: 'Sprint 1',
  area: 'Export',
  project: 'TRAVEL',
  updatedAt: '2026-07-11',
  sourceFile: 'travel.xlsx',
};
const travelSlice = slice('TRAVEL', {
  storyBug: { ...emptyStoryBug, bug: 1, bugOpen: 1 },
  workItems: [travelRow],
  files: [{ name: 'travel.xlsx', ext: '.xlsx', project: 'TRAVEL', rows: 1, status: 'parsed', detectedType: 'jira', source: 'file' }],
});
const emptySlice = slice('EMPTY');

const dashboard: DashboardPayload = {
  scope: {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    search: '',
    result: 'all',
    project: 'all',
    projects: ['VENDOR', 'TRAVEL', 'EMPTY'],
    capabilitiesByProject: {
      VENDOR: { vendorPortal: true, wonderMilesExport: false },
      TRAVEL: { vendorPortal: false, wonderMilesExport: true },
      EMPTY: { vendorPortal: false, wonderMilesExport: false },
    },
    projectNamesByKey: {
      VENDOR: 'Vendor Workspace',
      TRAVEL: 'Wonder Miles',
      EMPTY: 'No Specialised Data',
    },
  },
  overview: emptyOverview,
  testers: [],
  cycles: [],
  cyclesByPassPctAsc: [],
  storyBug: { ...emptyStoryBug, bug: 1, bugOpen: 1 },
  traceability: [],
  workItems: [travelRow],
  defectBacklog: { ...emptyDefects, openTotal: 1 },
  uat: vendorSlice.uat,
  byProject: [vendorSlice, travelSlice, emptySlice],
  files: [...(vendorSlice.files || []), ...(travelSlice.files || [])],
  meta: { generatedAt: '2026-07-23T08:00:00.000Z', parsedAt: '2026-07-23T07:00:00.000Z', fetchedAt: null, warnings: [] },
};

const narrative: StructuredReportNarrative = {
  version: 1,
  portfolio: { projectName: 'All Projects', markdown: 'Portfolio facts.', status: 'generated' },
  projectOrder: ['VENDOR', 'TRAVEL', 'EMPTY'],
  projects: {
    VENDOR: { project: 'VENDOR', projectName: 'Vendor Workspace', markdown: 'Vendor-owned narration.', status: 'generated' },
    TRAVEL: { project: 'TRAVEL', projectName: 'Wonder Miles', markdown: 'Travel-owned narration.', status: 'generated' },
    EMPTY: { project: 'EMPTY', projectName: 'No Specialised Data', markdown: 'Empty-project narration.', status: 'generated' },
  },
  assembledMarkdown: '',
};

const html = renderToStaticMarkup(
  <ReportPrintContent
    dashboard={dashboard}
    kpiStyle="editorial"
    reportType="defects"
    narrative=""
    structuredNarrative={narrative}
    startDate="2026-07-01"
    endDate="2026-07-31"
  />,
);

assert.match(html, /Project-specific data/);
assert.match(html, /Portfolio Narrative Summary/);
const vendorStart = html.indexOf('data-project="VENDOR"');
const vendorHeading = html.indexOf('Vendor Portal Bugs', vendorStart);
const travelStart = html.indexOf('data-project="TRAVEL"');
const wonderHeading = html.indexOf('Wonder Miles Export Data', travelStart);
const emptyStart = html.indexOf('data-project="EMPTY"');
assert.ok(vendorStart >= 0 && vendorHeading > vendorStart && vendorHeading < travelStart);
assert.ok(travelStart > vendorStart && wonderHeading > travelStart && wonderHeading < emptyStart);
assert.match(html.slice(vendorStart, travelStart), /VP-101|Total Reported/);
assert.doesNotMatch(html.slice(vendorStart, travelStart), /TVL-201/);
assert.match(html.slice(travelStart, emptyStart), /Total Export Rows/);
assert.doesNotMatch(html.slice(travelStart, emptyStart), /VP-101/);
assert.doesNotMatch(html.slice(emptyStart), /No Vendor Portal export|No Wonder Miles/);
assert.equal((html.match(/Vendor Portal Bugs/g) || []).length, 1, 'portfolio PDF must not add an aggregate Vendor Portal section');
assert.equal((html.match(/Wonder Miles Export Data/g) || []).length, 1, 'portfolio PDF must not add an aggregate Wonder Miles section');

const legacyDashboard: DashboardPayload = {
  ...dashboard,
  byProject: [slice('VENDOR', { uat: vendorSlice.uat, files: undefined })],
  scope: {
    ...dashboard.scope,
    projects: ['VENDOR'],
    capabilitiesByProject: { VENDOR: { vendorPortal: true, wonderMilesExport: false } },
  },
};
const legacyHtml = renderToStaticMarkup(
  <ReportPrintContent dashboard={legacyDashboard} kpiStyle="editorial" reportType="defects" narrative="" startDate="2026-07-01" endDate="2026-07-31" />,
);
assert.match(legacyHtml, /Regenerate the report/);
assert.doesNotMatch(legacyHtml, /Total Reported/);

console.log('Portfolio PDF project breakdown tests passed');
