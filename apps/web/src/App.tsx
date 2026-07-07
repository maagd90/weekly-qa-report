import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useFilters } from './hooks/useFilters';
import { useUiPreferences } from './hooks/useUiPreferences';
import { batchApi } from './lib/api';
import type { DashboardPayload } from 'qa-dashboard-batch';
import type { QaTab } from './theme/qaTheme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AppContent() {
  const [activeTab, setActiveTab] = useState<QaTab>('overview');
  const [searchedDashboard, setSearchedDashboard] = useState<DashboardPayload | null>(null);
  const ui = useUiPreferences();
  const client = useQueryClient();

  const { data: initialDashboard, isLoading, refetch } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard-init'],
    queryFn: () => batchApi.getDashboard(),
    retry: false,
  });

  const display = searchedDashboard ?? initialDashboard;
  const filters = useFilters(display ?? undefined);

  const setDashboard = (freshDashboard: DashboardPayload | null) => {
    if (!freshDashboard) return;
    setSearchedDashboard(freshDashboard);
    client.setQueryData(['dashboard-init'], freshDashboard);
  };

  const searchTestCases = useMutation({
    mutationFn: () => batchApi.searchDashboardByDates(filters.filterParams),
    onSuccess: (freshDashboard) => {
      setDashboard(freshDashboard);
      client.invalidateQueries({ queryKey: ['settings-dashboard-projects'] });
      client.invalidateQueries({ queryKey: ['report'] });
    },
  });

  const searchCachedDashboard = useMutation({
    mutationFn: () => batchApi.getDashboard(filters.filterParams),
    onSuccess: (freshDashboard) => setDashboard(freshDashboard),
  });

  const showUat = !!display?.uat;
  const tabs = buildTabs(showUat);
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const showFilters = !currentTab.hideFilters;
  const hasDashboard = !!display;
  const canSearchLive = activeTab === 'overview';
  const canSearchCached = activeTab === 'trace' || activeTab === 'uat';
  const activeSearch = canSearchLive ? searchTestCases : searchCachedDashboard;

  const handleTabChange = (tab: QaTab) => {
    setActiveTab(tab);
    ui.clearSelectedCycle();
  };

  const goGenerate = () => setActiveTab('ai');

  const handleGenerated = async () => {
    const refreshed = await refetch();
    if (refreshed.data) setSearchedDashboard(refreshed.data);
  };

  return (
    <div className="min-h-screen bg-qa-bg text-qa-ink flex flex-col qa-scroll">
      <QaMasthead dashboard={display} />
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
          project={filters.project}
          onProjectChange={filters.setProject}
          projects={filters.projects}
          kpiStyle={ui.kpiStyle}
          onKpiStyleChange={ui.setKpiStyle}
          dataMin={display?.meta.dataMin}
          dataMax={display?.meta.dataMax}
          onSearchApis={canSearchLive || canSearchCached ? () => activeSearch.mutate() : undefined}
          searchApisLabel={activeTab === 'trace' ? 'Search Traceability' : activeTab === 'uat' ? 'Search UAT' : 'Search Test Cases'}
          isSearchingApis={activeSearch.isPending}
        />
      )}

      {(searchTestCases.isError || searchCachedDashboard.isError) && showFilters && (
        <div className="max-w-qa mx-auto w-full px-8 pt-3 print:hidden">
          <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">
            {((searchTestCases.error || searchCachedDashboard.error) as Error).message}
          </div>
        </div>
      )}

      <div className={clsx('flex-1', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-auto')}>
        {isLoading && showFilters && (
          <div className="flex items-center justify-center h-64 font-mono-qa text-sm text-qa-muted-light">
            Loading dashboard…
          </div>
        )}

        {!isLoading && !hasDashboard && showFilters && (
          <EmptyDashboard onGenerate={goGenerate} />
        )}

        {display && activeTab === 'overview' && <OverviewPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'testers' && <TestersPage dashboard={display} kpiStyle={ui.kpiStyle} filterParams={filters.filterParams} />}
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
