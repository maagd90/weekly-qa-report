import React from 'react';
import clsx from 'clsx';
import type { KpiStyle } from '../../theme/qaTheme';
import { softColor } from '../../theme/qaTheme';

interface QaKpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  kpiStyle: KpiStyle;
}

export function QaKpiCard({ label, value, sub, color = '#15605E', kpiStyle }: QaKpiCardProps) {
  const soft = softColor(color);
  let valueColor = color;

  const cardClass = clsx('flex gap-3.5 min-w-0 flex-1');
  let accent: React.ReactNode = (
    <div className="w-1 shrink-0" style={{ background: color }} />
  );

  if (kpiStyle === 'framed') {
    return (
      <div
        className={cardClass}
        style={{ background: soft.bg, border: `1px solid ${soft.border}`, padding: '16px 18px' }}
      >
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light">{label}</span>
          <span className="font-spectral font-bold text-[34px] leading-none tracking-tight" style={{ color: soft.fg }}>{value}</span>
          {sub && <span className="text-[11px] text-qa-muted leading-snug">{sub}</span>}
        </div>
      </div>
    );
  }

  if (kpiStyle === 'minimal') {
    valueColor = '#1C1B18';
    accent = null;
    return (
      <div className={clsx(cardClass, 'bg-transparent border-t-2 border-qa-ink pt-3.5 px-1')}>
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light">{label}</span>
          <span className="font-spectral font-bold text-[34px] leading-none tracking-tight text-qa-ink">{value}</span>
          {sub && <span className="text-[11px] text-qa-muted leading-snug">{sub}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(cardClass, 'bg-white border border-qa-border pl-0 pr-4 py-4')}>
      {accent}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <span className="font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light">{label}</span>
        <span className="font-spectral font-bold text-[34px] leading-none tracking-tight" style={{ color: valueColor }}>{value}</span>
        {sub && <span className="text-[11px] text-qa-muted leading-snug">{sub}</span>}
      </div>
    </div>
  );
}

export function QaKpiGrid({ cols, children }: { cols: 4 | 5; children: React.ReactNode }) {
  const gridClass = cols === 5
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mb-[30px]'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-[30px]';
  return <div className={gridClass}>{children}</div>;
}
