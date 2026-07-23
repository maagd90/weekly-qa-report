import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DashboardPayload, DashboardWorkItem, ProjectCapabilities } from 'qa-dashboard-batch';
import { AiReportCharts } from '../AiReportCharts.tsx';
import { ReportPrintContent } from '../ReportPrintContent.tsx';

function dashboardFixture(args: {
  project: string;
  capabilities: ProjectCapabilities;
  workItems?: DashboardWorkItem[];
  includeJiraFile?: boolean;
  includeOdlFile?: boolean;
  vendorTotal?: number;
}): DashboardPayload {
  const workItems = args.workItems || [];
  const stories = workItems.filter((row) => row.issueType === 'Story');
  const bugs = workItems.filter((row) => row.issueType === 'Bug');
  const vendorTotal = args.vendorTotal || 0;
  return {
    scope: {
      startDate: '2026-07-01',
      endDate: '2026-07-21',
      search: '',
      result: 'all',
      project: args.project,
      projects: [args.project],
      capabilitiesByProject: { [args.project]: args.capabilities },
    },
    overview: { totalCases: 0, executed: 0, passRate: 0, failed: 0, blocked: 0, resultMix: [], byMonth: [], chartSeries: { resultMix: [] } },
    testers: [],
    cycles: [],
    cyclesByPassPctAsc: [],
    storyBug: {
      story: stories.length,
      bug: bugs.length,
      storyOpen: stories.filter((row) => row.status === 'open').length,
      storyDone: stories.filter((row) => row.status === 'done').length,
      bugOpen: bugs.filter((row) => row.status === 'open').length,
      bugDone: bugs.filter((row) => row.status === 'done').length,
    },
    traceability: [],
    workItems,
    defectBacklog: { openTotal: bugs.filter((row) => row.status === 'open').length, byPriority: [], topPriorities: [], byOwner: [] },
    uat: vendorTotal ? {
      total: vendorTotal,
      open: vendorTotal,
      closed: 0,
      closureRate: 0,
      urgentOpen: 0,
      byStatus: [],
      byPriority: [],
      byArea: [],
      bySubmitter: [],
      byReportedPhase: [],
      sourceFiles: [],
      rows: [],
    } : null,
    files: [
      ...(args.includeJiraFile ? [{ name: 'wonder-export.xlsx', ext: '.xlsx', project: args.project, rows: workItems.length, status: 'parsed' as const, detectedType: 'jira' as const, source: 'file' as const }] : []),
      ...(args.includeOdlFile ? [{ name: 'vendor-export.xlsx', ext: '.xlsx', project: args.project, rows: 1, status: 'parsed' as const, detectedType: 'odl' as const, source: 'file' as const }] : []),
    ],
    meta: { generatedAt: '2026-07-22T08:00:00.000Z', parsedAt: '2026-07-22T07:00:00.000Z', fetchedAt: null, warnings: [] },
  };
}

const wonderMilesCapabilities = { vendorPortal: false, wonderMilesExport: true };
const uploadedWonderMilesRow: DashboardWorkItem = {
  key: 'WM-101',
  summary: 'Exported Wonder Miles defect',
  issueType: 'Bug',
  status: 'open',
  priority: 'High',
  assignee: 'QA One',
  sprint: 'Sprint 1',
  area: 'Export',
  project: 'TRAVEL',
  updatedAt: '2026-07-10',
  sourceFile: 'wonder-export.xlsx',
};

const wonderDashboard = dashboardFixture({
  project: 'TRAVEL',
  capabilities: wonderMilesCapabilities,
  workItems: [uploadedWonderMilesRow],
  includeJiraFile: true,
});
const wonderCharts = renderToStaticMarkup(<AiReportCharts dashboard={wonderDashboard} kpiStyle="editorial" reportType="defects" />);
assert.match(wonderCharts, /Wonder Miles Export Data/);
assert.match(wonderCharts, /WM-101/);
assert.doesNotMatch(wonderCharts, /No Vendor Portal bugs/);

const emptyWonderDashboard = dashboardFixture({
  project: 'TRAVEL',
  capabilities: wonderMilesCapabilities,
  includeJiraFile: true,
});
const emptyWonderCharts = renderToStaticMarkup(<AiReportCharts dashboard={emptyWonderDashboard} kpiStyle="editorial" reportType="defects" />);
assert.match(emptyWonderCharts, /No Wonder Miles Export Data falls within the selected date range/);
assert.doesNotMatch(emptyWonderCharts, /No Vendor Portal bugs/);

const vendorDashboard = dashboardFixture({
  project: 'DLM',
  capabilities: { vendorPortal: true, wonderMilesExport: false },
});
const vendorCharts = renderToStaticMarkup(<AiReportCharts dashboard={vendorDashboard} kpiStyle="editorial" reportType="defects" />);
assert.match(vendorCharts, /No Vendor Portal export is staged/);
assert.doesNotMatch(vendorCharts, /No Wonder Miles/);

const outOfRangeVendorDashboard = dashboardFixture({
  project: 'VENDOR',
  capabilities: { vendorPortal: true, wonderMilesExport: false },
  includeOdlFile: true,
});
const outOfRangeVendorCharts = renderToStaticMarkup(<AiReportCharts dashboard={outOfRangeVendorDashboard} kpiStyle="editorial" reportType="defects" />);
assert.match(outOfRangeVendorCharts, /No Vendor Portal bugs fall within the selected date range/);

const wonderPdf = renderToStaticMarkup(
  <ReportPrintContent
    dashboard={wonderDashboard}
    kpiStyle="editorial"
    reportType="defects"
    narrative=""
    startDate="2026-07-01"
    endDate="2026-07-21"
  />,
);
assert.match(wonderPdf, /Wonder Miles Export Data/);
assert.match(wonderPdf, /Total Export Rows/);
assert.doesNotMatch(wonderPdf, /Vendor Portal Bug Verification Summary/);

console.log('Report capability rendering tests passed');
