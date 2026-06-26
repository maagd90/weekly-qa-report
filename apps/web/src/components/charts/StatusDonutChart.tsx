import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { projectsApi, type FilterParams } from '../../lib/api';

const STATUS_COLORS: Record<string, string> = {
  'On Track':  '#22c55e',
  'At Risk':   '#f59e0b',
  'Delayed':   '#ef4444',
  'Completed': '#3b82f6',
};

export function StatusDonutChart({ filter }: { filter: FilterParams }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['status-distribution', filter],
    queryFn: () => projectsApi.statusDistribution(filter),
  });

  if (isLoading) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">Loading...</div>;
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3}>
          {data.map((entry: { status: string }) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#94a3b8'} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
