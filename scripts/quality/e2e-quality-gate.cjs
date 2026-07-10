const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureSyntheticFixtures,
  createSandbox,
  startApi,
  startWeb,
  stopProcess,
  jsonFetch,
  uploadFile,
  fixturePath,
  findChrome,
  loadPuppeteer,
  resultsDir,
  writeResult,
} = require('./qualityHarness.cjs');

const DLM_NAME = 'DN4_FT - Supply & DMC';
const DLM_ID = 'dn4-ft-supply-and-dmc';
const WM_NAME = 'WonderMiles';
const WM_ID = 'wondermiles';

const browserConnections = {
  jira: [{
    id: 'dlm-jira',
    name: 'DLM JIRA',
    workspaceName: DLM_NAME,
    baseUrl: 'http://jira.invalid',
    enabled: false,
    syncIssues: false,
    deploymentType: 'on-prem',
    authType: 'basic',
    email: 'qa-user',
    apiToken: 'test-only',
    projectKeys: ['DLM'],
  }],
  qmetry: [{
    id: 'wm-qmetry',
    name: 'WonderMiles QMetry',
    workspaceName: WM_NAME,
    baseUrl: 'http://qmetry.invalid',
    enabled: false,
    syncExecutions: false,
    email: 'qa-user',
    apiToken: 'test-only',
    projectKey: 'DTTRV',
    projectId: '19703',
  }],
};

