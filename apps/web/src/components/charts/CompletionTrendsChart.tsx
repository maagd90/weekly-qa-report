import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../../lib/api';

const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ef4444'];

export function CompletionTrendsChart({ year }: { year: number }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['completion-trends', year],
    queryFn: () => projectsApi.completionTrends(year),
  });

  if (isLoading) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">Loading...</div>;
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No trend data</div>;

  // Pivot: { week, [project_name]: pct, ... }[]
  const projectNames = [...new Set<string>(data.map((d: { project_name: string }) => d.project_name))];
  const weeks = [...new Set<number>(data.map((d: { week: number }) => d.week))].sort((a, b) => a - b);
  const pivoted = weeks.map((week) => {
    const row: Record<string, number | string> = { week };
    for (const name of projectNames) {
      const match = data.find((d: { week: number; project_name: string; percent_complete: number }) => d.week === week && d.project_name === name);
      row[name] = match ? match.percent_complete : 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={pivoted} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => `${v}%`} labelFormatter={(v) => `Week ${v}`} />
        <Legend />
        {projectNames.map((name, i) => (
          <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
