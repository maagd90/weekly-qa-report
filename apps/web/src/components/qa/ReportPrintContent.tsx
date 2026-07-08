import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardPayload, ReportType } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { projectDisplayName } from '../../lib/projectDisplay';

interface ReportPrintContentProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  reportType: ReportType;
  narrative: string;
  startDate: string;
  endDate: string;
}

function Section({ no, title, children }: { no: number; title: string; children: React.ReactNode }) {
  return (
    <section className="qa-business-section">
      <h2 className="qa-business-section-title">{no}. {title}</h2>
      {children}
    </section>
  );
}

function reportTypeLabel(reportType: ReportType): string {
  if (reportType === 'executive') return 'Executive';
  if (reportType === 'cycles') return 'Cycle Health';
  if (reportType === 'defects' || reportType === 'testers') return 'Defects';
  return 'Full';
}

function isDefectReport(reportType: ReportType): boolean {
  return reportType === 'defects' || reportType === 'testers';
}

function StatTable({ dashboard }: { dashboard: DashboardPayload }) {
  const totalDefects = dashboard.storyBug.bug;
  const closed = dashboard.storyBug.bugDone;
  const open = dashboard.storyBug.bugOpen;
  const inProgress = Math.max(0, totalDefects - closed - open);
  return (
    <table className="qa-business-table qa-business-stat">
      <thead><tr><th>Closed / Done</th><th>Fix in Progress</th><th>Open / Unresolved</th><th>Total Defects</th></tr></thead>
      <tbody><tr><td className="qa-business-green">{closed}</td><td className="qa-business-amber">{inProgress}</td><td className="qa-business-red">{open}</td><td className="qa-business-red">{totalDefects}</td></tr></tbody>
    </table>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = /complete|closed|done|healthy/i.test(status) ? '#00a651' : /risk|open|fail/i.test(status) ? '#d00000' : '#ff9d00';
  return <span style={{ color, fontWeight: 800 }}>■ {status}</span>;
}

function DefectRows({ dashboard, limit = 8 }: { dashboard: DashboardPayload; limit?: number }) {
  const rows = dashboard.defectBacklog.byOwner.slice(0, limit);
  if (!rows.length) return <p>No open defect owner backlog is available for the selected scope.</p>;
  return <table className="qa-business-table"><thead><tr><th>Owner</th><th>Open Defects</th></tr></thead><tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.open}</td></tr>)}</tbody></table>;
}

function CycleRows({ dashboard, limit = 8 }: { dashboard: DashboardPayload; limit?: number }) {
  const rows = dashboard.cyclesByPassPctAsc.slice(0, limit);
  if (!rows.length) return <p>No cycle execution data is available for the selected scope.</p>;
  return <table className="qa-business-table"><thead><tr><th>Cycle</th><th>Status</th><th>Pass %</th><th>Coverage</th><th>Cases</th></tr></thead><tbody>{rows.map((c) => <tr key={c.key}><td>{c.name}</td><td><StatusDot status={c.status} /></td><td>{c.passPct}%</td><td>{c.coverage}%</td><td>{c.total}</td></tr>)}</tbody></table>;
}

function ProjectStatus({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = dashboard.byProject?.length
    ? dashboard.byProject.map((p) => ({ area: projectDisplayName(p.project), status: p.defectBacklog.openTotal > 0 ? 'In Progress' : 'Completed' }))
    : [
      { area: 'Test Execution', status: dashboard.overview.failed || dashboard.overview.blocked ? 'In Progress' : 'Completed' },
      { area: 'Defect Verification', status: dashboard.storyBug.bugOpen ? 'Open Issue Pending' : 'Completed' },
      { area: 'Cycle Validation', status: dashboard.cycles.some((c) => c.status === 'At Risk') ? 'In Progress' : 'Mostly Completed' },
    ];
  return <table className="qa-business-table"><thead><tr><th>Area</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.area}><td>{r.area}</td><td><StatusDot status={r.status} /></td></tr>)}</tbody></table>;
}

