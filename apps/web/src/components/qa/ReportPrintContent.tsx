import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardPayload, ReportType } from 'qa-dashboard-batch';
import type { KpiStyle } from '../../theme/qaTheme';
import { projectDisplayName } from '../../lib/projectDisplay';
import { ResultDonut } from './ResultDonut';
import { StackedMonthChart } from './StackedMonthChart';
import { VendorPortalPhaseChart } from './VendorPortalPhaseChart';
import { hasWonderMilesExportData, uploadedRows, wonderMilesEmptyMessage } from './AiReportWonderMilesSection';
import { scopeHasReportCapability } from '../../lib/reportCapabilities';

interface ReportPrintContentProps {
  dashboard: DashboardPayload;
  kpiStyle: KpiStyle;
  reportType: ReportType;
  narrative: string;
  startDate: string;
  endDate: string;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  logoAlt?: string;
}

function Section({ no, title, children }: { no: number; title: string; children: React.ReactNode }) {
  return (
    <section className="qa-business-section">
      <h2 className="qa-business-section-title" data-no={no}>{title}</h2>
      {children}
    </section>
  );
}

function reportTypeLabel(reportType: ReportType): string {
  if (reportType === 'executive') return 'Executive';
  if (reportType === 'cycles') return 'Cycle Health';
  if (reportType === 'defects') return 'Defects';
  if (reportType === 'testers') return 'Quality Assurance Performance';
  return 'Full';
}

function isDefectReport(reportType: ReportType): boolean {
  return reportType === 'defects';
}

function QualityAssuranceRows({ dashboard }: { dashboard: DashboardPayload }) {
  if (!dashboard.testers.length) return <p>No named Quality Assurance executions are available for this reporting scope.</p>;
  return <table className="qa-business-table"><thead><tr><th>Quality Assurance member</th><th>Executed</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>N/A</th><th>Pass %</th></tr></thead><tbody>{dashboard.testers.map((member) => <tr key={member.name}><td>{member.name}</td><td className="qa-business-number">{member.executed}</td><td className="qa-business-number">{member.pass}</td><td className="qa-business-number">{member.fail}</td><td className="qa-business-number">{member.blocked}</td><td className="qa-business-number">{member.na}</td><td className="qa-business-number">{member.passPct}%</td></tr>)}</tbody></table>;
}

function VendorPortalStatTable({ dashboard }: { dashboard: DashboardPayload }) {
  const uat = dashboard.uat;
  if (!uat?.total) return <p>No Vendor Portal bugs fall within the selected date range.</p>;
  return (
    <table className="qa-business-table qa-business-stat">
      <thead><tr><th>Closed / Done</th><th>Open in Period</th><th>Total Reported</th><th>Closure Rate</th></tr></thead>
      <tbody><tr><td className="qa-business-green">{uat.closed}</td><td className="qa-business-red">{uat.open}</td><td>{uat.total}</td><td>{uat.closureRate}%</td></tr></tbody>
    </table>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = /complete|closed|done|healthy/i.test(status) ? '#2f6a48' : /risk|open|fail/i.test(status) ? '#a13d2c' : '#9a6a12';
  return <span style={{ color, fontWeight: 600 }}>■ {status}</span>;
}

function DefectRows({ dashboard, limit = 8 }: { dashboard: DashboardPayload; limit?: number }) {
  const rows = dashboard.defectBacklog.byOwner.slice(0, limit);
  if (!rows.length) return <p>No open defects with activity in the selected period.</p>;
  return <table className="qa-business-table"><thead><tr><th>Owner</th><th>Open in Period</th></tr></thead><tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="qa-business-number">{r.open}</td></tr>)}</tbody></table>;
}

function CycleRows({ dashboard, limit = 8 }: { dashboard: DashboardPayload; limit?: number }) {
  const rows = dashboard.cyclesByPassPctAsc.slice(0, limit);
  if (!rows.length) return <p>No cycle execution data is available for the selected scope.</p>;
  return <table className="qa-business-table"><thead><tr><th>Cycle</th><th>Status</th><th>Pass %</th><th>Coverage</th><th>Cases</th></tr></thead><tbody>{rows.map((c) => <tr key={c.key}><td>{c.name}</td><td><StatusDot status={c.status} /></td><td className="qa-business-number">{c.passPct}%</td><td className="qa-business-number">{c.coverage}%</td><td className="qa-business-number">{c.total}</td></tr>)}</tbody></table>;
}

