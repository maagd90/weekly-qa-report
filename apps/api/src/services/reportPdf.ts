import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const DEFAULT_PRINT_URL = 'http://dashboard-web/print/report';
const LOCAL_PRINT_URL = 'http://localhost:3000/print/report';
const DEFAULT_RENDER_TIMEOUT_MS = 90_000;
const MAX_CONCURRENT_PDF = 2;
const INLINE_LOGO_PATH = '/__report-logo';

let cachedBrowser: Browser | null = null;
let activePdfJobs = 0;
const pdfQueue: Array<() => void> = [];
let shutdownHooksRegistered = false;

export interface ReportBrandingPayload {
  logoUrl?: string;
  logoAlt?: string;
  title?: string;
  subtitle?: string;
}

interface InlineLogoAsset {
  mimeType: string;
  buffer: Buffer;
}

function pdfLog(message: string, data?: Record<string, unknown>): void { console.log(`[pdf] ${message}`, data || ''); }
function pdfError(message: string, err: unknown, data?: Record<string, unknown>): void { console.error(`[pdf] ${message}`, { ...data, error: err instanceof Error ? err.message : String(err) }); }
function renderTimeoutMs(): number { const raw = Number(process.env.PDF_RENDER_TIMEOUT_MS || DEFAULT_RENDER_TIMEOUT_MS); return Number.isFinite(raw) && raw > 10_000 ? raw : DEFAULT_RENDER_TIMEOUT_MS; }
function stripQuotes(value: string): string { const p = value.trim(); if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) return p.slice(1, -1); return p; }
function expandWindowsEnv(value: string): string { return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`); }
function normalizeExecutablePath(raw: string): string { let p = stripQuotes(raw); if (!p) return ''; if (process.platform === 'win32') { p = expandWindowsEnv(p); if (/^\/[a-z0-9_-]+\//i.test(p)) return p; } return path.normalize(p); }

function candidateBrowserPaths(): string[] {
  const candidates = new Set<string>();
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) candidates.add(configured);
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA;
    const chrome = 'Google\\Chrome\\Application\\chrome.exe';
    const edge = 'Microsoft\\Edge\\Application\\msedge.exe';
    candidates.add(path.join(programFiles, chrome));
    candidates.add(path.join(programFilesX86, chrome));
    candidates.add(path.join(programFiles, edge));
    candidates.add(path.join(programFilesX86, edge));
    if (localAppData) candidates.add(path.join(localAppData, chrome));
  } else if (process.platform === 'darwin') {
    candidates.add('/Applications/Google Chrome.app/Contents/MOS/Google Chrome'.replace('/MOS/', '/MacOS/'));
    candidates.add('/Applications/Microsoft Edge.app/Contents/MOS/Microsoft Edge'.replace('/MOS/', '/MacOS/'));
    candidates.add('/Applications/Chromium.app/Contents/MOS/Chromium'.replace('/MOS/', '/MacOS/'));
  } else {
    candidates.add('/usr/bin/chromium');
    candidates.add('/usr/bin/chromium-browser');
    candidates.add('/usr/bin/google-chrome');
    candidates.add('/usr/bin/google-chrome-stable');
    candidates.add('/snap/bin/chromium');
  }
  return [...candidates].map(normalizeExecutablePath).filter(Boolean);
}

function resolveChromiumPath(): string {
  const candidates = candidateBrowserPaths();
  for (const executablePath of candidates) {
    if (fs.existsSync(executablePath)) {
      pdfLog('resolve browser executable', { executablePath, source: executablePath === normalizeExecutablePath(process.env.PUPPETEER_EXECUTABLE_PATH || '') ? 'configured' : 'auto-detected' });
      return executablePath;
    }
  }
  pdfLog('browser executable not found', { platform: process.platform, candidates });
  throw new Error(`Chromium/Chrome/Edge executable not found. Checked: ${candidates.join(', ') || '(none)'}. For Docker, rebuild the API image so Chromium is installed. For local Windows, install Chrome/Edge or set paths.puppeteerExecutablePath in config/runtime.json to your chrome.exe/msedge.exe path.`);
}

function inlineLogoFromDataUrl(value?: string): InlineLogoAsset | null {
  if (!value || !value.startsWith('data:image/')) return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  return { mimeType: match[1], buffer };
}

async function attachInlineLogoInterceptor(page: Page, inlineLogo: InlineLogoAsset | null): Promise<void> {
  if (!inlineLogo) return;
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const reqUrl = new URL(request.url());
      if (reqUrl.pathname === INLINE_LOGO_PATH) { await request.respond({ status: 200, contentType: inlineLogo.mimeType, body: inlineLogo.buffer }); return; }
      await request.continue();
    } catch { await request.continue(); }
  });
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const closeBrowser = async () => { if (cachedBrowser) { try { await cachedBrowser.close(); } catch { /* ignore */ } cachedBrowser = null; } };
  process.on('SIGTERM', closeBrowser);
  process.on('SIGINT', closeBrowser);
}

async function acquirePdfSlot(): Promise<void> { if (activePdfJobs < MAX_CONCURRENT_PDF) { activePdfJobs += 1; pdfLog('slot acquired', { activePdfJobs }); return; } pdfLog('slot queued', { activePdfJobs, queueLength: pdfQueue.length }); await new Promise<void>((resolve) => { pdfQueue.push(() => { activePdfJobs += 1; pdfLog('queued slot acquired', { activePdfJobs }); resolve(); }); }); }
function releasePdfSlot(): void { activePdfJobs -= 1; pdfLog('slot released', { activePdfJobs, queueLength: pdfQueue.length }); const next = pdfQueue.shift(); if (next) next(); }

async function getBrowser(executablePath: string): Promise<Browser> {
  registerShutdownHooks();
  if (cachedBrowser?.connected) { pdfLog('using cached chromium'); return cachedBrowser; }
  pdfLog('launching chromium', { executablePath });
  cachedBrowser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'] });
  cachedBrowser.on('disconnected', () => { pdfLog('chromium disconnected'); cachedBrowser = null; });
  return cachedBrowser;
}

async function waitForPrintSignal(page: Page, selectorTimeout: number): Promise<void> {
  pdfLog('waiting for print readiness', { selectorTimeout });
  try { await Promise.race([page.waitForSelector('.qa-pdf-ready', { timeout: selectorTimeout }), page.waitForSelector('.qa-pdf-error', { timeout: selectorTimeout })]); } catch { throw new Error(`Report did not finish rendering within ${selectorTimeout}ms`); }
  const errEl = await page.$('.qa-pdf-error');
  if (errEl) { const msg = await page.$eval('.qa-pdf-error', (el, fallback) => ((el as { textContent?: string | null }).textContent?.trim() || fallback), 'Print page error'); throw new Error(msg); }
  pdfLog('print page ready');
}

function printBaseCandidates(): string[] {
  const configured = process.env.PDF_PRINT_URL || DEFAULT_PRINT_URL;
  const values = [configured];
  if (configured.includes('dashboard-web')) values.push(LOCAL_PRINT_URL, 'http://127.0.0.1:3000/print/report');
  return [...new Set(values)];
}

function buildPrintUrl(baseUrl: string, startDate: string, endDate: string, reportType: string, kpiStyle: string, project: string | undefined, branding: ReportBrandingPayload | undefined, inlineLogo: InlineLogoAsset | null, reportId?: string): string {
  const qs = new URLSearchParams({ startDate, endDate, reportType, kpiStyle });
  if (project && project !== 'all') qs.set('project', project);
  if (inlineLogo) qs.set('logoUrl', INLINE_LOGO_PATH); else if (branding?.logoUrl) qs.set('logoUrl', branding.logoUrl);
  if (branding?.logoAlt) qs.set('logoAlt', branding.logoAlt);
  if (branding?.title) qs.set('title', branding.title);
  if (branding?.subtitle) qs.set('subtitle', branding.subtitle);
  if (reportId) qs.set('reportId', reportId);
  return `${baseUrl}?${qs.toString()}`;
}

function shouldTryNextPrintUrl(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION_REFUSED/i.test(msg);
}

async function renderPdfPage(page: Page, url: string, gotoTimeout: number, selectorTimeout: number, inlineLogo: InlineLogoAsset | null): Promise<Buffer> {
  page.on('console', (msg) => pdfLog(`browser console:${msg.type()}`, { text: msg.text() }));
  page.on('pageerror', (err) => pdfError('browser page error', err));
  page.on('requestfailed', (req) => pdfLog('browser request failed', { url: req.url(), failure: req.failure()?.errorText }));
  await attachInlineLogoInterceptor(page, inlineLogo);
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  pdfLog('opening print page', { url, gotoTimeout, selectorTimeout, hasInlineLogo: Boolean(inlineLogo) });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: gotoTimeout });
  await waitForPrintSignal(page, selectorTimeout);
  pdfLog('rendering PDF');
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: false, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
  pdfLog('PDF rendered', { bytes: pdf.length });
  return Buffer.from(pdf);
}

export async function generateReportPdf(startDate: string, endDate: string, reportType: string, kpiStyle: string, project?: string, branding?: ReportBrandingPayload, reportId?: string): Promise<Buffer> {
  const totalTimeout = renderTimeoutMs();
  const gotoTimeout = Math.floor(totalTimeout * 0.6);
  const selectorTimeout = Math.floor(totalTimeout * 0.35);
  const inlineLogo = inlineLogoFromDataUrl(branding?.logoUrl);
  const executablePath = resolveChromiumPath();
  const bases = printBaseCandidates();
  pdfLog('generateReportPdf:start', { startDate, endDate, reportType, kpiStyle, project: project || 'all', hasLogo: Boolean(branding?.logoUrl), hasInlineLogo: Boolean(inlineLogo), bases, totalTimeout });
  await acquirePdfSlot();
  let lastErr: unknown = null;
  try {
    const browser = await getBrowser(executablePath);
    for (let i = 0; i < bases.length; i++) {
      const url = buildPrintUrl(bases[i], startDate, endDate, reportType, kpiStyle, project, branding, inlineLogo, reportId);
      let page: Page | null = null;
      try { page = await browser.newPage(); return await renderPdfPage(page, url, gotoTimeout, selectorTimeout, inlineLogo); }
      catch (err) { lastErr = err; pdfError('print URL failed', err, { url }); if (i >= bases.length - 1 || !shouldTryNextPrintUrl(err)) throw err; }
      finally { if (page) { try { await page.close(); } catch { /* ignore */ } } }
    }
    throw lastErr || new Error('PDF export failed');
  } catch (err) {
    pdfError('generateReportPdf:failed', err, { startDate, endDate, reportType, kpiStyle, project });
    throw err;
  } finally { releasePdfSlot(); }
}
