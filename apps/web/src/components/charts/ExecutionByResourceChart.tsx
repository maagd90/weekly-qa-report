import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Row { resource_name: string; planned?: number; executed: number; passed: number; failed: number }

export function ExecutionByResourceChart({ data }: { data: Row[] }) {
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No data for this period</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="resource_name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="executed" name="Executed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="passed" name="Passed" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
