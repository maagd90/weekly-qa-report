import { Agent, ProxyAgent, type Dispatcher } from 'undici';

const DEFAULT_MS = 30_000;

let cachedDispatcherKey = '';
let cachedDispatcher: Dispatcher | undefined;

function truthyEnv(value?: string): boolean {
  return ['1', 'true', 'yes', 'y', 'on'].includes((value || '').trim().toLowerCase());
}

function falsyEnv(value?: string): boolean {
  return ['0', 'false', 'no', 'n', 'off'].includes((value || '').trim().toLowerCase());
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
    cachedDispatcher = new ProxyAgent({
      uri: proxy,
      requestTls: tlsOptions,
      proxyTls: tlsOptions,
    } as unknown as ConstructorParameters<typeof ProxyAgent>[0]);
  } else {
    cachedDispatcher = new Agent({ connect: tlsOptions } as unknown as ConstructorParameters<typeof Agent>[0]);
  }

  return cachedDispatcher;
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

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = integrationDispatcher();
  const requestInit = dispatcher
    ? ({ ...init, signal: controller.signal, dispatcher } as RequestInit & { dispatcher: Dispatcher })
    : { ...init, signal: controller.signal };

  try {
    return await fetch(url, requestInit);
  } finally {
    clearTimeout(timer);
  }
}

export function safeApiError(prefix: string, status: number, body?: string): string {
  console.error(`[${prefix}] HTTP ${status}:`, body?.slice(0, 500) || '(empty)');
  const snippet = body ? body.replace(/\s+/g, ' ').slice(0, 120) : '';
  return snippet ? `${prefix} error ${status}: ${snippet}` : `${prefix} error ${status}`;
}
