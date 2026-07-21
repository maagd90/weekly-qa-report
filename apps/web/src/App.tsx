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
import { canonicalProjectOrUndefined, uniqueCanonicalProjects } from './lib/projectKey';
import { defaultReportingPeriod } from './lib/reportingPeriod';
import { projectDisplayName } from './lib/projectDisplay';
import type { DashboardPayload, FilterParams } from 'qa-dashboard-batch';
import type { QaTab } from './theme/qaTheme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const SEARCH_PLACEHOLDERS: Partial<Record<QaTab, string>> = {
  testers: 'Search Quality Assurance, cycle, or case key...',
  cycles: 'Search cycle name or key...',
  trace: 'Search key, summary, sprint, area, assignee, or status...',
  uat: 'Search ticket, subject, area, submitter, status, or CR...',
};

function AppContent() {
  const [activeTab, setActiveTab] = useState<QaTab>('overview');
  const [filteredByTab, setFilteredByTab] = useState<Partial<Record<QaTab, DashboardPayload>>>({});
  const [baseDashboard, setBaseDashboard] = useState<DashboardPayload | null>(null);
  const ui = useUiPreferences();

  const defaultPeriod = defaultReportingPeriod();
  const storedProject = canonicalProjectOrUndefined(getActiveProject());
  const initialFilter: Partial<FilterParams> = {
    ...defaultPeriod,
    project: storedProject,
  };
  const { data: initialDashboard, isLoading } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard-init', storedProject || 'all', defaultPeriod.startDate, defaultPeriod.endDate],
    queryFn: () => batchApi.getDashboard(initialFilter),
    retry: false,
  });
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: batchApi.listProjects,
  });

  const projectBaseFetch = useMutation({
    mutationFn: (project: string) => batchApi.getDashboard({
      ...defaultReportingPeriod(),
      project: project === 'all' ? undefined : project,
    }),
    onSuccess: (d) => { if (d) { setBaseDashboard(d); setFilteredByTab({}); } },
  });

  const isProjectLoading = projectBaseFetch.isPending;
  const base = isProjectLoading ? undefined : (baseDashboard ?? initialDashboard ?? undefined);
  const display = (filteredByTab[activeTab] ?? base) ?? undefined;
  const filters = usePerTabFilters(activeTab, base);
  const availableProjects = ['all', ...uniqueCanonicalProjects([
    ...filters.projects,
    ...registeredProjects.map((project) => project.key),
  ])];
  const projectNames = Object.fromEntries(registeredProjects.map((project) => [project.key, project.name === project.key ? projectDisplayName(project.key) : project.name]));

  const setFilteredView = (freshDashboard: DashboardPayload | null, tab: QaTab) => {
    if (!freshDashboard) return;
    setFilteredByTab((prev) => ({ ...prev, [tab]: freshDashboard }));
  };

  const applyDateRange = useMutation({
    mutationFn: (vars: { params: Partial<FilterParams>; tab: QaTab }) => batchApi.searchDashboardByDates(vars.params).then((d) => ({ d, tab: vars.tab })),
    onSuccess: ({ d, tab }) => setFilteredView(d, tab),
  });

  const showUat = !!base?.uat;
  const tabs = buildTabs(showUat);
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab(tabs[0].id);
  }, [tabs, activeTab]);

  const showFilters = !currentTab.hideFilters;
  const hasDashboard = !!display;
  const showRuntimeSearch = activeTab === 'testers' || activeTab === 'cycles' || activeTab === 'trace' || activeTab === 'uat';
  const datesChanged = Boolean(display && (
    filters.startDate !== (display.scope.startDate || '')
    || filters.endDate !== (display.scope.endDate || '')
  ));

  const handleTabChange = (tab: QaTab) => {
    setActiveTab(tab);
    ui.clearSelectedCycle();
  };

  const handleProjectChange = (project: string) => {
    const nextProject = project || 'all';
    filters.setProject(nextProject);
    ui.clearSelectedCycle();
    setFilteredByTab({});
    setBaseDashboard(null);
    projectBaseFetch.mutate(nextProject);
  };

  const goGenerate = () => setActiveTab('ai');

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-qa-bg text-qa-ink flex flex-col qa-scroll">
      <QaMasthead dashboard={display} project={filters.project} projects={availableProjects} projectNames={projectNames} onProjectChange={handleProjectChange} />
      <QaTabNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {showFilters && (
        <QaFilterBar
          startDate={filters.startDate}
          endDate={filters.endDate}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          search={filters.search}
          onSearchChange={filters.setSearch}
          searchPlaceholder={SEARCH_PLACEHOLDERS[activeTab]}
          kpiStyle={ui.kpiStyle}
          onKpiStyleChange={ui.setKpiStyle}
          dataMin={display?.meta.dataMin}
          dataMax={display?.meta.dataMax}
          showSearch={showRuntimeSearch}
          onApplyDates={() => applyDateRange.mutate({ params: { ...filters.filterParams }, tab: activeTab })}
          datesChanged={datesChanged}
          isApplyingDates={applyDateRange.isPending}
        />
      )}

      {applyDateRange.isError && showFilters && (
        <div className="max-w-qa mx-auto w-full px-4 pt-3 sm:px-6 lg:px-8 print:hidden">
          <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">
            {(applyDateRange.error as Error).message}
          </div>
        </div>
      )}

      <div className={clsx('flex-1 min-w-0', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-x-hidden overflow-y-auto')}>
        {(isLoading || isProjectLoading) && showFilters && <div className="flex items-center justify-center h-64 font-mono-qa text-sm text-qa-muted-light">Loading dashboard…</div>}
        {!isLoading && !isProjectLoading && !hasDashboard && showFilters && <EmptyDashboard onGenerate={goGenerate} />}
        {display && activeTab === 'overview' && <OverviewPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'testers' && <TestersPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {display && activeTab === 'cycles' && <CyclesPage dashboard={display} kpiStyle={ui.kpiStyle} selectedCycle={ui.selectedCycle} onSelectCycle={ui.setSelectedCycle} filterParams={filters.filterParams} searchQuery={filters.search} />}
        {display && activeTab === 'trace' && <TraceabilityPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {display && activeTab === 'uat' && showUat && <UatPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {activeTab === 'import' && <ImportStatusPage selectedProject={filters.project} projects={registeredProjects} onProjectChange={handleProjectChange} />}
        {activeTab === 'ai' && <AiReportPage dashboard={display} kpiStyle={ui.kpiStyle} project={filters.project} />}
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
