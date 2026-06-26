import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  'On Track': '#22c55e', 'At Risk': '#f59e0b', Delayed: '#ef4444', Completed: '#3b82f6',
};

export function CompletionByProjectChart({ data }: { data: { project_name: string; percent_complete: number; status: string }[] }) {
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="project_name" width={130} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => `${v}%`} />
        <Bar dataKey="percent_complete" name="% Complete" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={STATUS_COLORS[entry.status] || '#3b82f6'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
