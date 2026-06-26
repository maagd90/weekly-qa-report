import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export type FilterParams =
  | { year: number; week: number; startDate?: never; endDate?: never }
  | { startDate: string; endDate: string; year?: never; week?: never };

function filterQuery(f: FilterParams): string {
  if ('startDate' in f && f.startDate) {
    return `startDate=${f.startDate}&endDate=${f.endDate}`;
  }
  return `year=${(f as { year: number }).year}&week=${(f as { week: number }).week}`;
}

export const metaApi = {
  years: () => api.get<number[]>('/meta/years').then((r) => r.data),
  weeks: (year: number) =>
    api.get<{ week_number: number; week_start: string | null; week_end: string | null }[]>(
      `/meta/weeks?year=${year}`
    ).then((r) => r.data),
  projects: () =>
    api.get<{ project_id: string; project_name: string; overall_status: string; active: string }[]>(
      '/meta/projects'
    ).then((r) => r.data),
  resources: () => api.get('/meta/resources').then((r) => r.data),
  dateRange: () =>
    api.get<{ minDate: string | null; maxDate: string | null }>('/meta/date-range').then((r) => r.data),
};

export const resourcesApi = {
  summary: (f: FilterParams) =>
    api.get(`/resources/summary?${filterQuery(f)}`).then((r) => r.data),
  crAssignments: (f: FilterParams) =>
    api.get(`/resources/cr-assignments?${filterQuery(f)}`).then((r) => r.data),
  executionByResource: (f: FilterParams) =>
    api.get(`/resources/charts/execution-by-resource?${filterQuery(f)}`).then((r) => r.data),
  bugsByResource: (f: FilterParams) =>
    api.get(`/resources/charts/bugs-by-resource?${filterQuery(f)}`).then((r) => r.data),
  weeklyTrends: (year: number) =>
    api.get(`/resources/charts/weekly-trends?year=${year}`).then((r) => r.data),
};

export const projectsApi = {
  summary: (f: FilterParams) =>
    api.get(`/projects/summary?${filterQuery(f)}`).then((r) => r.data),
  statusReport: (f: FilterParams) =>
    api.get(`/projects/status-report?${filterQuery(f)}`).then((r) => r.data),
  detail: (projectId: string, f: FilterParams) =>
    api.get(`/projects/${projectId}/detail?${filterQuery(f)}`).then((r) => r.data),
  statusDistribution: (f: FilterParams) =>
    api.get(`/projects/charts/status-distribution?${filterQuery(f)}`).then((r) => r.data),
  completionByProject: (f: FilterParams) =>
    api.get(`/projects/charts/completion-by-project?${filterQuery(f)}`).then((r) => r.data),
  bugsByProject: (f: FilterParams) =>
    api.get(`/projects/charts/bugs-by-project?${filterQuery(f)}`).then((r) => r.data),
  completionTrends: (year: number, projectId?: string) =>
    api.get(`/projects/charts/completion-trends?year=${year}${projectId ? `&projectId=${projectId}` : ''}`).then((r) => r.data),
  resourcesByProject: (f: FilterParams) =>
    api.get(`/projects/charts/resources-by-project?${filterQuery(f)}`).then((r) => r.data),
};

export const importApi = {
  status: () => api.get('/import/status').then((r) => r.data),
  refresh: () => api.post('/import/refresh').then((r) => r.data),
};

export const uploadApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  applyMapping: (payload: {
    filePath: string;
    mapping: Record<string, string>;
    weekYear?: number;
    weekNumber?: number;
  }) => api.post('/upload/apply-mapping', payload).then((r) => r.data),
  getMappings: () => api.get('/upload/mappings').then((r) => r.data),
};

export const settingsApi = {
  getAi: () => api.get<{ keyConfigured: boolean }>('/settings/ai').then((r) => r.data),
  saveAiKey: (apiKey: string) => api.post('/settings/ai', { apiKey }).then((r) => r.data),
  deleteAiKey: () => api.delete('/settings/ai').then((r) => r.data),
  testAiKey: () => api.post('/settings/ai/test').then((r) => r.data),
};

export const aiApi = {
  listReports: () => api.get('/ai/reports').then((r) => r.data),
  getReport: (id: number) => api.get(`/ai/reports/${id}`).then((r) => r.data),
};

export const jenkinsApi = {
  jobs: () => api.get('/jenkins/jobs').then((r) => r.data),
  builds: (params?: { jobName?: string; result?: string; limit?: number }) =>
    api.get('/jenkins/builds', { params }).then((r) => r.data),
  jobBuilds: (jobName: string, limit = 30) =>
    api.get(`/jenkins/jobs/${encodeURIComponent(jobName)}/builds?limit=${limit}`).then((r) => r.data),
  summary: () => api.get('/jenkins/summary').then((r) => r.data),
  trends: (params?: { jobName?: string; days?: number }) =>
    api.get('/jenkins/trends', { params }).then((r) => r.data),
  sync: () => api.post('/jenkins/sync').then((r) => r.data),
  getSettings: () => api.get('/settings/jenkins').then((r) => r.data),
  saveSettings: (payload: { url: string; username: string; apiToken: string; pollIntervalMinutes: number }) =>
    api.post('/settings/jenkins', payload).then((r) => r.data),
  deleteSettings: () => api.delete('/settings/jenkins').then((r) => r.data),
  testConnection: () => api.post('/settings/jenkins/test').then((r) => r.data),
};
