import type {
  DashboardVendorPortalPhaseItem,
  UatRow,
  VendorPortalPhaseCategory,
} from '../types/dataset';

const PHASE_2_UAT_PREFIX = /^phase\s*2\s*b\s+uat(?=$|[^a-z])/i;
// Accept both the plain prefix (`UAT ...`) and the bracketed tag (`[UAT] ...`).
// The bracketed form is exact, so similar tags such as `[UATILITY]` remain
// Other UAT instead of being misclassified as Phase 1.
const PHASE_1_UAT_PREFIX = /^(?:uat(?=$|[^a-z])|\[\s*uat\s*\])/i;
const PRODUCTION_PREFIX = /^inc(?=$|[^a-z])/i;

const CATEGORY_META: Record<VendorPortalPhaseCategory, Pick<DashboardVendorPortalPhaseItem, 'category' | 'label' | 'environment'>> = {
  'phase1-uat': { category: 'phase1-uat', label: 'Phase 1 UAT', environment: 'UAT' },
  'phase2-uat': { category: 'phase2-uat', label: 'Phase 2 UAT', environment: 'UAT' },
  'other-uat': { category: 'other-uat', label: 'Other UAT', environment: 'UAT' },
  production: { category: 'production', label: 'Production', environment: 'PROD' },
  unclassified: { category: 'unclassified', label: 'Unclassified', environment: 'Unknown' },
};

const CATEGORY_ORDER: VendorPortalPhaseCategory[] = [
  'phase1-uat',
  'phase2-uat',
  'other-uat',
  'production',
  'unclassified',
];

/**
 * Infers the Vendor Portal reporting phase from the ODL Subject convention.
 * Production must begin with INC. The named UAT prefixes retain their exact
 * phase, while every other non-empty Subject remains in the normal UAT view
 * as Other UAT instead of being presented as a data-quality warning.
 */
export function classifyVendorPortalPhase(subject: string | null | undefined): VendorPortalPhaseCategory {
  const value = String(subject || '').trim();
  if (!value) return 'unclassified';
  if (PHASE_2_UAT_PREFIX.test(value)) return 'phase2-uat';
  if (PHASE_1_UAT_PREFIX.test(value)) return 'phase1-uat';
  if (PRODUCTION_PREFIX.test(value)) return 'production';
  return 'other-uat';
}

/** Returns all five buckets in stable display order, including zero counts. */
export function vendorPortalPhaseBreakdown(
  rows: Array<Pick<UatRow, 'subject' | 'open'>>,
): DashboardVendorPortalPhaseItem[] {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, { count: 0, open: 0 }])) as
    Record<VendorPortalPhaseCategory, { count: number; open: number }>;

  for (const row of rows) {
    const category = classifyVendorPortalPhase(row.subject);
    counts[category].count += 1;
    if (row.open) counts[category].open += 1;
  }

  return CATEGORY_ORDER.map((category) => ({
    ...CATEGORY_META[category],
    count: counts[category].count,
    open: counts[category].open,
    closed: counts[category].count - counts[category].open,
  }));
}
