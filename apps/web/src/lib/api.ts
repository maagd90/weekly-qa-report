import axios from 'axios';
import type { DashboardPayload, FilterParams, ReportType, GenerateParams, GenerateResult } from 'qa-dashboard-batch';

const api = axios.create({ baseURL: '/api' });

function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (err.response?.status === 504) {
      return 'Report generation timed out at the gateway. Rebuild Docker (nginx timeout fix) or retry — Full reports can take 1–2 minutes.';
    }
    if (err.code === 'ECONNABORTED') {
      return 'Report generation timed out. Full reports can take 1–2 minutes — please wait and try again.';
    }
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

export { apiErrorMessage };
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

  generate: (params: GenerateParams) =>
    api.post<GenerateResult>('/generate', params, { timeout: 300_000 }).then((r) => r.data),

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
