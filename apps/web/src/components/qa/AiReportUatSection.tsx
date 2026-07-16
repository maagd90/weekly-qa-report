import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { QA, fmt, PRIORITY_COLORS } from '../../theme/qaTheme';
import { PriorityDonut } from './ResultDonut';
import { HorizBar } from './SegBar';
import { VendorPortalPhaseChart } from './VendorPortalPhaseChart';

type UatPayload = NonNullable<DashboardPayload['uat']>;
type UatCrSummary = { cr: string; total: number; open: number; closed: number };
type UatAreaSummary = { area: string; total: number; open: number; closed: number };
type UatStatusSummary = { status: string; count: number };
type UatWithAggregates = UatPayload & {
  byCr: UatCrSummary[];
  byAreaDetail: UatAreaSummary[];
  openByStatus: UatStatusSummary[];
};

function isClosedStatus(status: string): boolean {
  return /closed|done|resolved|cancel/i.test(status || '');
}

function withUatAggregates(uat: UatPayload): UatWithAggregates {
  const crMap = new Map<string, { total: number; open: number }>();
  const areaMap = new Map<string, { total: number; open: number }>();
  const openStatusMap = new Map<string, number>();

  for (const row of uat.rows) {
    const cr = row.cr || 'Unassigned';
    const area = row.area || 'Unassigned';
    const status = row.status || 'Unknown';
    const open = !isClosedStatus(status);

    const crSummary = crMap.get(cr) || { total: 0, open: 0 };
    crSummary.total += 1;
    if (open) crSummary.open += 1;
    crMap.set(cr, crSummary);

    const areaSummary = areaMap.get(area) || { total: 0, open: 0 };
    areaSummary.total += 1;
    if (open) areaSummary.open += 1;
    areaMap.set(area, areaSummary);

    if (open) openStatusMap.set(status, (openStatusMap.get(status) || 0) + 1);
  }

  return {
    ...uat,
    byCr: [...crMap.entries()]
      .map(([cr, value]) => ({ cr, total: value.total, open: value.open, closed: value.total - value.open }))
      .sort((a, b) => b.total - a.total),
    byAreaDetail: [...areaMap.entries()]
      .map(([area, value]) => ({ area, total: value.total, open: value.open, closed: value.total - value.open }))
      .sort((a, b) => b.total - a.total),
    openByStatus: [...openStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function barPct(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max((count / max) * 100, 3);
}

export function AiReportUatSection({ uat: rawUat }: { uat: UatPayload }) {
  const uat = withUatAggregates(rawUat);
  const statusMax = Math.max(1, ...uat.byStatus.map((status) => status.count));
  const areaMax = Math.max(1, ...uat.byAreaDetail.map((area) => area.total));
  const pendingMax = Math.max(1, ...uat.openByStatus.map((status) => status.count));

  const priorityItems = useMemo(
    () => uat.byPriority.map((priority) => ({
      label: priority.priority,
      count: priority.count,
      color: PRIORITY_COLORS[priority.priority] || QA.muted,
    })),
    [uat.byPriority],
  );

  const openClosedItems = useMemo(
    () => [
      { label: 'Open / Pending', count: uat.open, color: QA.BLOCKED },
      { label: 'Closed', count: uat.closed, color: QA.PASS },
    ],
    [uat.open, uat.closed],
  );

  const pendingTotal = uat.openByStatus.reduce((total, status) => total + status.count, 0);

  return (
    <>
      <div className="pdf-section border border-qa-border p-5 bg-white">
        <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-4">
          Vendor Portal Bugs — Reported
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Reported', value: fmt(uat.total), color: QA.accent },
            { label: 'Open / Pending', value: fmt(uat.open), color: QA.BLOCKED },
            { label: 'Closed', value: fmt(uat.closed), color: QA.PASS },
            { label: 'Urgent Open', value: fmt(uat.urgentOpen), color: QA.FAIL },
          ].map((kpi) => (
            <div key={kpi.label} className="border border-[#efece4] p-3 bg-[#faf8f2]">
              <div className="font-mono-qa text-[9px] uppercase text-qa-muted-light mb-1">{kpi.label}</div>
              <div className="font-spectral text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {uat.byReportedPhase?.some((item) => item.count > 0) && (
          <div className="mb-6 border border-[#efece4] bg-white p-4">
            <div className="text-[12.5px] font-semibold">Reported Phase / Environment</div>
            <div className="mb-4 mt-1 text-[10.5px] text-qa-muted-light">Derived from Subject prefixes across the uploaded Vendor Portal spreadsheets.</div>
            <VendorPortalPhaseChart items={uat.byReportedPhase} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="border border-[#efece4] p-4 bg-[#faf8f2] min-w-0">
            <div className="text-[12.5px] font-semibold mb-3">Open vs Closed</div>
            <PriorityDonut items={openClosedItems} />
          </div>
          <div className="border border-[#efece4] p-4 bg-white min-w-0">
            <div className="text-[12.5px] font-semibold mb-3">By Priority</div>
            <PriorityDonut items={priorityItems} />
          </div>
        </div>
      </div>

      <div className="pdf-section border border-qa-border p-5 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold mb-1">Pending / Open by Status</div>
            <div className="text-[11px] text-qa-muted mb-3">{fmt(pendingTotal)} in-flight issues</div>
            {uat.openByStatus.length === 0 ? (
              <div className="text-[12px] text-qa-muted-light">No open issues in scope.</div>
            ) : (
              uat.openByStatus.map((status) => (
                <div key={status.status} className="mb-2.5">
                  <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                    <span className="truncate">{status.status}</span>
                    <span className="font-mono-qa shrink-0">{status.count}</span>
                  </div>
                  <HorizBar pct={barPct(status.count, pendingMax)} color={QA.BLOCKED} />
                </div>
              ))
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold mb-1">By Product Area</div>
            <div className="text-[11px] text-qa-muted mb-3">Total issues · open count in label</div>
            {uat.byAreaDetail.map((area) => (
              <div key={area.area} className="mb-2.5">
                <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                  <span className="truncate">{area.area || '—'}</span>
                  <span className="font-mono-qa shrink-0 text-qa-muted">{area.total} · {area.open} open</span>
                </div>
                <HorizBar pct={barPct(area.total, areaMax)} color={QA.NA} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold mb-3">All Issues by Status</div>
            {uat.byStatus.map((status) => (
              <div key={status.status} className="flex items-center gap-2 mb-2">
                <span className="text-[12px] w-[110px] shrink-0 truncate">{status.status}</span>
                <div className="flex-1 min-w-0"><HorizBar pct={barPct(status.count, statusMax)} color={QA.accent} /></div>
                <span className="font-mono-qa text-[11px] text-qa-muted w-6 text-right">{status.count}</span>
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold mb-3">Reported by (Submitter)</div>
            {uat.bySubmitter.slice(0, 8).map((submitter) => {
              const max = uat.bySubmitter[0]?.count || 1;
              return (
                <div key={submitter.name} className="mb-2">
                  <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                    <span className="truncate">{submitter.name}</span>
                    <span className="font-mono-qa shrink-0">{submitter.count} bugs</span>
                  </div>
                  <HorizBar pct={barPct(submitter.count, max)} color={QA.accent} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="pdf-section border border-qa-border p-5 bg-white">
        <div className="text-[12.5px] font-semibold mb-3">Issues by Change Request (CR)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-qa-ink text-left font-mono-qa text-[10px] uppercase text-qa-muted-light">
                <th className="py-2 pr-3">Change Request</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Open</th>
                <th className="py-2 pr-3 text-right">Closed</th>
                <th className="py-2 text-right">Closure %</th>
              </tr>
            </thead>
            <tbody>
              {uat.byCr.map((row) => (
                <tr key={row.cr} className="border-b border-[#f3f0e8] last:border-b-0">
                  <td className="py-2 pr-3 font-semibold max-w-[200px] truncate" title={row.cr}>{row.cr}</td>
                  <td className="py-2 pr-3 text-right font-mono-qa">{row.total}</td>
                  <td className="py-2 pr-3 text-right font-mono-qa" style={{ color: QA.BLOCKED }}>{row.open}</td>
                  <td className="py-2 pr-3 text-right font-mono-qa" style={{ color: QA.PASS }}>{row.closed}</td>
                  <td className="py-2 text-right font-mono-qa">
                    {row.total ? Math.round((row.closed / row.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {uat.rows.length > 0 && (
        <div className="pdf-section border border-qa-border p-5 bg-white">
          <div className="text-[12.5px] font-semibold mb-3">Vendor Portal Bug Detail (top {Math.min(uat.rows.length, 15)})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b border-qa-border text-left font-mono-qa text-[9px] uppercase text-qa-muted-light">
                  <th className="py-2 pr-2">Ticket</th>
                  <th className="py-2 pr-2">CR</th>
                  <th className="py-2 pr-2">Area</th>
                  <th className="py-2 pr-2">Priority</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {uat.rows.slice(0, 15).map((row) => (
                  <tr key={row.id} className="border-b border-[#f3f0e8] last:border-b-0">
                    <td className="py-2 pr-2 font-mono-qa whitespace-nowrap" style={{ color: QA.accent }}>{row.id}</td>
                    <td className="py-2 pr-2 max-w-[100px] truncate">{row.cr}</td>
                    <td className="py-2 pr-2 max-w-[100px] truncate text-qa-muted">{row.area}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <span
                        className="font-mono-qa text-[9px] px-1.5 py-0.5 text-white"
                        style={{ background: PRIORITY_COLORS[row.priority] || QA.muted }}
                      >
                        {row.priority}
                      </span>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">{row.status}</td>
                    <td className="py-2 text-qa-muted whitespace-nowrap">{row.submitter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