async function syncImported(apiBaseUrl, project) {
  return jsonFetch(`${apiBaseUrl}/api/input/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
}

async function seed(apiBaseUrl) {
  for (const name of ['zephyr-regression.xlsx', 'jira-regression.xlsx', 'odl-regression.xlsx']) {
    await uploadFile(apiBaseUrl, DLM_ID, fixturePath(name));
  }
  await syncImported(apiBaseUrl, DLM_ID);
  await uploadFile(apiBaseUrl, WM_ID, fixturePath('wondermiles-qmetry-regression.xlsx'));
  await syncImported(apiBaseUrl, WM_ID);
}

async function clickButton(page, label) {
  const clicked = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().includes(text));
    if (!button) return false;
    button.click();
    return true;
  }, label);
  assert.equal(clicked, true, `button not found: ${label}`);
}

async function selectWorkspace(page, workspaceId, expectedRecordText) {
  await page.select('header select', workspaceId);
  await page.waitForFunction((id) => {
    const select = document.querySelector('header select');
    return select && select.value === id;
  }, {}, workspaceId);
  if (expectedRecordText) {
    await page.waitForFunction((text) => document.body.innerText.includes(text), { timeout: 20_000 }, expectedRecordText);
  }
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function verifyPdf(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/api/report/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project: WM_ID,
      startDate: '2026-06-01',
      endDate: '2026-07-31',
      reportType: 'executive',
      kpiStyle: 'editorial',
      branding: { title: 'Automated Workspace Report' },
    }),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, `PDF endpoint failed: ${bytes.toString('utf8', 0, Math.min(bytes.length, 500))}`);
  assert.match(response.headers.get('content-type') || '', /application\/pdf/i);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(bytes.length > 5_000, `PDF output is unexpectedly small: ${bytes.length} bytes`);
  const pdfPath = path.join(resultsDir, 'wondermiles-executive-report.pdf');
  fs.writeFileSync(pdfPath, bytes);
  return pdfPath;
}

async function main() {
  ensureSyntheticFixtures();
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome/Chromium was not found. Set CHROME_BIN before running npm run test:e2e.');

  const previousPdfPrintUrl = process.env.PDF_PRINT_URL;
  const previousExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const previousPdfTimeout = process.env.PDF_RENDER_TIMEOUT_MS;
  process.env.PDF_PRINT_URL = 'http://127.0.0.1:4173/print/report';
  process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
  process.env.PDF_RENDER_TIMEOUT_MS = '60000';

  const sandbox = createSandbox('e2e-isolation');
  const api = await startApi(sandbox, 3001);
  let web;
  let browser;
  const checks = [];
  const screenshotPath = path.join(resultsDir, 'workspace-isolation-e2e.png');
  let pdfPath;
  try {
    await seed(api.baseUrl);
    web = await startWeb(4173);
    const puppeteer = loadPuppeteer();
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument((connections, dlmId) => {
      localStorage.setItem('qa_dashboard_jira_connections', JSON.stringify(connections.jira));
      localStorage.setItem('qa_dashboard_qmetry_connections', JSON.stringify(connections.qmetry));
      localStorage.setItem('qa_dashboard_active_project', dlmId);
    }, browserConnections, DLM_ID);

    await page.goto(web.baseUrl, { waitUntil: 'networkidle2', timeout: 45_000 });
    await page.waitForSelector('header select', { timeout: 20_000 });
    await page.waitForFunction(() => document.body.innerText.includes('2,210 records') || document.body.innerText.includes('2210 records'), { timeout: 20_000 });

    const options = await page.$$eval('header select option', (nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent?.trim() })));
    assert.ok(options.some((option) => option.value === DLM_ID && option.text === DLM_NAME));
    assert.ok(options.some((option) => option.value === WM_ID && option.text === WM_NAME));
    checks.push('workspace options derive from connection names');

    await selectWorkspace(page, WM_ID, '12 records');
    let text = await bodyText(page);
    assert.ok(text.includes('WonderMiles'));
    checks.push('WonderMiles opens without JIRA credentials');

    await clickButton(page, 'Import Data');
    await page.waitForFunction(() => document.body.innerText.includes('wondermiles-qmetry-regression.xlsx'), { timeout: 20_000 });
    text = await bodyText(page);
    assert.ok(text.includes('wondermiles-qmetry-regression.xlsx'));
    assert.ok(!text.includes('jira-regression.xlsx'));
    assert.ok(!text.includes('zephyr-regression.xlsx'));
    checks.push('WonderMiles import list excludes DLM files');

    await selectWorkspace(page, DLM_ID, '2,210 records');
    await page.waitForFunction(() => document.body.innerText.includes('jira-regression.xlsx'), { timeout: 20_000 });
    text = await bodyText(page);
    assert.ok(text.includes('jira-regression.xlsx'));
    assert.ok(text.includes('zephyr-regression.xlsx'));
    assert.ok(text.includes('odl-regression.xlsx'));
    assert.ok(!text.includes('wondermiles-qmetry-regression.xlsx'));
    checks.push('DLM import list excludes WonderMiles files');

    await page.reload({ waitUntil: 'networkidle2', timeout: 45_000 });
    await page.waitForSelector('header select', { timeout: 20_000 });
    const selectedAfterReload = await page.$eval('header select', (select) => select.value);
    assert.equal(selectedAfterReload, DLM_ID);
    checks.push('selected workspace persists after refresh');

    await selectWorkspace(page, WM_ID, '12 records');
    await clickButton(page, 'Testers');
    await page.waitForFunction(() => document.body.innerText.includes('WM Tester One') && document.body.innerText.includes('WM Tester Two'), { timeout: 20_000 });
    text = await bodyText(page);
    assert.ok(!text.includes('Tester A'));
    checks.push('tester tab remains workspace scoped');

    await clickButton(page, 'Test Cycles');
    await page.waitForFunction(() => document.body.innerText.includes('WonderMiles June Regression') || document.body.innerText.includes('WonderMiles July Regression'), { timeout: 20_000 });
    text = await bodyText(page);
    assert.ok(!text.includes('Cycle Alpha'));
    checks.push('cycle tab remains workspace scoped');

    await clickButton(page, 'Settings');
    await page.waitForFunction(() => document.body.innerText.includes('WonderMiles (0 JIRA / 1 QMetry)'), { timeout: 20_000 });
    text = await bodyText(page);
    assert.ok(text.includes('WonderMiles (0 JIRA / 1 QMetry)'));
    assert.ok(text.includes(`${DLM_NAME} (1 JIRA / 0 QMetry)`));
    checks.push('settings supports QMetry-only WonderMiles workspace');

    pdfPath = await verifyPdf(api.baseUrl);
    checks.push('workspace-scoped PDF export renders through Chrome');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const resultPath = writeResult('e2e-quality-gate', { ok: true, checks, chrome, screenshotPath, pdfPath });
    console.log(`E2E quality gate passed (${checks.length} groups). Result: ${resultPath}`);
  } catch (error) {
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages[0]) await pages[0].screenshot({ path: path.join(resultsDir, 'workspace-isolation-e2e-failure.png'), fullPage: true });
      } catch { /* best effort */ }
    }
    const resultPath = writeResult('e2e-quality-gate', { ok: false, checks, chrome, pdfPath, error: error.stack || error.message });
    console.error(`E2E quality gate failed. Result: ${resultPath}`);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (web) {
      await stopProcess(web.child);
      web.closeLog();
    }
    await stopProcess(api.child);
    api.closeLog();
    fs.rmSync(sandbox.root, { recursive: true, force: true });
    if (previousPdfPrintUrl === undefined) delete process.env.PDF_PRINT_URL; else process.env.PDF_PRINT_URL = previousPdfPrintUrl;
    if (previousExecutablePath === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH; else process.env.PUPPETEER_EXECUTABLE_PATH = previousExecutablePath;
    if (previousPdfTimeout === undefined) delete process.env.PDF_RENDER_TIMEOUT_MS; else process.env.PDF_RENDER_TIMEOUT_MS = previousPdfTimeout;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
