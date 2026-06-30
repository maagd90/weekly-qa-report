import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ByMonthChartProps {
  data: { label: string; pass: number; blocked: number; fail: number }[];
}

export function ByMonthChart({ data }: ByMonthChartProps) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No monthly data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="pass" name="Pass" fill="#22c55e" stackId="a" />
        <Bar dataKey="blocked" name="Blocked" fill="#f59e0b" stackId="a" />
        <Bar dataKey="fail" name="Fail" fill="#ef4444" stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
