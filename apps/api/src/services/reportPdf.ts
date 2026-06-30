import puppeteer from 'puppeteer-core';

const DEFAULT_PRINT_URL = 'http://dashboard-web/print/report';
const DEFAULT_CHROMIUM = '/usr/bin/chromium';

export async function generateReportPdf(
  startDate: string,
  endDate: string,
  reportType: string,
  kpiStyle: string,
): Promise<Buffer> {
  const baseUrl = process.env.PDF_PRINT_URL || DEFAULT_PRINT_URL;
  const qs = new URLSearchParams({
    startDate,
    endDate,
    reportType,
    kpiStyle,
  });
  const url = `${baseUrl}?${qs.toString()}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_CHROMIUM;
  const isMultiPage = reportType !== 'executive';

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: isMultiPage ? 45_000 : 30_000 });
    await page.waitForSelector('.qa-pdf-ready', { timeout: isMultiPage ? 25_000 : 15_000 });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
