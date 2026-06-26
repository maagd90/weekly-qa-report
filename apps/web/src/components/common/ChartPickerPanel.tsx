import React from 'react';
import { Play } from 'lucide-react';
import type { ChartId } from '../../lib/api';
import { useChartPreferences } from '../../hooks/useChartPreferences';

const LABELS: Record<ChartId, string> = {
  'execution-by-resource': 'Test execution by resource',
  'bugs-by-resource': 'Bugs by resource',
  'weekly-trends': 'Weekly trends',
  'status-distribution': 'Project status distribution',
  'completion-by-project': 'Completion by project',
  'bugs-by-project': 'Bugs by project',
  'completion-trends': 'Completion trends',
};

export function ChartPickerPanel() {
  const { prefs, setPref, chartIds } = useChartPreferences();

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Visible charts</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {chartIds.map((id) => (
          <label key={id} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={prefs[id]} onChange={(e) => setPref(id, e.target.checked)} className="rounded" />
            {LABELS[id]}
          </label>
        ))}
      </div>
    </div>
  );
}

export function EmptyDashboard({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center p-8">
      <p className="text-slate-500 font-medium">No dashboard generated yet</p>
      <p className="text-sm text-slate-400 mt-1">Stage files in Import, then generate a report to populate charts.</p>
      <button onClick={onGenerate} className="mt-4 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg">
        <Play size={14} /> Generate Report
      </button>
    </div>
  );
}
