import type { DashboardUatRow, VendorPortalPhaseCategory } from 'qa-dashboard-batch';

export type VendorPortalBugView = 'uat' | 'production' | 'unclassified';
export type VendorPortalBasicField = 'status' | 'priority' | 'area' | 'changeRequest' | 'reportedBy';

export interface VendorPortalBasicFilters {
  status: string;
  priority: string;
  area: string;
  changeRequest: string;
  reportedBy: string;
  text: string;
}

export interface VendorPortalFilterOption {
  value: string;
  count: number;
}

export const EMPTY_VENDOR_PORTAL_FILTERS: VendorPortalBasicFilters = {
  status: '',
  priority: '',
  area: '',
  changeRequest: '',
  reportedBy: '',
  text: '',
};

export const VENDOR_PORTAL_STATUS_ORDER = [
  'Pending',
  'Under Review',
  'RIFC',
  'RIFO',
  'Marked for Development',
  'Scheduled',
  'In Development',
  'In Testing',
  'ACSO',
  'Pending Release',
  'Closed',
] as const;

function normalized(value: string | null | undefined): string {
  return String(value || '').trim().toLocaleLowerCase();
}

function displayValue(value: string | null | undefined): string {
  return String(value || '').trim() || '—';
}

export function submittedDisplayValue(row: DashboardUatRow): string {
  return row.submittedAt ? row.submittedAt.slice(0, 10) : '—';
}

export function updatedDisplayValue(row: DashboardUatRow): string {
  return row.updatedAt ? row.updatedAt.slice(0, 10) : '—';
}

export function visibleVendorPortalRowValues(row: DashboardUatRow): string[] {
  return [
    displayValue(row.id),
    displayValue(row.subject),
    displayValue(row.area),
    displayValue(row.cr),
    displayValue(row.priority),
    displayValue(row.status),
    displayValue(row.submitter),
    submittedDisplayValue(row),
    updatedDisplayValue(row),
    displayValue(row.note),
  ];
}

export function rowMatchesBugView(row: DashboardUatRow, view: VendorPortalBugView): boolean {
  const category: VendorPortalPhaseCategory = row.reportedPhase || 'unclassified';
  if (view === 'uat') {
    return category === 'phase1-uat' || category === 'phase2-uat' || category === 'other-uat';
  }
  return category === view;
}

export function rowsForBugView(
  rows: DashboardUatRow[],
  view: VendorPortalBugView,
): DashboardUatRow[] {
  return rows.filter((row) => rowMatchesBugView(row, view));
}

function valueForField(row: DashboardUatRow, field: VendorPortalBasicField): string {
  if (field === 'status') return displayValue(row.status);
  if (field === 'priority') return displayValue(row.priority);
  if (field === 'area') return displayValue(row.area);
  if (field === 'changeRequest') return displayValue(row.cr);
  return displayValue(row.submitter);
}

function matchesField(row: DashboardUatRow, field: VendorPortalBasicField, expected: string): boolean {
  return !expected || normalized(valueForField(row, field)) === normalized(expected);
}

export function filterVendorPortalRows(
  rows: DashboardUatRow[],
  filters: VendorPortalBasicFilters,
  omitField?: VendorPortalBasicField,
): DashboardUatRow[] {
  const keyword = normalized(filters.text);
  return rows.filter((row) => {
    if (omitField !== 'status' && !matchesField(row, 'status', filters.status)) return false;
    if (omitField !== 'priority' && !matchesField(row, 'priority', filters.priority)) return false;
    if (omitField !== 'area' && !matchesField(row, 'area', filters.area)) return false;
    if (omitField !== 'changeRequest' && !matchesField(row, 'changeRequest', filters.changeRequest)) return false;
    if (omitField !== 'reportedBy' && !matchesField(row, 'reportedBy', filters.reportedBy)) return false;
    return !keyword || visibleVendorPortalRowValues(row).some((value) => normalized(value).includes(keyword));
  });
}

function canonicalStatusLabel(values: string[]): string {
  const known = VENDOR_PORTAL_STATUS_ORDER.find((status) =>
    values.some((value) => normalized(value) === normalized(status)));
  if (known) return known;
  return [...values].sort((left, right) => left.localeCompare(right))[0];
}

export function basicFilterOptions(
  rows: DashboardUatRow[],
  field: VendorPortalBasicField,
  filters: VendorPortalBasicFilters,
): VendorPortalFilterOption[] {
  const countRows = field === 'status' ? filterVendorPortalRows(rows, filters, 'status') : rows;
  const grouped = new Map<string, { values: string[]; count: number }>();
  for (const row of rows) {
    const value = valueForField(row, field);
    if (value === '—') continue;
    const key = normalized(value);
    const current = grouped.get(key) || { values: [], count: 0 };
    current.values.push(value);
    grouped.set(key, current);
  }
  for (const row of countRows) {
    const value = valueForField(row, field);
    const current = grouped.get(normalized(value));
    if (current) current.count += 1;
  }
  const options = [...grouped.values()].map((group) => ({
    value: field === 'status'
      ? canonicalStatusLabel(group.values)
      : [...group.values].sort((left, right) => left.localeCompare(right))[0],
    count: group.count,
  }));
  if (field !== 'status') return options.sort((left, right) => left.value.localeCompare(right.value));

  const order = new Map(VENDOR_PORTAL_STATUS_ORDER.map((status, index) => [normalized(status), index]));
  return options.sort((left, right) => {
    const leftOrder = order.get(normalized(left.value)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(normalized(right.value)) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.value.localeCompare(right.value);
  });
}

export function hasBasicFilters(filters: VendorPortalBasicFilters): boolean {
  return Object.values(filters).some((value) => Boolean(value.trim()));
}

export function clearUnavailableBasicFilters(
  filters: VendorPortalBasicFilters,
  rows: DashboardUatRow[],
): VendorPortalBasicFilters {
  const next = { ...filters };
  const fields: VendorPortalBasicField[] = ['status', 'priority', 'area', 'changeRequest', 'reportedBy'];
  for (const field of fields) {
    const available = basicFilterOptions(rows, field, EMPTY_VENDOR_PORTAL_FILTERS)
      .some((option) => normalized(option.value) === normalized(next[field]));
    if (next[field] && !available) next[field] = '';
  }
  return next;
}

export function escapeVendorPortalQueryValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function basicFiltersToQuery(filters: VendorPortalBasicFilters): string {
  const clauses: string[] = [];
  if (filters.status) clauses.push(`status = ${escapeVendorPortalQueryValue(filters.status)}`);
  if (filters.priority) clauses.push(`priority = ${escapeVendorPortalQueryValue(filters.priority)}`);
  if (filters.area) clauses.push(`area = ${escapeVendorPortalQueryValue(filters.area)}`);
  if (filters.changeRequest) clauses.push(`changeRequest = ${escapeVendorPortalQueryValue(filters.changeRequest)}`);
  if (filters.reportedBy) clauses.push(`by = ${escapeVendorPortalQueryValue(filters.reportedBy)}`);
  if (filters.text.trim()) clauses.push(`text ~ ${escapeVendorPortalQueryValue(filters.text.trim())}`);
  return clauses.join(' AND ');
}
