import React from 'react';
import { Play } from 'lucide-react';

export function EmptyDashboard({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center p-8">
      <p className="text-slate-500 font-medium">No dashboard generated yet</p>
      <p className="text-sm text-slate-400 mt-1">Stage files in Import or configure integrations, then generate a report.</p>
      <button onClick={onGenerate} className="mt-4 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg">
        <Play size={14} /> Generate Report
      </button>
    </div>
  );
}
