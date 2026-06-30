import axios from 'axios';
import type { DashboardPayload, FilterParams, ReportType, GenerateParams, GenerateResult } from 'qa-dashboard-batch';

const api = axios.create({ baseURL: '/api' });

export type { DashboardPayload, FilterParams, ReportType, GenerateParams, GenerateResult };

export interface IntegrationsStatus {
  jira: { enabled: boolean; baseUrl: string; configured: boolean };
  qmetry: { enabled: boolean; baseUrl: string; configured: boolean; cycleIds: number };
  config: {
    jira: { enabled: boolean; projectKeys: string[]; jql: string };
    qmetry: { enabled: boolean; projectKey: string; cycleIds: string[] };
  };
}

export const batchApi = {
  getStatus: () => api.get('/status').then((r) => r.data as { apiKeyConfigured: boolean; jiraConfigured: boolean }),

  generate: (params: GenerateParams) => api.post<GenerateResult>('/generate', params).then((r) => r.data),

  getDashboard: (filter?: Partial<FilterParams>) => {
    const params = filter ? {
      startDate: filter.startDate,
      endDate: filter.endDate,
      search: filter.search,
      result: filter.result,
      project: filter.project,
    } : undefined;
    return api.get('/dashboard', { params }).then((r) => r.data as DashboardPayload).catch((err) => {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    });
  },

  getReport: () => api.get('/report').then((r) => r.data).catch((err) => {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }),

  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },

  listInputFiles: () => api.get('/input/files').then((r) => r.data as { name: string; size: number; modifiedAt: string }[]),
  deleteInputFile: (filename: string) => api.delete(`/input/${encodeURIComponent(filename)}`).then((r) => r.data),

  getIntegrations: () => api.get('/integrations').then((r) => r.data as IntegrationsStatus),
  testIntegrations: () => api.post('/integrations/test').then((r) => r.data),
};
