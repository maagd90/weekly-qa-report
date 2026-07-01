import { ProxyAgent } from 'undici';
import { loadReportConfig } from '../config/loadReportConfig';
import type { AnthropicLogFn } from './anthropicLog';

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_BODY_TIMEOUT_MS = 120_000;

/**
 * Anthropic outbound proxy — opt-in via config/report.json only.
 *
 * When proxy.enabled is false (default), all Anthropic calls go direct to
 * api.anthropic.com — same as before the proxy feature existed.
 *
 * When proxy.enabled is true, URL is taken from (in order):
 *   proxy.url in report.json → ANTHROPIC_PROXY_URL → HTTPS_PROXY in .env
 *
 * Proxy auth: embed in URL -> http://user:pass@proxy.corp:8080
 */
export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(invalid URL)';
  }
}

function normalizeProxyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function isPlaceholderProxy(url: string): boolean {
  return /proxy\.corp\.example|your-proxy|REPLACE_WITH/i.test(url);
}

export interface AnthropicProxyResolution {
  configEnabled: boolean;
  active: boolean;
  maskedUrl?: string;
  /** Internal — not sent to clients */
  url?: string;
}

function resolveProxyUrlFromEnv(): string {
  return (
    process.env.ANTHROPIC_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    ''
  ).trim();
}

/** Resolve proxy settings from config/report.json (opt-in). */
export function resolveAnthropicProxy(
  configDir: string,
  log?: AnthropicLogFn,
): AnthropicProxyResolution {
  const { proxy } = loadReportConfig(configDir);

  if (!proxy.enabled) {
    log?.('proxy disabled', 'config/report.json proxy.enabled=false — using direct connection');
    return { configEnabled: false, active: false };
  }

  log?.('proxy enabled in config', 'config/report.json proxy.enabled=true');

  const raw = (proxy.url || resolveProxyUrlFromEnv()).trim();
  if (!raw) {
    log?.(
      'proxy URL missing',
      'set proxy.url in config/report.json or ANTHROPIC_PROXY_URL / HTTPS_PROXY in .env — falling back to direct',
    );
    return { configEnabled: true, active: false };
  }

  const normalized = normalizeProxyUrl(raw);
  if (isPlaceholderProxy(normalized)) {
    log?.('proxy URL ignored', 'placeholder value detected — falling back to direct');
    return { configEnabled: true, active: false };
  }

  try {
    // eslint-disable-next-line no-new
    new URL(normalized);
    const masked = maskProxyUrl(normalized);
    log?.('proxy route active', masked);
    return { configEnabled: true, active: true, maskedUrl: masked, url: normalized };
  } catch {
    log?.('proxy URL invalid', `${maskProxyUrl(normalized)} — falling back to direct`);
    return { configEnabled: true, active: false };
  }
}

export function getAnthropicProxyInfo(configDir: string, log?: AnthropicLogFn): AnthropicProxyResolution {
  return resolveAnthropicProxy(configDir, log);
}

function getActiveProxyUrl(
  configDir: string,
  log?: AnthropicLogFn,
  resolution?: AnthropicProxyResolution,
): string | undefined {
  const resolved = resolution ?? resolveAnthropicProxy(configDir, log);
  if (!resolved.active || !resolved.url) return undefined;
  return resolved.url;
}

export function getAnthropicFetchOptions(
  configDir: string,
  opts?: { connectTimeoutMs?: number; bodyTimeoutMs?: number },
  log?: AnthropicLogFn,
  resolution?: AnthropicProxyResolution,
): { dispatcher: ProxyAgent } | undefined {
  const proxyUrl = getActiveProxyUrl(configDir, log, resolution);
  if (!proxyUrl) return undefined;

  log?.(
    'creating ProxyAgent',
    `connectTimeout=${opts?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS}ms bodyTimeout=${opts?.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS}ms`,
  );

  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      connectTimeout: opts?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      bodyTimeout: opts?.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS,
    }),
  };
}
