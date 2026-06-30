import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  'On Track': '#22c55e', 'At Risk': '#f59e0b', Delayed: '#ef4444', Completed: '#3b82f6',
};

export function StatusDonutChart({ data }: { data: { name?: string; status?: string; value?: number; count?: number; color?: string }[] }) {
  const chartData = data.map((d) => ({
    name: d.name || d.status || '',
    value: d.value ?? d.count ?? 0,
    color: d.color,
  }));
  if (!chartData.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3}>
          {chartData.map((entry, i) => (
            <Cell key={entry.name || i} fill={entry.color || STATUS_COLORS[entry.name] || '#94a3b8'} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
