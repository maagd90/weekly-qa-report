import React from 'react';
import type { BadgeStyle } from '../../theme/qaTheme';
import { cycleBadge, traceBadge } from '../../theme/qaTheme';

export function QaBadge({ style }: { style: BadgeStyle }) {
  return (
    <span
      className="inline-block px-2 py-0.5 text-[11px] font-semibold font-mono-qa tracking-wide"
      style={{ color: style.fg, background: style.bg }}
    >
      {style.label}
    </span>
  );
}

export function CycleBadge({ status }: { status: string }) {
  return <QaBadge style={cycleBadge(status)} />;
}

export function TraceBadge({ status }: { status: string }) {
  return <QaBadge style={traceBadge(status)} />;
}

const thClass = 'py-2.5 font-mono-qa text-[9.5px] tracking-wider uppercase text-qa-muted-light font-medium';

export function QaTable({ children, label = 'Scrollable data table' }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="qa-scroll max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-max border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function QaThead({ cols }: { cols: { label: string; align?: 'left' | 'right'; className?: string }[] }) {
  return (
    <thead>
      <tr className="text-left">
        {cols.map((c) => (
          <th
            key={c.label}
            className={`${thClass} ${c.align === 'right' ? 'text-right' : ''} ${c.className || ''}`}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
