import React from 'react';
import { QA, fmt } from '../../theme/qaTheme';

interface MonthData {
  label: string;
  pass: number;
  blocked: number;
  fail: number;
}

export function StackedMonthChart({ data }: { data: MonthData[] }) {
  if (!data.length) {
    return <div className="h-[210px] flex items-center justify-center text-qa-muted-light text-sm">No monthly data</div>;
  }

  const maxTotal = Math.max(...data.map((m) => m.pass + m.blocked + m.fail), 1);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-spectral font-semibold text-base m-0">Executions by Month</h3>
        <div className="flex gap-3.5 flex-wrap">
          {[
            { label: 'Pass', color: QA.PASS },
            { label: 'Blocked', color: QA.BLOCKED },
            { label: 'Fail', color: QA.FAIL },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1 text-[10.5px] text-qa-muted">
              <span className="w-2.5 h-2.5" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-[26px] h-[210px] px-2.5 mt-4">
        {data.map((m) => {
          const total = m.pass + m.blocked + m.fail;
          const h = (v: number) => ({ height: `${(v / maxTotal) * 170}px` });
          return (
            <div key={m.label} className="flex-1 flex flex-col items-center gap-2 h-full min-w-0">
              <div className="flex-1 w-full flex flex-col justify-end items-center">
                <span className="font-mono-qa text-[11px] text-qa-ink mb-1">{fmt(total)}</span>
                <div className="w-[62%] flex flex-col">
                  <div className="w-full" style={{ ...h(m.fail), background: QA.FAIL }} />
                  <div className="w-full" style={{ ...h(m.blocked), background: QA.BLOCKED }} />
                  <div className="w-full" style={{ ...h(m.pass), background: QA.PASS }} />
                </div>
              </div>
              <span className="font-mono-qa text-[11px] text-qa-muted">{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
