import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ef4444'];

export function CompletionTrendsChart({ data }: { data: { week: number; project_name: string; percent_complete: number }[] }) {
  const { pivoted, projectNames } = useMemo(() => {
    const projectNames = [...new Set(data.map((d) => d.project_name))];
    const weeks = [...new Set(data.map((d) => d.week))].sort((a, b) => a - b);
    const pivoted = weeks.map((week) => {
      const row: Record<string, number | string> = { week };
      for (const name of projectNames) {
        const match = data.find((d) => d.week === week && d.project_name === name);
        row[name] = match ? match.percent_complete : 0;
      }
      return row;
    });
    return { pivoted, projectNames };
  }, [data]);

  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No trend data</div>;

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