export function ReportPrintContent({ dashboard, reportType, narrative, startDate, endDate }: ReportPrintContentProps) {
  const projectLabel = dashboard.scope.project && dashboard.scope.project !== 'all' ? projectDisplayName(dashboard.scope.project) : 'All Projects';
  const sprintLabel = `${startDate} - ${endDate}`;
  const failedOrBlocked = dashboard.overview.failed + dashboard.overview.blocked;
  const defectReport = isDefectReport(reportType);
  const cycleReport = reportType === 'cycles';
  const executiveReport = reportType === 'executive';
  const fullReport = reportType === 'full';
  const showDefects = fullReport || executiveReport || defectReport;
  const showExecution = fullReport || executiveReport || cycleReport;
  const showCycles = fullReport || cycleReport;
  const showStatus = fullReport || executiveReport;
  const showPlan = fullReport || executiveReport;

  let sectionNo = 1;
  const nextNo = () => sectionNo++;

  return (
    <div className="qa-print-page qa-print-document qa-business-report bg-white">
      <div className="qa-business-header">
        <h1>QA Sprint Report</h1>
        <p>{sprintLabel} &nbsp;|&nbsp; {projectLabel} &nbsp;|&nbsp; {reportTypeLabel(reportType)}</p>
      </div>

      <div className="px-6 pb-6">
        <Section no={nextNo()} title="Objective">
          <p>The objective of this sprint report is to summarize QA validation progress, execution health, defect verification, open risks, and upcoming validation focus for the selected reporting window.</p>
          <p>The report is generated from verified dashboard data only and is intended for business and delivery stakeholders.</p>
          <div className="qa-business-subtitle">Validation Focused On:</div>
          <div className="qa-business-panel"><ul><li>Test execution and pass/fail validation</li><li>JIRA defect and story status review</li><li>Open defect backlog and priority analysis</li><li>Cycle health, coverage, and at-risk areas</li><li>UAT summary and closure tracking</li></ul></div>
        </Section>

        {showDefects && <Section no={nextNo()} title="UAT Defect Verification Summary">
          <StatTable dashboard={dashboard} />
          <p><em>Most defects verified in this sprint directly impact delivery readiness, execution stability, user validation, or production sign-off confidence.</em></p>
        </Section>}

        {showExecution && <Section no={nextNo()} title="Test Execution Summary">
          <table className="qa-business-table"><thead><tr><th>Total Test Cases</th><th>Executed</th><th>Pass Rate</th><th>Failed</th><th>Blocked</th></tr></thead><tbody><tr><td>{dashboard.overview.totalCases}</td><td>{dashboard.overview.executed}</td><td>{dashboard.overview.passRate}%</td><td>{dashboard.overview.failed}</td><td>{dashboard.overview.blocked}</td></tr></tbody></table>
        </Section>}

        {showCycles && <Section no={nextNo()} title="Test Cycle Health"><CycleRows dashboard={dashboard} /></Section>}
        {showDefects && <Section no={nextNo()} title="Defects Still Open / Under Fix"><DefectRows dashboard={dashboard} /></Section>}

        {showStatus && <Section no={nextNo()} title="Overall Sprint Status">
          <ProjectStatus dashboard={dashboard} />
          <p><strong>Overall:</strong> Sprint validation is progressing based on the selected scope. {failedOrBlocked > 0 ? 'Failed or blocked cases require continued tracking before sign-off.' : 'No failed or blocked execution items are currently visible in this scope.'}</p>
        </Section>}

        <Section no={nextNo()} title="Risks / Attention Required"><div className="qa-business-panel"><p><strong>Open Defect Risk</strong> - {dashboard.defectBacklog.openTotal} open defects remain in scope.</p><p><strong>Execution Risk</strong> - {failedOrBlocked} failed or blocked test cases require follow-up.</p><p><strong>Cycle Risk</strong> - {dashboard.cycles.filter((c) => c.status === 'At Risk').length} test cycles are currently marked at risk.</p></div></Section>

        {showPlan && <Section no={nextNo()} title="Upcoming Sprint Plan"><div className="qa-business-panel"><ul><li>Re-test all fixes currently in progress.</li><li>Continue regression coverage for impacted business flows.</li><li>Prioritize validation of open high-impact defects.</li><li>Prepare final sign-off evidence for closed defects.</li><li>Strengthen automation coverage for repeated UAT scenarios.</li></ul></div></Section>}

        {narrative && <Section no={nextNo()} title="Narrative Summary"><div className="prose prose-slate max-w-none prose-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown></div></Section>}

        <Section no={nextNo()} title="Final Summary">
          <table className="qa-business-table qa-business-stat"><thead><tr><th>Total Defects Verified</th><th>Closed / Done</th><th>Open</th><th>Pass Rate</th></tr></thead><tbody><tr><td>{dashboard.storyBug.bug}</td><td className="qa-business-green">{dashboard.storyBug.bugDone}</td><td className="qa-business-red">{dashboard.storyBug.bugOpen}</td><td>{dashboard.overview.passRate}%</td></tr></tbody></table>
          <p>Sprint validation should continue until open defects, failed test cases, and at-risk cycles are resolved or formally accepted by the business and technical stakeholders.</p>
        </Section>

        <div className="qa-business-footer">BUSINESS DOCUMENT - This document is intended for business use and should be distributed to intended recipients only.</div>
      </div>
    </div>
  );
}
