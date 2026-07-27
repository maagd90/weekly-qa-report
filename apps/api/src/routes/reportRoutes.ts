import { Router, Request, Response } from 'express';
import { toErrorMessage } from 'qa-dashboard-batch';
import type { ReportType } from 'qa-dashboard-batch';
import { generateReportPdf, type ReportBrandingPayload } from '../services/reportPdf';
import {
  cleanProject,
  connectionSummary,
  hasMetrics,
  log,
  logError,
  reportArtifacts,
  reportScopeMatches,
  requestId,
  resolveConnections,
  REPORT_TYPES,
} from './shared/context';

const router = Router();

router.get('/report', (_req: Request, res: Response) => {
  const artifacts = reportArtifacts();
  if (!artifacts) return res.status(404).json({ error: 'No report generated yet.' });
  res.json(artifacts);
});

router.post('/report/pdf', async (req: Request, res: Response) => {
  const { startDate, endDate, reportType, kpiStyle, project, branding } = req.body as { startDate?: string; endDate?: string; reportType?: string; kpiStyle?: string; project?: string; branding?: ReportBrandingPayload };
  const clean = cleanProject(project);
  const connections = resolveConnections(req);
  log(req, 'POST /report/pdf:start', { startDate, endDate, reportType, kpiStyle, project: clean, hasLogo: Boolean(branding?.logoUrl), connections: connectionSummary(connections) });
  const type = REPORT_TYPES.includes(reportType as ReportType) ? (reportType as ReportType) : 'executive';
  const kpi = ['editorial', 'framed', 'minimal'].includes(kpiStyle || '') ? kpiStyle! : 'editorial';
  const artifacts = reportArtifacts();
  if (!artifacts) return res.status(404).json({ error: 'No report snapshot is available. Generate the selected report before downloading its PDF.', requestId: requestId(req) });
  const effectiveStartDate = startDate || artifacts.dashboard.scope.startDate || '';
  const effectiveEndDate = endDate || artifacts.dashboard.scope.endDate || '';
  if (!reportScopeMatches(artifacts.dashboard, artifacts.meta, { startDate: effectiveStartDate, endDate: effectiveEndDate, reportType: type, project: clean })) {
    return res.status(409).json({ error: 'The saved report snapshot does not match the selected project, dates, or report type. Generate the report again before downloading the PDF.', requestId: requestId(req) });
  }
  if (!hasMetrics(artifacts.dashboard)) return res.status(404).json({ error: 'The saved report snapshot contains no metrics.', requestId: requestId(req) });
  try {
    const reportId = artifacts.meta.generatedAt || artifacts.dashboard.meta.generatedAt;
    const pdfBuffer = await generateReportPdf(effectiveStartDate, effectiveEndDate, type, kpi, clean, branding, reportId);
    const suffix = clean ? `-${clean}` : '';
    const filename = `qa-report${suffix}-${effectiveStartDate}-to-${effectiveEndDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    logError(req, 'POST /report/pdf:failed', err, { project: clean });
    res.status(500).json({ error: `PDF generation failed: ${toErrorMessage(err)}`, requestId: requestId(req) });
  }
});

export default router;