function ProjectStatus({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = dashboard.byProject?.length
    ? dashboard.byProject.map((p) => ({ area: projectDisplayName(p.project), status: p.defectBacklog.openTotal > 0 ? 'In Progress' : 'Completed' }))
    : [
      { area: 'Test Execution', status: dashboard.overview.failed || dashboard.overview.blocked ? 'In Progress' : 'Completed' },
      { area: 'Defect Verification', status: dashboard.storyBug.bugOpen ? 'Open Issue Active in Period' : 'Completed' },
      { area: 'Cycle Validation', status: dashboard.cycles.some((c) => c.status === 'At Risk') ? 'In Progress' : 'Mostly Completed' },
    ];
  return <table className="qa-business-table"><thead><tr><th>Area</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.area}><td>{r.area}</td><td><StatusDot status={r.status} /></td></tr>)}</tbody></table>;
}

function ProjectComparison({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = dashboard.byProject || [];
  if (!rows.length) return null;
  return <table className="qa-business-table"><thead><tr><th>Project</th><th>Cases</th><th>Executed</th><th>Pass %</th><th>Open defects</th><th>Blocked</th><th>Cycles</th></tr></thead><tbody>{rows.map((slice) => <tr key={slice.project}><td>{projectDisplayName(slice.project)}</td><td className="qa-business-number">{slice.overview.totalCases}</td><td className="qa-business-number">{slice.overview.executed}</td><td className="qa-business-number">{slice.overview.passRate}%</td><td className="qa-business-number">{slice.storyBug.bugOpen}</td><td className="qa-business-number">{slice.overview.blocked}</td><td className="qa-business-number">{slice.cycles.length}</td></tr>)}</tbody></table>;
}

function WonderMilesRows({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = uploadedRows(dashboard);
  const stories = rows.filter((row) => row.issueType === 'Story').length;
  const bugs = rows.filter((row) => row.issueType === 'Bug').length;
  const openBugs = rows.filter((row) => row.issueType === 'Bug' && row.status === 'open').length;
  return <table className="qa-business-table qa-business-stat"><thead><tr><th>Total Export Rows</th><th>Stories</th><th>Bugs</th><th>Open Bugs</th></tr></thead><tbody><tr><td>{rows.length}</td><td>{stories}</td><td>{bugs}</td><td className="qa-business-red">{openBugs}</td></tr></tbody></table>;
}

function formatReportDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatGeneratedAt(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function ReportPrintContent({ dashboard, reportType, narrative, startDate, endDate, title, subtitle, logoUrl, logoAlt }: ReportPrintContentProps) {
  const projectLabel = dashboard.scope.project && dashboard.scope.project !== 'all' ? projectDisplayName(dashboard.scope.project) : 'All Projects';
  const sprintLabel = `${formatReportDate(startDate)} – ${formatReportDate(endDate)}`;
  const generatedLabel = formatGeneratedAt(dashboard.meta.generatedAt);
  const failedOrBlocked = dashboard.overview.failed + dashboard.overview.blocked;
  const defectReport = isDefectReport(reportType);
  const cycleReport = reportType === 'cycles';
  const executiveReport = reportType === 'executive';
  const fullReport = reportType === 'full';
  const qualityAssuranceReport = reportType === 'testers';
  const showDefects = fullReport || executiveReport || defectReport;
  const showExecution = fullReport || executiveReport || cycleReport || qualityAssuranceReport;
  const showCycles = fullReport || cycleReport;
  const showStatus = fullReport || executiveReport;
  const showPlan = fullReport || executiveReport;
  const showVendorPortal = showDefects && scopeHasReportCapability(dashboard, 'vendorPortal');
  const showWonderMiles = showDefects && scopeHasReportCapability(dashboard, 'wonderMilesExport');
  const vendorPortalPhases = dashboard.uat?.byReportedPhase || [];
  const showVendorPortalPhaseChart = showVendorPortal && vendorPortalPhases.some((item) => item.count > 0);

  let sectionNo = 1;
  const nextNo = () => sectionNo++;

  return (
    <div className="qa-print-page qa-print-document qa-business-report bg-white">
      <div className="qa-business-tearstrip" />
      <div className="qa-business-header">
        <div className="qa-business-header-title">
          <p className="qa-business-header-eyebrow">{subtitle || 'Weekly QA sprint report'}</p>
          <h1>{title || 'QA Sprint Report'}</h1>
        </div>
        <div className="qa-business-header-meta">
          <div><b>Project</b> &nbsp;{projectLabel}</div>
          <div><b>Period</b> &nbsp;{sprintLabel}</div>
          <div><b>Scope</b> &nbsp;{reportTypeLabel(reportType)}</div>
          {generatedLabel && <div><b>Generated</b> &nbsp;{generatedLabel}</div>}
        </div>
        {logoUrl && (
          <div className="qa-business-header-logo">
            <img
              src={logoUrl}
              alt={logoAlt || 'Report logo'}
              onError={(event) => {
                const img = event.currentTarget;
                img.style.display = 'none';
              }}
            />
          </div>
        )}
      </div>

      <div className="qa-business-manifest">
        <div className="qa-business-stub">
          <p className="qa-business-stub-label">Total cases</p>
          <p className="qa-business-stub-value qa-mono">{dashboard.overview.totalCases}</p>
          <p className="qa-business-stub-sub">across {dashboard.cycles.length} cycles</p>
        </div>
        <div className="qa-business-stub">
          <p className="qa-business-stub-label">Pass rate</p>
          <p className="qa-business-stub-value qa-mono qa-business-green">{dashboard.overview.passRate}%</p>
          <p className="qa-business-stub-sub">of executed cases</p>
        </div>
        <div className="qa-business-stub">
          <p className="qa-business-stub-label">Open defects</p>
          <p className="qa-business-stub-value qa-mono qa-business-red">{dashboard.defectBacklog.openTotal}</p>
          <p className="qa-business-stub-sub">active in period</p>
        </div>
        <div className="qa-business-stub">
          <p className="qa-business-stub-label">At-risk cycles</p>
          <p className="qa-business-stub-value qa-mono qa-business-red">{dashboard.cycles.filter((c) => c.status === 'At Risk').length}</p>
          <p className="qa-business-stub-sub">of {dashboard.cycles.length} total</p>
        </div>
      </div>

      {dashboard.scope.project === 'all' && Boolean(dashboard.byProject?.length) && <Section no={nextNo()} title="Portfolio Project Comparison"><ProjectComparison dashboard={dashboard} /></Section>}

      <div className="px-6 pb-6">
        <Section no={nextNo()} title="Objective">
          <p>The objective of this sprint report is to summarize QA validation progress, execution health, defect verification, open risks, and upcoming validation focus for the selected reporting window.</p>
          <p>The report is generated from verified dashboard data only and is intended for business and delivery stakeholders.</p>
          <div className="qa-business-subtitle">Validation Focused On:</div>
          <div className="qa-business-panel"><ul><li>Test execution and pass/fail validation</li><li>JIRA defect and story status review</li><li>Period defect activity and priority analysis</li><li>Cycle health, coverage, and at-risk areas</li>{showVendorPortal && <li>Vendor Portal bug summary and closure tracking</li>}{showWonderMiles && <li>Wonder Miles uploaded Story and Bug export review</li>}</ul></div>
        </Section>

        {showVendorPortal && <Section no={nextNo()} title="Vendor Portal Bug Verification Summary">
          <VendorPortalStatTable dashboard={dashboard} />
          <p><em>Most defects verified in this sprint directly impact delivery readiness, execution stability, user validation, or production sign-off confidence.</em></p>
        </Section>}

        {showVendorPortalPhaseChart && <Section no={nextNo()} title="Vendor Portal Bug Distribution by Environment & Phase">
          <p>Vendor Portal rows are separated by the Subject prefix used in the uploaded daily ODL and production files.</p>
          <div className="qa-business-chart qa-business-vendor-phase-chart">
            <VendorPortalPhaseChart items={vendorPortalPhases} />
          </div>
        </Section>}

        {showWonderMiles && <Section no={nextNo()} title="Wonder Miles Export Data">{hasWonderMilesExportData(dashboard) ? <><p>Uploaded Wonder Miles Story and Bug export rows included in this report scope.</p><WonderMilesRows dashboard={dashboard} /></> : <p>{wonderMilesEmptyMessage(dashboard)}</p>}</Section>}

        {showExecution && <Section no={nextNo()} title="Test Execution Summary">
          <table className="qa-business-table"><thead><tr><th>Total Test Cases</th><th>Executed</th><th>Pass Rate</th><th>Failed</th><th>Blocked</th></tr></thead><tbody><tr><td className="qa-business-number">{dashboard.overview.totalCases}</td><td className="qa-business-number">{dashboard.overview.executed}</td><td className="qa-business-number">{dashboard.overview.passRate}%</td><td className="qa-business-number">{dashboard.overview.failed}</td><td className="qa-business-number">{dashboard.overview.blocked}</td></tr></tbody></table>
          {dashboard.overview.resultMix.length > 0 && <div className="mt-3 qa-business-chart"><ResultDonut items={dashboard.overview.resultMix} total={dashboard.overview.totalCases} /></div>}
        </Section>}

        {showExecution && dashboard.overview.byMonth.length > 0 && <Section no={nextNo()} title="Executions by Month">
          <div className="qa-business-chart"><StackedMonthChart data={dashboard.overview.byMonth} showTitle={false} /></div>
        </Section>}

        {showCycles && <Section no={nextNo()} title="Test Cycle Health"><CycleRows dashboard={dashboard} /></Section>}
        {qualityAssuranceReport && <Section no={nextNo()} title="Execution by Quality Assurance"><QualityAssuranceRows dashboard={dashboard} /></Section>}
        {showDefects && <Section no={nextNo()} title="Defects Active in Period"><DefectRows dashboard={dashboard} /></Section>}

        {showStatus && <Section no={nextNo()} title="Overall Sprint Status">
          <ProjectStatus dashboard={dashboard} />
          <p><strong>Overall:</strong> Sprint validation is progressing based on the selected scope. {failedOrBlocked > 0 ? 'Failed or blocked cases require continued tracking before sign-off.' : 'No failed or blocked execution items are currently visible in this scope.'}</p>
        </Section>}

        <Section no={nextNo()} title="Risks / Attention Required"><div className="qa-business-panel"><p><strong>Period Open Defect Risk</strong> - {dashboard.defectBacklog.openTotal} open defects had activity in the selected period.</p><p><strong>Execution Risk</strong> - {failedOrBlocked} failed or blocked test cases require follow-up.</p><p><strong>Cycle Risk</strong> - {dashboard.cycles.filter((c) => c.status === 'At Risk').length} test cycles are currently marked at risk.</p></div></Section>

        {showPlan && <Section no={nextNo()} title="Upcoming Sprint Plan"><div className="qa-business-panel"><ul><li>Re-test all fixes currently in progress.</li><li>Continue regression coverage for impacted business flows.</li><li>Prioritize validation of high-impact defects active in the selected period.</li><li>Prepare final sign-off evidence for closed defects.</li><li>Strengthen automation coverage for repeated UAT scenarios.</li></ul></div></Section>}

        {narrative && <Section no={nextNo()} title="Narrative Summary"><div className="prose prose-slate max-w-none prose-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown></div></Section>}

        <Section no={nextNo()} title="Final Summary">
          <table className="qa-business-table qa-business-stat"><thead><tr><th>Total Defects Verified</th><th>Closed / Done</th><th>Open in Period</th><th>Pass Rate</th></tr></thead><tbody><tr><td>{dashboard.storyBug.bug}</td><td className="qa-business-green">{dashboard.storyBug.bugDone}</td><td className="qa-business-red">{dashboard.storyBug.bugOpen}</td><td>{dashboard.overview.passRate}%</td></tr></tbody></table>
          <p>Sprint validation should continue for period-active open defects, failed test cases, and at-risk cycles until they are resolved or formally accepted by the business and technical stakeholders.</p>
        </Section>

        <div className="qa-business-footer">BUSINESS DOCUMENT - This document is intended for business use and should be distributed to intended recipients only.</div>
      </div>
    </div>
  );
}
