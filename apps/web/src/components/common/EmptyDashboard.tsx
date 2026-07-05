import React from 'react';
import { QA } from '../../theme/qaTheme';

interface EmptyDashboardProps {
  onGenerate: () => void;
}

export function EmptyDashboard({ onGenerate }: EmptyDashboardProps) {
  return (
    <div className="max-w-qa mx-auto px-8 py-20 text-center">
      <div className="font-spectral text-[64px] leading-none text-qa-border mb-4">¶</div>
      <h2 className="font-spectral font-bold text-2xl m-0 mb-2">No dashboard data yet</h2>
      <p className="text-[13.5px] text-qa-muted max-w-md mx-auto mb-6">
        Stage test execution, JIRA, and ODL Excel files under Import Data, or configure live API integrations in Settings. Then generate a report to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="font-mono-qa text-xs font-semibold tracking-wider uppercase px-6 py-3 border-none cursor-pointer text-white"
        style={{ background: QA.accent }}
      >
        Go to AI Report →
      </button>
    </div>
  );
}
