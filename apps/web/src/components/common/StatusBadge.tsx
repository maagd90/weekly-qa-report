import React from 'react';
import clsx from 'clsx';

const statusColors: Record<string, string> = {
  'On Track': 'bg-green-100 text-green-800',
  'Healthy': 'bg-green-100 text-green-800',
  'At Risk': 'bg-amber-100 text-amber-800',
  'Watch': 'bg-amber-100 text-amber-800',
  'Delayed': 'bg-red-100 text-red-800',
  'Not Started': 'bg-slate-100 text-slate-600',
  'Completed': 'bg-blue-100 text-blue-800',
  'Open': 'bg-slate-100 text-slate-700',
  'In Progress': 'bg-purple-100 text-purple-800',
  'Done': 'bg-green-100 text-green-800',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = statusColors[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-semibold', cls)}>
      {status}
    </span>
  );
}
