import puppeteer from 'puppeteer-core';

const DEFAULT_PRINT_URL = 'http://dashboard-web/print/report';
const DEFAULT_CHROMIUM = '/usr/bin/chromium';

export async function generateReportPdf(startDate: string, endDate: string): Promise<Buffer> {
  const baseUrl = process.env.PDF_PRINT_URL || DEFAULT_PRINT_URL;
  const url = `${baseUrl}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_CHROMIUM;

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
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForSelector('.qa-pdf-ready', { timeout: 15_000 });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
