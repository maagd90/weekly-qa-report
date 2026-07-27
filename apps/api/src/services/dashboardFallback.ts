import type { FilterParams } from 'qa-dashboard-batch';

export function canUseDashboardPayloadFallback(filter: Partial<FilterParams>): boolean {
  return !filter.startDate
    && !filter.endDate
    && !filter.search
    && !filter.project
    && (!filter.result || filter.result === 'all');
}
