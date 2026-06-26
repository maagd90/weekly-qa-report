import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export type ReportType = 'full' | 'executive' | 'resources' | 'projects';

export interface GenerateParams {
  startDate: string;
  endDate: string;
  reportType: ReportType;
  projectId?: string;
}

export const batchApi = {
  getStatus: () => api.get('/status').then((r) => r.data as { apiKeyConfigured: boolean }),
  generate: (params: GenerateParams) => api.post('/generate', params).then((r) => r.data),
  getDashboard: () => api.get('/dashboard').then((r) => r.data).catch((err) => {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }),
  getReport: () => api.get('/report').then((r) => r.data).catch((err) => {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  listInputFiles: () => api.get('/input/files').then((r) => r.data),
  deleteInputFile: (filename: string) => api.delete(`/input/${encodeURIComponent(filename)}`).then((r) => r.data),
  listMappings: () => api.get('/mappings').then((r) => r.data),
  saveMapping: (payload: { pattern: string; mapping: Record<string, string>; weekYear?: number; weekNumber?: number }) =>
    api.post('/mappings', payload).then((r) => r.data),
};

export type FilterParams =
  | { year: number; week: number; startDate?: never; endDate?: never }
  | { startDate: string; endDate: string; year?: never; week?: never };

export const CHART_IDS = [
  'execution-by-resource',
  'bugs-by-resource',
  'weekly-trends',
  'status-distribution',
  'completion-by-project',
  'bugs-by-project',
  'completion-trends',
] as const;

export type ChartId = typeof CHART_IDS[number];

export const DEFAULT_CHART_PREFERENCES: Record<ChartId, boolean> = {
  'execution-by-resource': true,
  'bugs-by-resource': true,
  'weekly-trends': true,
  'status-distribution': true,
  'completion-by-project': true,
  'bugs-by-project': true,
  'completion-trends': true,
};
