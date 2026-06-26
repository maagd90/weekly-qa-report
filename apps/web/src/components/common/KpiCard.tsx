import React from 'react';
import clsx from 'clsx';

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'slate';
  icon?: React.ReactNode;
}

const colorMap = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  red: 'bg-red-50 border-red-200 text-red-700',
  yellow: 'bg-amber-50 border-amber-200 text-amber-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
  slate: 'bg-slate-50 border-slate-200 text-slate-700',
};

export function KpiCard({ label, value, sub, color = 'blue', icon }: KpiCardProps) {
  return (
    <div className={clsx('rounded-xl border p-5 flex flex-col gap-1', colorMap[color])}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <span className="text-3xl font-bold">{value}</span>
      {sub && <span className="text-xs opacity-70">{sub}</span>}
    </div>
  );
}
