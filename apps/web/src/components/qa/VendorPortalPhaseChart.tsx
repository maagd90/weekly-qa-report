import React from 'react';
import type { DashboardVendorPortalPhaseItem } from 'qa-dashboard-batch';
import { QA, fmt } from '../../theme/qaTheme';
import { HorizBar } from './SegBar';

const PHASE_COLORS: Record<DashboardVendorPortalPhaseItem['category'], string> = {
  'phase1-uat': '#6E89A6',
  'phase2-uat': '#2F6F7A',
  production: QA.FAIL,
  unclassified: QA.muted,
};

interface VendorPortalPhaseChartProps {
  items: DashboardVendorPortalPhaseItem[];
  onViewUnclassified?: () => void;
}

export function VendorPortalPhaseChart({ items, onViewUnclassified }: VendorPortalPhaseChartProps) {
  const classified = items.filter((item) => item.category !== 'unclassified');
  const unclassified = items.find((item) => item.category === 'unclassified');
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...classified.map((item) => item.count));

  return (
    <div className="flex flex-col gap-4" data-testid="vendor-portal-phase-chart">
      {classified.map((item) => (
        <div key={item.category} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(130px,0.9fr)_minmax(160px,2.1fr)_auto] sm:items-center sm:gap-4">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:block">
            <div className="truncate text-[12.5px] font-semibold">{item.label}</div>
            <span
              className="shrink-0 px-1.5 py-0.5 font-mono-qa text-[9px] font-semibold text-white sm:mt-1 sm:inline-block"
              style={{ background: PHASE_COLORS[item.category] }}
            >
              {item.environment}
            </span>
          </div>
          <div className="min-w-0">
            <HorizBar pct={(item.count / max) * 100} color={PHASE_COLORS[item.category]} />
          </div>
          <div className="flex items-baseline justify-between gap-3 font-mono-qa text-[11px] text-qa-muted sm:block sm:min-w-[100px] sm:text-right">
            <strong className="text-[14px] text-qa-ink">{fmt(item.count)}</strong>
            <span className="sm:ml-2">{total ? Math.round((item.count / total) * 100) : 0}%</span>
            <div className="text-[9.5px] text-qa-muted-light">{item.open} open · {item.closed} closed</div>
          </div>
        </div>
      ))}

      {unclassified && unclassified.count > 0 && (
        <div className="border-l-2 border-[#B5822F] bg-[#fbf6e9] px-3 py-2 text-[11.5px] text-qa-muted">
          <strong className="text-qa-ink">{fmt(unclassified.count)} unclassified</strong>
          {' '}— these subjects do not start with UAT, Phase 2B UAT, or INC. They remain visible for naming cleanup and are not added to another phase.
          {onViewUnclassified && (
            <button
              type="button"
              onClick={onViewUnclassified}
              className="mt-2 block border border-[#B5822F] bg-white px-2.5 py-1 font-mono-qa text-[9.5px] font-semibold text-qa-ink hover:bg-[#fffaf0]"
            >
              View {fmt(unclassified.count)} unclassified bug{unclassified.count === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
