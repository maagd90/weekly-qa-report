import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { QaMasthead } from './components/layout/QaMasthead';
import { QaTabNav, buildTabs } from './components/layout/QaTabNav';
import { QaFilterBar } from './components/layout/QaFilterBar';
import { QaFooter } from './components/layout/QaFooter';
import { OverviewPage } from './pages/OverviewPage';
import { TestersPage } from './pages/TestersPage';
import { CyclesPage } from './pages/CyclesPage';
import { TraceabilityPage } from './pages/TraceabilityPage';
import { UatPage } from './pages/UatPage';
import { ImportStatusPage } from './pages/ImportStatusPage';
import { AiReportPage } from './pages/AiReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmptyDashboard } from './components/common/EmptyDashboard';
import { usePerTabFilters } from './hooks/usePerTabFilters';
import { useUiPreferences } from './hooks/useUiPreferences';
import { batchApi, getActiveProject } from './lib/api';
import { canonicalProjectOrUndefined } from './lib/projectKey';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { QaTab } from './theme/qaTheme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AppContent() {
  const [activeTab, setActiveTab] = useState<QaTab>('overview');
  const [filteredByTab, setFilteredByTab] = useState<Partial<Record<QaTab, DashboardPayload>>>({});
  const [baseDashboard, setBaseDashboard] = useState<DashboardPayload | null>(null);
  const ui = useUiPreferences();

  // Respect a previously-selected project on first load, so the masthead and data agree.
  const storedProject = canonicalProjectOrUndefined(getActiveProject());
  const { data: initialDashboard, isLoading, refetch } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard-init', storedProject || 'all'],
    queryFn: () => batchApi.getDashboard(storedProject ? { project: storedProject } : undefined),
    retry: false,
  });

  const projectBaseFetch = useMutation({
    mutationFn: (project: string) => batchApi.getDashboard({ project: project === 'all' ? undefined : project }),
    onSuccess: (d) => { if (d) { setBaseDashboard(d); setFilteredByTab({}); } },
  });

  const isProjectLoading = projectBaseFetch.isPending;
  const base = isProjectLoading ? undefined : (baseDashboard ?? initialDashboard ?? undefined);
  // Tabs without their own filtered view fall back to the stable current-project base.
  const display = (filteredByTab[activeTab] ?? base) ?? undefined;
  const filters = usePerTabFilters(activeTab, base);

  const setFilteredView = (freshDashboard: DashboardPayload | null, tab: QaTab) => {
    if (!freshDashboard) return;
    setFilteredByTab((prev) => ({ ...prev, [tab]: freshDashboard }));
  };

  const filterCachedDashboard = useMutation({
    mutationFn: (vars: { params?: Partial<FilterParams>; tab: QaTab }) => batchApi.getDashboard(vars.params || filters.filterParams).then((d) => ({ d, tab: vars.tab })),
    onSuccess: ({ d, tab }) => setFilteredView(d, tab),
  });

  const showUat = !!base?.uat;
  const tabs = buildTabs(showUat);
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  // If the active tab is no longer available, fall back to Overview to avoid a blank body.
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab(tabs[0].id);
  }, [tabs, activeTab]);

  const showFilters = !currentTab.hideFilters;
  const hasDashboard = !!display;
  const canFilterCached = activeTab === 'overview' || activeTab === 'testers' || activeTab === 'cycles' || activeTab === 'trace' || activeTab === 'uat';

  const handleTabChange = (tab: QaTab) => {
    setActiveTab(tab);
    ui.clearSelectedCycle();
  };

  const handleProjectChange = (project: string) => {
    const nextProject = project || 'all';
    filters.setProject(nextProject);
    filters.setSearch('');
    filters.setResult('all');
    ui.clearSelectedCycle();
    setFilteredByTab({});
    setBaseDashboard(null); // Avoid showing stale previous-project data while the new scope loads.
    projectBaseFetch.mutate(nextProject);
  };

  const goGenerate = () => setActiveTab('ai');

  const handleGenerated = async () => {
    const refreshed = await refetch();
    if (refreshed.data) { setFilteredByTab({}); setBaseDashboard(null); }
  };

  return (
    <div className="min-h-screen bg-qa-bg text-qa-ink flex flex-col qa-scroll">
      <QaMasthead dashboard={display} project={filters.project} projects={filters.projects} onProjectChange={handleProjectChange} />
      <QaTabNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {showFilters && (
        <QaFilterBar
          startDate={filters.startDate}
          endDate={filters.endDate}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          search={filters.search}
          onSearchChange={filters.setSearch}
          result={filters.result}
          onResultChange={filters.setResult}
          kpiStyle={ui.kpiStyle}
          onKpiStyleChange={ui.setKpiStyle}
          dataMin={display?.meta.dataMin}
          dataMax={display?.meta.dataMax}
          onSearchApis={canFilterCached ? () => filterCachedDashboard.mutate({ tab: activeTab }) : undefined}
          searchApisLabel="Filter Cached Data"
          isSearchingApis={filterCachedDashboard.isPending}
        />
      )}

      {filterCachedDashboard.isError && showFilters && (
        <div className="max-w-qa mx-auto w-full px-8 pt-3 print:hidden">
          <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">
            {(filterCachedDashboard.error as Error).message}
          </div>
        </div>
      )}

      <div className={clsx('flex-1', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-auto')}>
        {(isLoading || isProjectLoading) && showFilters && <div className="flex items-center justify-center h-64 font-mono-qa text-sm text-qa-muted-light">Loading dashboard…</div>}
        {!isLoading && !isProjectLoading && !hasDashboard && showFilters && <EmptyDashboard onGenerate={goGenerate} />}
        {display && activeTab === 'overview' && <OverviewPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'testers' && <TestersPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'cycles' && <CyclesPage dashboard={display} kpiStyle={ui.kpiStyle} selectedCycle={ui.selectedCycle} onSelectCycle={ui.setSelectedCycle} filterParams={filters.filterParams} />}
        {display && activeTab === 'trace' && <TraceabilityPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'uat' && showUat && <UatPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {activeTab === 'import' && <ImportStatusPage />}
        {activeTab === 'ai' && <AiReportPage dashboard={display} kpiStyle={ui.kpiStyle} project={filters.project} onGenerated={handleGenerated} />}
        {activeTab === 'settings' && <SettingsPage />}
      </div>

      <QaFooter />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
