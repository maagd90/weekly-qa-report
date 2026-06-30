import React, { useMemo } from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { QA, fmt, PRIORITY_COLORS } from '../../theme/qaTheme';
import { PriorityDonut } from './ResultDonut';
import { HorizBar } from './SegBar';

type UatPayload = NonNullable<DashboardPayload['uat']>;

function withUatAggregates(uat: UatPayload): UatPayload {
  if (uat.byCr?.length && uat.byAreaDetail?.length && uat.openByStatus?.length) return uat;

  const crMap: Record<string, { total: number; open: number }> = {};
  const areaMap: Record<string, { total: number; open: number }> = {};
  const openSt: Record<string, number> = {};

  for (const r of uat.rows) {
    const open = r.status.toLowerCase() !== 'closed';
    if (!crMap[r.cr]) crMap[r.cr] = { total: 0, open: 0 };
    crMap[r.cr].total += 1;
    if (open) crMap[r.cr].open += 1;

    if (!areaMap[r.area]) areaMap[r.area] = { total: 0, open: 0 };
    areaMap[r.area].total += 1;
    if (open) areaMap[r.area].open += 1;

    if (open) openSt[r.status] = (openSt[r.status] || 0) + 1;
  }

  return {
    ...uat,
    byCr: uat.byCr?.length ? uat.byCr : Object.entries(crMap)
      .map(([cr, v]) => ({ cr, total: v.total, open: v.open, closed: v.total - v.open }))
      .sort((a, b) => b.total - a.total),
    byAreaDetail: uat.byAreaDetail?.length ? uat.byAreaDetail : Object.entries(areaMap)
      .map(([area, v]) => ({ area, total: v.total, open: v.open, closed: v.total - v.open }))
      .sort((a, b) => b.total - a.total),
    openByStatus: uat.openByStatus?.length ? uat.openByStatus : Object.entries(openSt)
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
  const statusMax = Math.max(1, ...uat.byStatus.map((s) => s.count));
  const areaMax = Math.max(1, ...uat.byAreaDetail.map((a) => a.total));
  const pendingMax = Math.max(1, ...uat.openByStatus.map((s) => s.count));

  const priorityItems = useMemo(
    () => uat.byPriority.map((p) => ({
      label: p.priority,
      count: p.count,
      color: PRIORITY_COLORS[p.priority] || QA.muted,
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

  const pendingTotal = uat.openByStatus.reduce((a, s) => a + s.count, 0);

  return (
    <div className="border border-qa-border p-5 bg-white pdf-avoid-break">
      <div className="font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light mb-4">
        UAT Issues — Bugs Reported
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Reported', value: fmt(uat.total), color: QA.accent },
          { label: 'Open / Pending', value: fmt(uat.open), color: QA.BLOCKED },
          { label: 'Closed', value: fmt(uat.closed), color: QA.PASS },
          { label: 'Urgent Open', value: fmt(uat.urgentOpen), color: QA.FAIL },
        ].map((k) => (
          <div key={k.label} className="border border-[#efece4] p-3 bg-[#faf8f2]">
            <div className="font-mono-qa text-[9px] uppercase text-qa-muted-light mb-1">{k.label}</div>
            <div className="font-spectral text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <div className="border border-[#efece4] p-4 bg-[#faf8f2] min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-3">Open vs Closed</div>
          <PriorityDonut items={openClosedItems} />
        </div>
        <div className="border border-[#efece4] p-4 bg-white min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-3">By Priority</div>
          <PriorityDonut items={priorityItems} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <div className="min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-1">Pending / Open by Status</div>
          <div className="text-[11px] text-qa-muted mb-3">{fmt(pendingTotal)} in-flight issues</div>
          {uat.openByStatus.length === 0 ? (
            <div className="text-[12px] text-qa-muted-light">No open issues in scope.</div>
          ) : (
            uat.openByStatus.map((s) => (
              <div key={s.status} className="mb-2.5">
                <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                  <span className="truncate">{s.status}</span>
                  <span className="font-mono-qa shrink-0">{s.count}</span>
                </div>
                <HorizBar pct={barPct(s.count, pendingMax)} color={QA.BLOCKED} />
              </div>
            ))
          )}
        </div>
        <div className="min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-1">By Product Area</div>
          <div className="text-[11px] text-qa-muted mb-3">Total issues · open count in label</div>
          {uat.byAreaDetail.map((a) => (
            <div key={a.area} className="mb-2.5">
              <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                <span className="truncate">{a.area || '—'}</span>
                <span className="font-mono-qa shrink-0 text-qa-muted">{a.total} · {a.open} open</span>
              </div>
              <HorizBar pct={barPct(a.total, areaMax)} color={QA.NA} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <div className="min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-3">All Issues by Status</div>
          {uat.byStatus.map((s) => (
            <div key={s.status} className="flex items-center gap-2 mb-2">
              <span className="text-[12px] w-[110px] shrink-0 truncate">{s.status}</span>
              <div className="flex-1 min-w-0"><HorizBar pct={barPct(s.count, statusMax)} color={QA.accent} /></div>
              <span className="font-mono-qa text-[11px] text-qa-muted w-6 text-right">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="min-w-0 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-3">Reported by (Submitter)</div>
          {uat.bySubmitter.slice(0, 8).map((s) => {
            const max = uat.bySubmitter[0]?.count || 1;
            return (
              <div key={s.name} className="mb-2">
                <div className="flex justify-between text-[12px] mb-0.5 gap-2">
                  <span className="truncate">{s.name}</span>
                  <span className="font-mono-qa shrink-0">{s.count} bugs</span>
                </div>
                <HorizBar pct={barPct(s.count, max)} color={QA.accent} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="pdf-avoid-break">
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
        <div className="mt-6 pdf-avoid-break">
          <div className="text-[12.5px] font-semibold mb-3">UAT Issue Detail (top {Math.min(uat.rows.length, 15)})</div>
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
                {uat.rows.slice(0, 15).map((r) => (
                  <tr key={r.id} className="border-b border-[#f3f0e8] last:border-b-0">
                    <td className="py-2 pr-2 font-mono-qa whitespace-nowrap" style={{ color: QA.accent }}>{r.id}</td>
                    <td className="py-2 pr-2 max-w-[100px] truncate">{r.cr}</td>
                    <td className="py-2 pr-2 max-w-[100px] truncate text-qa-muted">{r.area}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <span
                        className="font-mono-qa text-[9px] px-1.5 py-0.5 text-white"
                        style={{ background: PRIORITY_COLORS[r.priority] || QA.muted }}
                      >
                        {r.priority}
                      </span>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">{r.status}</td>
                    <td className="py-2 text-qa-muted whitespace-nowrap">{r.submitter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
