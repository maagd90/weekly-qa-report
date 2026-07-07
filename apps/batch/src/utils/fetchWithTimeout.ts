import fs from 'fs';
import path from 'path';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';

const DEFAULT_MS = 30_000;
const DEBUG_LOG_FILE = 'integration-debug.jsonl';
const MAX_PREVIEW = 2_000;

type FetchHeaders = RequestInit['headers'];
type FetchBody = RequestInit['body'];

let cachedDispatcherKey = '';
let cachedDispatcher: Dispatcher | undefined;

function truthyEnv(value?: string): boolean {
  return ['1', 'true', 'yes', 'y', 'on'].includes((value || '').trim().toLowerCase());
}

function falsyEnv(value?: string): boolean {
  return ['0', 'false', 'no', 'n', 'off'].includes((value || '').trim().toLowerCase());
}

function integrationDebugEnabled(): boolean {
  return !falsyEnv(process.env.INTEGRATION_DEBUG) && !falsyEnv(process.env.API_DEBUG);
}

function debugFileEnabled(): boolean {
  return !falsyEnv(process.env.INTEGRATION_DEBUG_FILE);
}

function proxyUrl(): string {
  return (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
}

function allowSelfSignedCertificates(): boolean {
  if (falsyEnv(process.env.INTEGRATION_ALLOW_SELF_SIGNED_CERTS) || falsyEnv(process.env.JIRA_ALLOW_SELF_SIGNED)) return false;
  return truthyEnv(process.env.INTEGRATION_ALLOW_SELF_SIGNED_CERTS)
    || truthyEnv(process.env.JIRA_ALLOW_SELF_SIGNED)
    || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
}

function integrationDispatcher(): Dispatcher | undefined {
  const proxy = proxyUrl();
  const allowSelfSigned = allowSelfSignedCertificates();
  const key = `${proxy}|${allowSelfSigned}`;
  if (cachedDispatcherKey === key) return cachedDispatcher;

  cachedDispatcherKey = key;
  cachedDispatcher = undefined;

  if (!proxy && !allowSelfSigned) return undefined;

  const tlsOptions = allowSelfSigned ? { rejectUnauthorized: false } : undefined;

  if (proxy) {
    cachedDispatcher = new ProxyAgent({ uri: proxy, requestTls: tlsOptions, proxyTls: tlsOptions } as unknown as ConstructorParameters<typeof ProxyAgent>[0]);
  } else {
    cachedDispatcher = new Agent({ connect: tlsOptions } as unknown as ConstructorParameters<typeof Agent>[0]);
  }

  return cachedDispatcher;
}

function nextIntegrationRequestId(): string {
  return `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('authorization') || lower.includes('cookie') || lower.includes('token') || lower.includes('secret') || lower.includes('password') || lower.includes('credential') || lower.includes('session') || lower.includes('xsrf') || lower.includes('key');
}

function redactValue(value: unknown, key = ''): unknown {
  if (isSensitiveKey(key)) return value ? '***redacted***' : value;
  if (typeof value === 'string') return value.length > MAX_PREVIEW ? `${value.slice(0, MAX_PREVIEW)}...<truncated>` : value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, k);
    return out;
  }
  return value;
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) if (isSensitiveKey(key)) url.searchParams.set(key, '***redacted***');
    return url.toString();
  } catch { return rawUrl; }
}

function headerObject(headers?: FetchHeaders): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!headers) return out;
  if (headers instanceof Headers) headers.forEach((v, k) => { out[k] = redactValue(v, k); });
  else if (Array.isArray(headers)) headers.forEach(([k, v]) => { out[k] = redactValue(v, k); });
  else Object.entries(headers as Record<string, string>).forEach(([k, v]) => { out[k] = redactValue(v, k); });
  return out;
}

function previewBody(body: FetchBody | null | undefined): unknown {
  if (body === null || body === undefined) return undefined;
  if (typeof body !== 'string') return `[${body.constructor?.name || 'Body'}]`;
  const raw = body.length > MAX_PREVIEW ? `${body.slice(0, MAX_PREVIEW)}...<truncated>` : body;
  try { return redactValue(JSON.parse(raw)); } catch { return raw; }
}

function debugDir(): string {
  return process.env.INTEGRATION_DEBUG_DIR || process.env.OUTPUT_DIR || path.resolve(process.cwd(), 'output');
}

function writeIntegrationLog(event: string, payload: Record<string, unknown>): void {
  if (!integrationDebugEnabled()) return;
  const entry = { ts: new Date().toISOString(), event, ...payload };
  console.log(`[integration] ${event}`, entry);
  if (!debugFileEnabled()) return;
  try {
    const dir = debugDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, DEBUG_LOG_FILE), `${JSON.stringify(entry)}\n`);
  } catch {
    // Console logging is enough when the output directory is not writable.
  }
}

function responsePreview(text: string): unknown {
  const raw = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}...<truncated>` : text;
  try { return JSON.parse(raw); } catch { return raw; }
}

function methodOf(init: RequestInit): string {
  return (init.method || 'GET').toUpperCase();
}

function removeHeader(headers: FetchHeaders | undefined, name: string): FetchHeaders | undefined {
  if (!headers) return headers;
  const lower = name.toLowerCase();
  if (headers instanceof Headers) { const h = new Headers(headers); h.delete(name); return h; }
  if (Array.isArray(headers)) return headers.filter(([k]) => k.toLowerCase() !== lower);
  const copy: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, string>)) if (k.toLowerCase() !== lower) copy[k] = String(v);
  return copy;
}

