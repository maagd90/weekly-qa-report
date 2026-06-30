const DEFAULT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function safeApiError(prefix: string, status: number, body?: string): string {
  console.error(`[${prefix}] HTTP ${status}:`, body?.slice(0, 500) || '(empty)');
  const snippet = body ? body.replace(/\s+/g, ' ').slice(0, 120) : '';
  return snippet ? `${prefix} error ${status}: ${snippet}` : `${prefix} error ${status}`;
}
