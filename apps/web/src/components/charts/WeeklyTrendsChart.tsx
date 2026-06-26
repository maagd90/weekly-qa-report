import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function WeeklyTrendsChart({ data }: { data: { week: number; testsExecuted: number; bugsReported: number; bugsClosed: number }[] }) {
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No trend data</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip labelFormatter={(v) => `Week ${v}`} />
        <Legend />
        <Line type="monotone" dataKey="testsExecuted" name="Tests Executed" stroke="#3b82f6" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="bugsReported" name="Bugs Reported" stroke="#f97316" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="bugsClosed" name="Bugs Closed" stroke="#22c55e" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
