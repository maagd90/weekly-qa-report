import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const DEFAULT_PRINT_URL = 'http://dashboard-web/print/report';
const DEFAULT_CHROMIUM = '/usr/bin/chromium';
const DEFAULT_RENDER_TIMEOUT_MS = 90_000;
const MAX_CONCURRENT_PDF = 2;

let cachedBrowser: Browser | null = null;
let activePdfJobs = 0;
const pdfQueue: Array<() => void> = [];
let shutdownHooksRegistered = false;

function pdfLog(message: string, data?: Record<string, unknown>): void {
  console.log(`[pdf] ${message}`, data || '');
}

function pdfError(message: string, err: unknown, data?: Record<string, unknown>): void {
  console.error(`[pdf] ${message}`, { ...data, error: err instanceof Error ? err.message : String(err) });
}

function renderTimeoutMs(): number {
  const raw = Number(process.env.PDF_RENDER_TIMEOUT_MS || DEFAULT_RENDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 10_000 ? raw : DEFAULT_RENDER_TIMEOUT_MS;
}

function normalizeExecutablePath(raw: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1);
  if (process.platform === 'win32') p = p.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
  return path.normalize(p);
}

function resolveChromiumPath(): string {
  const raw = process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_CHROMIUM;
  const executablePath = normalizeExecutablePath(raw);
  pdfLog('resolve chromium', { executablePath, exists: fs.existsSync(executablePath) });
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Chromium not found at "${executablePath}". Set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome/Edge path or run via Docker.`);
  }
  return executablePath;
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const closeBrowser = async () => {
    if (cachedBrowser) {
      try { await cachedBrowser.close(); } catch { /* ignore */ }
      cachedBrowser = null;
    }
  };
  process.on('SIGTERM', closeBrowser);
  process.on('SIGINT', closeBrowser);
}

async function acquirePdfSlot(): Promise<void> {
  if (activePdfJobs < MAX_CONCURRENT_PDF) {
    activePdfJobs += 1;
    pdfLog('slot acquired', { activePdfJobs });
    return;
  }
  pdfLog('slot queued', { activePdfJobs, queueLength: pdfQueue.length });
  await new Promise<void>((resolve) => {
    pdfQueue.push(() => {
      activePdfJobs += 1;
      pdfLog('queued slot acquired', { activePdfJobs });
      resolve();
    });
  });
}

function releasePdfSlot(): void {
  activePdfJobs -= 1;
  pdfLog('slot released', { activePdfJobs, queueLength: pdfQueue.length });
  const next = pdfQueue.shift();
  if (next) next();
}

async function getBrowser(executablePath: string): Promise<Browser> {
  registerShutdownHooks();
  if (cachedBrowser?.connected) {
    pdfLog('using cached chromium');
    return cachedBrowser;
  }
  pdfLog('launching chromium', { executablePath });
  cachedBrowser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });
  cachedBrowser.on('disconnected', () => {
    pdfLog('chromium disconnected');
    cachedBrowser = null;
  });
  return cachedBrowser;
}

async function waitForPrintSignal(page: Page, selectorTimeout: number): Promise<void> {
  pdfLog('waiting for print readiness', { selectorTimeout });
  try {
    await Promise.race([
      page.waitForSelector('.qa-pdf-ready', { timeout: selectorTimeout }),
      page.waitForSelector('.qa-pdf-error', { timeout: selectorTimeout }),
    ]);
  } catch {
    throw new Error(`Report did not finish rendering within ${selectorTimeout}ms`);
  }

  const errEl = await page.$('.qa-pdf-error');
  if (errEl) {
    const msg = await page.$eval('.qa-pdf-error', (el, fallback) => ((el as { textContent?: string | null }).textContent?.trim() || fallback), 'Print page error');
    throw new Error(msg);
  }
  pdfLog('print page ready');
}

async function renderPdfPage(page: Page, url: string, gotoTimeout: number, selectorTimeout: number): Promise<Buffer> {
  page.on('console', (msg) => pdfLog(`browser console:${msg.type()}`, { text: msg.text() }));
  page.on('pageerror', (err) => pdfError('browser page error', err));
  page.on('requestfailed', (req) => pdfLog('browser request failed', { url: req.url(), failure: req.failure()?.errorText }));
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  pdfLog('opening print page', { url, gotoTimeout, selectorTimeout });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: gotoTimeout });
  await waitForPrintSignal(page, selectorTimeout);
  pdfLog('rendering PDF');
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: false, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
  pdfLog('PDF rendered', { bytes: pdf.length });
  return Buffer.from(pdf);
}

export async function generateReportPdf(startDate: string, endDate: string, reportType: string, kpiStyle: string, project?: string): Promise<Buffer> {
  const totalTimeout = renderTimeoutMs();
  const gotoTimeout = Math.floor(totalTimeout * 0.6);
  const selectorTimeout = Math.floor(totalTimeout * 0.35);
  const baseUrl = process.env.PDF_PRINT_URL || DEFAULT_PRINT_URL;
  const qs = new URLSearchParams({ startDate, endDate, reportType, kpiStyle });
  if (project && project !== 'all') qs.set('project', project);
  const url = `${baseUrl}?${qs.toString()}`;
  const executablePath = resolveChromiumPath();

  pdfLog('generateReportPdf:start', { startDate, endDate, reportType, kpiStyle, project: project || 'all', baseUrl, totalTimeout });
  await acquirePdfSlot();
  let page: Page | null = null;
  try {
    const browser = await getBrowser(executablePath);
    page = await browser.newPage();
    return await renderPdfPage(page, url, gotoTimeout, selectorTimeout);
  } catch (err) {
    pdfError('generateReportPdf:failed', err, { startDate, endDate, reportType, kpiStyle, project });
    throw err;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    releasePdfSlot();
  }
}
