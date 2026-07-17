import React from 'react';
import type { DashboardVendorPortalPhaseItem } from 'qa-dashboard-batch';
import { QA, fmt } from '../../theme/qaTheme';
import { HorizBar } from './SegBar';

const PHASE_COLORS: Record<DashboardVendorPortalPhaseItem['category'], string> = {
  'phase1-uat': '#6E89A6',
  'phase2-uat': '#2F6F7A',
  'other-uat': '#8A7F68',
  production: QA.FAIL,
  unclassified: QA.muted,
};

interface VendorPortalPhaseChartProps {
  items: DashboardVendorPortalPhaseItem[];
  onViewUnclassified?: () => void;
}

export function VendorPortalPhaseChart({ items, onViewUnclassified }: VendorPortalPhaseChartProps) {
  // Fold the retired Other UAT bucket into Phase 1 when rendering dashboard
  // JSON generated before the classification rule changed.
  const legacyOtherUat = items.find((item) => item.category === 'other-uat');
  const normalizedItems = items
    .filter((item) => item.category !== 'other-uat')
    .map((item) => item.category === 'phase1-uat' && legacyOtherUat
      ? {
        ...item,
        count: item.count + legacyOtherUat.count,
        open: item.open + legacyOtherUat.open,
        closed: item.closed + legacyOtherUat.closed,
      }
      : item);
  const classified = normalizedItems.filter((item) => item.category !== 'unclassified');
  const unclassified = normalizedItems.find((item) => item.category === 'unclassified');
  const total = normalizedItems.reduce((sum, item) => sum + item.count, 0);
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
        <div className="border-l-2 border-qa-border bg-[#faf8f2] px-3 py-2 text-[11.5px] text-qa-muted">
          <strong className="text-qa-ink">{fmt(unclassified.count)} unclassified</strong>
          {' '}— these rows have no Subject value. Every non-empty subject that is not Production or Phase 2 is included under Phase 1 UAT.
          {onViewUnclassified && (
            <button
              type="button"
              onClick={onViewUnclassified}
              className="mt-2 block border border-qa-border bg-white px-2.5 py-1 font-mono-qa text-[9.5px] font-semibold text-qa-ink hover:bg-[#f6f4ee]"
            >
              View {fmt(unclassified.count)} unclassified bug{unclassified.count === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