function qmetryTestCaseMethodRetry(url: string, init: RequestInit, status: number, responseText: string): RequestInit | null {
  if (!url.includes('/rest/qtm4j/ui/latest/testcycles/') || !url.includes('/testcases/search')) return null;
  const method = methodOf(init);
  const methodNotAllowed = /method specified in the request is not allowed/i.test(responseText);
  const invalidBody = /entered data is either invalid or not supported/i.test(responseText);
  if (methodNotAllowed && method !== 'POST') return { ...init, method: 'POST', body: undefined, headers: removeHeader(init.headers, 'content-type') };
  if ((methodNotAllowed || invalidBody) && method === 'POST' && init.body !== undefined) return { ...init, method: 'POST', body: undefined, headers: removeHeader(init.headers, 'content-type') };
  if (status === 405 && method !== 'POST') return { ...init, method: 'POST', body: undefined, headers: removeHeader(init.headers, 'content-type') };
  return null;
}

async function fetchAttempt(url: string, init: RequestInit, timeoutMs: number, requestId: string, attempt: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = integrationDispatcher();
  const requestInit = dispatcher
    ? ({ ...init, signal: controller.signal, dispatcher } as RequestInit & { dispatcher: Dispatcher })
    : { ...init, signal: controller.signal };
  const startedAt = Date.now();
  writeIntegrationLog('request:start', { requestId, attempt, method: methodOf(init), url: redactUrl(url), timeoutMs, hasProxy: Boolean(proxyUrl()), allowSelfSigned: allowSelfSignedCertificates(), headers: headerObject(init.headers), body: previewBody(init.body) });
  try {
    const response = await fetch(url, requestInit);
    const elapsedMs = Date.now() - startedAt;
    let text = '';
    try { text = await response.clone().text(); } catch { text = ''; }
    writeIntegrationLog('request:done', { requestId, attempt, method: methodOf(init), url: redactUrl(url), status: response.status, ok: response.ok, elapsedMs, response: responsePreview(text) });
    if (!response.ok && attempt === 1) {
      const retryInit = qmetryTestCaseMethodRetry(url, init, response.status, text);
      if (retryInit) {
        writeIntegrationLog('request:retry', { requestId, fromMethod: methodOf(init), toMethod: methodOf(retryInit), reason: 'QMetry test case endpoint rejected HTTP method/body', url: redactUrl(url) });
        return fetchAttempt(url, retryInit, timeoutMs, requestId, attempt + 1);
      }
    }
    return response;
  } catch (err) {
    writeIntegrationLog('request:error', { requestId, attempt, method: methodOf(init), url: redactUrl(url), elapsedMs: Date.now() - startedAt, error: describeFetchError(err) });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function describeFetchError(err: unknown): string {
  const error = err as Error & { cause?: unknown; code?: string; name?: string };
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const raw = [error.message, error.code, cause?.message, cause?.code].filter(Boolean).join(' · ');

  if (/SELF_SIGNED_CERT_IN_CHAIN|self-signed certificate|unable to verify the first certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(raw)) {
    return 'fetch failed · cause=self-signed certificate in certificate chain. Docker is using the integration TLS compatibility path. Keep INTEGRATION_ALLOW_SELF_SIGNED_CERTS=true for office/on-prem networks, or mount the company root CA and set NODE_EXTRA_CA_CERTS for stricter validation.';
  }

  if (error.name === 'AbortError') return `request timed out after ${DEFAULT_MS}ms`;
  return raw || String(err);
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_MS): Promise<Response> {
  return fetchAttempt(url, init, timeoutMs, nextIntegrationRequestId(), 1);
}

export function safeApiError(prefix: string, status: number, body?: string): string {
  console.error(`[${prefix}] HTTP ${status}:`, body?.slice(0, 1_000) || '(empty)');
  let snippet = '';
  if (body) {
    try {
      const parsed = JSON.parse(body) as { errorMessage?: string; message?: string; error?: string };
      snippet = parsed.errorMessage || parsed.message || parsed.error || '';
    } catch { snippet = body.replace(/\s+/g, ' '); }
  }
  snippet = snippet.slice(0, 250);
  return snippet ? `${prefix} error ${status}: ${snippet}` : `${prefix} error ${status}`;
}
