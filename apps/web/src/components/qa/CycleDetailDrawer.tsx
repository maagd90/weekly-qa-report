import React from 'react';
import type { DashboardPayload } from 'qa-dashboard-batch';
import { displayResultColor, fmt } from '../../theme/qaTheme';
import { SegBar, cycleSegSegments } from './SegBar';
import { CycleBadge } from './QaBadge';
import { QaSection } from '../layout/QaPageShell';

interface CycleDetailDrawerProps {
  cycle: DashboardPayload['cycles'][0] | null;
  onClose: () => void;
}

export function CycleDetailDrawer({ cycle, onClose }: CycleDetailDrawerProps) {
  if (!cycle) return null;

  const exec = cycle.pass + cycle.fail + cycle.blocked + cycle.na;
  const breakdown = [
    { key: 'PASS', label: 'Passed', n: cycle.pass },
    { key: 'FAIL', label: 'Failed', n: cycle.fail },
    { key: 'BLOCKED', label: 'Blocked', n: cycle.blocked },
    { key: 'NE', label: 'Not Executed', n: cycle.ne },
    { key: 'NA', label: 'Not Applicable', n: cycle.na },
  ].filter((b) => b.n > 0);

  let note: string;
  if (exec === 0) {
    note = `This cycle has not started — all ${cycle.total} cases are still queued. Schedule an owner before next week.`;
  } else if (cycle.coverage < 50) {
    note = `Quality looks fine on executed cases, but only ${cycle.coverage}% of the suite has run — ${cycle.ne} cases remain. Coverage, not pass rate, is the risk here.`;
  } else if (cycle.fail > 0 || cycle.blocked > 0) {
    note = `${cycle.fail} failed and ${cycle.blocked} blocked — pass rate is ${cycle.passPct}%. Review blockers before sign-off.`;
  } else {
    note = `Clean cycle — ${cycle.passPct}% pass rate across ${exec} executed cases.`;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <button type="button" className="flex-1 bg-black/30" onClick={onClose} aria-label="Close drawer" />
      <aside className="w-full max-w-md bg-[#F5F3ED] border-l border-qa-border shadow-xl overflow-y-auto qa-scroll">
        <div className="p-6 border-b-2 border-qa-ink">
          <button type="button" onClick={onClose} className="font-mono-qa text-[11px] text-qa-muted-light mb-4 cursor-pointer bg-transparent border-none">
            ← Back to cycles
          </button>
          <h3 className="font-spectral font-bold text-xl m-0 mb-1">{cycle.name}</h3>
          <div className="font-mono-qa text-[10px] text-qa-muted-light">{cycle.key}</div>
          <div className="mt-3"><CycleBadge status={cycle.status} /></div>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><div className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Pass rate</div><div className="font-spectral font-bold text-2xl">{exec ? `${cycle.passPct}%` : '—'}</div></div>
            <div><div className="font-mono-qa text-[10px] uppercase text-qa-muted-light">Coverage</div><div className="font-spectral font-bold text-2xl">{cycle.coverage}%</div></div>
          </div>
          <SegBar segments={cycleSegSegments(cycle.pass, cycle.fail, cycle.blocked, cycle.ne, cycle.na, cycle.total)} height={14} />
          <QaSection title="Result breakdown" noPadding className="border-qa-border">
            <div className="p-4 space-y-2">
              {breakdown.map((b) => (
                <div key={b.key} className="flex justify-between text-[13px]">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5" style={{ background: displayResultColor(b.key) }} />
                    {b.label}
                  </span>
                  <span className="font-mono-qa">{fmt(b.n)}</span>
                </div>
              ))}
            </div>
          </QaSection>
          <p className="text-[13px] text-qa-muted leading-relaxed m-0">{note}</p>
        </div>
      </aside>
    </div>
  );
}
