import React, { useState, useEffect, useRef } from 'react';
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
import { WonderMilesExportPage } from './pages/WonderMilesExportPage';
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
  'wonder-miles': 'Search Wonder Miles key, summary, sprint, assignee, status, or source file...',
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
  const { data: initialDashboard, isLoading, error: initialDashboardError } = useQuery<DashboardPayload | null>({
    queryKey: ['dashboard-init', storedProject || 'all', defaultPeriod.startDate, defaultPeriod.endDate],
    queryFn: () => batchApi.getDashboard(initialFilter),
    retry: false,
  });
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: batchApi.listProjects,
  });

  const activeProjectRef = useRef(storedProject || 'all');
  const projectRequestSequence = useRef(0);
  const dateRequestSequence = useRef(0);
  const projectBaseFetch = useMutation({
    mutationFn: (request: { project: string; sequence: number }) => batchApi.getDashboard({
      ...defaultReportingPeriod(),
      project: request.project === 'all' ? undefined : request.project,
    }),
    onSuccess: (d, request) => {
      if (request.sequence !== projectRequestSequence.current || request.project !== activeProjectRef.current) return;
      setBaseDashboard(d);
      setFilteredByTab({});
    },
  });

  const isProjectLoading = projectBaseFetch.isPending;
  const base = isProjectLoading || projectBaseFetch.isError
    ? undefined
    : (baseDashboard ?? (activeProjectRef.current === (storedProject || 'all') ? initialDashboard : null) ?? undefined);
  const filters = usePerTabFilters(activeTab, base);
  const availableProjects = ['all', ...uniqueCanonicalProjects([
    ...filters.projects,
    ...registeredProjects.map((project) => project.key),
  ])];
  const projectNames = Object.fromEntries(registeredProjects.map((project) => [project.key, project.name === project.key ? projectDisplayName(project.key) : project.name]));
  const selectedProjectRecord = registeredProjects.find((project) => project.key === filters.project);
  const wonderMilesProject = selectedProjectRecord?.capabilities.wonderMilesExport ? selectedProjectRecord : undefined;
  const { data: wonderMilesDashboard, isLoading: isWonderMilesLoading } = useQuery<DashboardPayload>({
    queryKey: ['wonder-miles-imports', wonderMilesProject?.id || 'none', defaultPeriod.startDate, defaultPeriod.endDate],
    queryFn: () => batchApi.getUploadedIssueDashboard(wonderMilesProject!.id, { ...defaultPeriod, project: wonderMilesProject!.key }),
    enabled: Boolean(wonderMilesProject),
    retry: false,
  });
  const display = activeTab === 'wonder-miles'
    ? (filteredByTab['wonder-miles'] ?? wonderMilesDashboard)
    : (filteredByTab[activeTab] ?? base);

  const setFilteredView = (freshDashboard: DashboardPayload | null, tab: QaTab) => {
    if (!freshDashboard) return;
    setFilteredByTab((prev) => ({ ...prev, [tab]: freshDashboard }));
  };

  const applyDateRange = useMutation({
    mutationFn: (vars: { params: Partial<FilterParams>; tab: QaTab; project: string; sequence: number }) => {
      // Vendor Portal and Wonder Miles rows come from project-owned spreadsheet
      // imports. Their date actions only refilter cached imports; the shared live
      // search endpoint intentionally refreshes Jira and QMetry for other tabs.
      const request = vars.tab === 'wonder-miles'
        ? wonderMilesProject
          ? batchApi.getUploadedIssueDashboard(wonderMilesProject.id, { ...vars.params, project: wonderMilesProject.key })
          : Promise.reject(new Error('Select a project with Wonder Miles export enabled.'))
        : vars.tab === 'uat'
          ? batchApi.getDashboard(vars.params)
          : batchApi.searchDashboardByDates(vars.params);
      return request.then((d) => ({ d, ...vars }));
    },
    onSuccess: ({ d, tab, project, sequence }) => {
      if (sequence !== dateRequestSequence.current || project !== activeProjectRef.current || tab !== activeTab) return;
      setFilteredView(d, tab);
    },
  });

  const showVendorPortalBugs = Boolean(
    filters.project === 'all'
      ? registeredProjects.some((project) => project.capabilities.vendorPortal)
      : selectedProjectRecord?.capabilities.vendorPortal,
  );
  const showWonderMilesExport = Boolean(wonderMilesProject);
  const tabs = buildTabs(showVendorPortalBugs, showWonderMilesExport);
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab(tabs[0].id);
  }, [tabs, activeTab]);

  const showFilters = !currentTab.hideFilters;
  const hasDashboard = !!display;
  const showRuntimeSearch = activeTab === 'testers' || activeTab === 'cycles' || activeTab === 'trace' || activeTab === 'uat' || activeTab === 'wonder-miles';
  const showInitialDashboardError = Boolean(
    initialDashboardError
    && activeProjectRef.current === (storedProject || 'all')
    && projectRequestSequence.current === 0
    && !baseDashboard,
  );
  const datesChanged = Boolean(display && (
    filters.startDate !== (display.scope.startDate || '')
    || filters.endDate !== (display.scope.endDate || '')
  ));

  const handleTabChange = (tab: QaTab) => {
    dateRequestSequence.current += 1;
    applyDateRange.reset();
    setActiveTab(tab);
    ui.clearSelectedCycle();
  };

  const handleProjectChange = (project: string) => {
    const nextProject = project || 'all';
    activeProjectRef.current = nextProject;
    projectRequestSequence.current += 1;
    dateRequestSequence.current += 1;
    applyDateRange.reset();
    filters.setProject(nextProject);
    ui.clearSelectedCycle();
    setFilteredByTab({});
    setBaseDashboard(null);
    projectBaseFetch.mutate({ project: nextProject, sequence: projectRequestSequence.current });
  };

  const goGenerate = () => setActiveTab('ai');

  const handleImportedDataChanged = (freshDashboard: DashboardPayload | null) => {
    // Project import sync returns the dashboard it just rebuilt. Replace the
    // in-memory snapshot immediately; query invalidation alone is insufficient
    // because baseDashboard intentionally takes precedence over query data.
    dateRequestSequence.current += 1;
    applyDateRange.reset();
    setBaseDashboard(freshDashboard);
    setFilteredByTab({});
  };

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
          onApplyDates={() => { dateRequestSequence.current += 1; applyDateRange.mutate({ params: { ...filters.filterParams }, tab: activeTab, project: activeProjectRef.current, sequence: dateRequestSequence.current }); }}
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
      {(showInitialDashboardError || projectBaseFetch.isError) && showFilters && (
        <div className="max-w-qa mx-auto w-full px-4 pt-3 sm:px-6 lg:px-8 print:hidden">
          <div className="p-3 border border-[#ecccc2] bg-[#f8ece8] text-[#a13d2c] text-sm">
            {(projectBaseFetch.error as Error | null)?.message || (showInitialDashboardError ? (initialDashboardError as Error).message : '') || 'Could not load the selected project dashboard.'}
          </div>
        </div>
      )}

      <div className={clsx('flex-1 min-w-0', activeTab === 'ai' ? 'flex flex-col overflow-hidden min-h-0' : 'overflow-x-hidden overflow-y-auto')}>
        {(isLoading || isProjectLoading || (activeTab === 'wonder-miles' && isWonderMilesLoading)) && showFilters && <div className="flex items-center justify-center h-64 font-mono-qa text-sm text-qa-muted-light">Loading dashboard…</div>}
        {!isLoading && !isProjectLoading && !(activeTab === 'wonder-miles' && isWonderMilesLoading) && !hasDashboard && showFilters && <EmptyDashboard onGenerate={goGenerate} />}
        {display && activeTab === 'overview' && <OverviewPage dashboard={display} kpiStyle={ui.kpiStyle} />}
        {display && activeTab === 'testers' && <TestersPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {display && activeTab === 'cycles' && <CyclesPage dashboard={display} kpiStyle={ui.kpiStyle} selectedCycle={ui.selectedCycle} onSelectCycle={ui.setSelectedCycle} filterParams={filters.filterParams} searchQuery={filters.search} />}
        {display && activeTab === 'trace' && <TraceabilityPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {display && activeTab === 'uat' && showVendorPortalBugs && <UatPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {display && activeTab === 'wonder-miles' && showWonderMilesExport && <WonderMilesExportPage dashboard={display} kpiStyle={ui.kpiStyle} searchQuery={filters.search} />}
        {activeTab === 'import' && <ImportStatusPage selectedProject={filters.project} projects={registeredProjects} onProjectChange={handleProjectChange} onImportedDataChanged={handleImportedDataChanged} />}
        {activeTab === 'ai' && <AiReportPage dashboard={display} kpiStyle={ui.kpiStyle} project={filters.project} />}
        {activeTab === 'settings' && <SettingsPage selectedProject={filters.project} onProjectChange={handleProjectChange} onLiveDataChanged={handleImportedDataChanged} />}
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
