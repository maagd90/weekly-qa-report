import React from 'react';
import { displayResultColor, fmt } from '../../theme/qaTheme';

interface DonutItem {
  code: string;
  label: string;
  count: number;
  pct: number;
}

interface ResultDonutProps {
  items: DonutItem[];
  total: number;
}

export function ResultDonut({ items, total }: ResultDonutProps) {
  const dTot = total || 1;
  const r = 46;
  const circumference = 2 * Math.PI * r;
  let acc = 0;

  const segments = items
    .filter((item) => item.count > 0)
    .map((item) => {
      const len = (item.count / dTot) * circumference;
      const seg = {
        color: displayResultColor(item.code),
        dasharray: `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`,
        offset: (-acc).toFixed(2),
      };
      acc += len;
      return seg;
    });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg viewBox="0 0 120 120" className="w-[140px] h-[140px] shrink-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f0ede5" strokeWidth="17" />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="17"
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.offset}
          />
        ))}
      </svg>
      <div className="flex flex-col gap-2 flex-1 min-w-[160px]">
        {items.map((item) => (
          <div key={item.code} className="flex items-center gap-2">
            <span className="w-[11px] h-[11px] shrink-0" style={{ background: displayResultColor(item.code) }} />
            <span className="text-[12.5px] flex-1">{item.label}</span>
            <span className="font-mono-qa text-[11px] text-qa-muted-light">{item.pct}%</span>
            <span className="font-spectral font-bold text-lg w-[52px] text-right">{fmt(item.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PriorityDonutProps {
  items: { label: string; count: number; color: string }[];
}

export function PriorityDonut({ items }: PriorityDonutProps) {
  const total = items.reduce((a, b) => a + b.count, 0) || 1;
  const r = 46;
  const circumference = 2 * Math.PI * r;
  let acc = 0;

  const segments = items.filter((i) => i.count > 0).map((item) => {
    const len = (item.count / total) * circumference;
    const seg = {
      color: item.color,
      dasharray: `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`,
      offset: (-acc).toFixed(2),
    };
    acc += len;
    return seg;
  });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg viewBox="0 0 120 120" className="w-[130px] h-[130px] shrink-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f0ede5" strokeWidth="17" />
        {segments.map((s, i) => (
          <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="17"
            strokeDasharray={s.dasharray} strokeDashoffset={s.offset} />
        ))}
      </svg>
      <div className="flex flex-col gap-2.5 flex-1">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="w-[11px] h-[11px] shrink-0" style={{ background: item.color }} />
            <span className="text-[12.5px] flex-1">{item.label}</span>
            <span className="font-mono-qa text-[11px] text-qa-muted-light">{Math.round((item.count / total) * 100)}%</span>
            <span className="font-spectral font-bold text-[17px] w-8 text-right">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
