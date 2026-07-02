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

  testAnthropic: () => {
    console.log('[web] batchApi.testAnthropic — sending GET /api/anthropic/test');
    const started = Date.now();
    return api.get('/anthropic/test', { timeout: 35_000 })
      .then((r) => {
        const data = r.data as {
          ok: boolean;
          model?: string;
          route?: 'direct' | 'proxy';
          elapsedMs?: number;
          error?: string;
          logs?: string[];
        };
        console.log(
          `[web] batchApi.testAnthropic — response ok=${data.ok} route=${data.route ?? 'direct'} elapsed=${Date.now() - started}ms`,
        );
        if (data.logs?.length) {
          console.group('[web] Anthropic test server logs');
          for (const line of data.logs) console.log(line);
          console.groupEnd();
        }
        return data;
      })
      .catch((err) => {
        console.error('[web] batchApi.testAnthropic — request failed:', err);
        throw new Error(apiErrorMessage(err, 'Anthropic connectivity test failed'));
      });
  },

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

  downloadReportPdf: async ({
    startDate,
    endDate,
    reportType,
    kpiStyle,
  }: {
    startDate: string;
    endDate: string;
    reportType: ReportType;
    kpiStyle: string;
  }) => {
    const response = await api.post(
      '/report/pdf',
      { startDate, endDate, reportType, kpiStyle },
      { responseType: 'blob', timeout: 150_000 },
    );
    const blob = response.data as Blob;
    if (blob.type === 'application/json') {
      const text = await blob.text();
      const payload = JSON.parse(text) as { error?: string };
      throw new Error(payload.error || 'PDF export failed');
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qa-report-${startDate}-to-${endDate}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
