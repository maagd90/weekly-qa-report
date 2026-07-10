const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const resultsDir = path.join(repoRoot, 'test-results', 'quality');
fs.mkdirSync(resultsDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureSyntheticFixtures() {
  const fixture = path.join(repoRoot, 'fixtures', 'synthetic', 'wondermiles-qmetry-regression.xlsx');
  if (fs.existsSync(fixture)) return;
  const result = spawnSync('npm', ['run', 'fixtures:synthetic', '--workspace=apps/batch'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error('Could not generate synthetic fixtures');
}

function createSandbox(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `qa-dashboard-${name}-`));
  const dataRoot = path.join(root, 'data');
  const configDir = path.join(root, 'config');
  const inputDir = path.join(dataRoot, 'input');
  const outputDir = path.join(dataRoot, 'output');
  const projectDataDir = path.join(dataRoot, 'projects');
  for (const dir of [dataRoot, configDir, inputDir, outputDir, projectDataDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'runtime.json'), '{}\n');
  fs.writeFileSync(path.join(configDir, 'integrations.json'), JSON.stringify({
    jira: { enabled: false },
    jiraProfiles: [],
    qmetry: { enabled: false },
  }, null, 2));
  return { root, dataRoot, configDir, inputDir, outputDir, projectDataDir };
}

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnLogged(name, command, args, options = {}) {
  const logPath = path.join(resultsDir, `${name}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    shell: options.shell ?? (process.platform === 'win32'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('error', (error) => log.write(`\nPROCESS ERROR: ${error.stack || error.message}\n`));
  return { child, logPath, closeLog: () => log.end() };
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function stopProcess(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2_000).then(() => false),
  ]);
  if (exited === false && child.exitCode === null) child.kill('SIGKILL');
}

async function startApi(sandbox, requestedPort) {
  const port = requestedPort || await getFreePort();
  const processInfo = spawnLogged(`api-${port}`, process.execPath, [path.join(repoRoot, 'apps', 'api', 'dist', 'index.js')], {
    env: {
      PORT: String(port),
      PROJECT_ROOT: repoRoot,
      DATA_ROOT: sandbox.dataRoot,
      INPUT_DIR: sandbox.inputDir,
      OUTPUT_DIR: sandbox.outputDir,
      PROJECT_DATA_DIR: sandbox.projectDataDir,
      CONFIG_DIR: sandbox.configDir,
      CORS_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173',
      API_DEBUG: 'false',
      INTEGRATION_DEBUG: 'false',
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/health`);
  } catch (error) {
    await stopProcess(processInfo.child);
    processInfo.closeLog();
    throw new Error(`${error.message}. API log: ${processInfo.logPath}`);
  }
  return { ...processInfo, port, baseUrl };
}

async function startWeb(requestedPort = 4173) {
  const processInfo = spawnLogged(`web-${requestedPort}`, process.execPath, [
    path.join(repoRoot, 'apps', 'web', 'scripts', 'vite-dev.cjs'),
    '--host', '127.0.0.1', '--port', String(requestedPort),
  ]);
  const baseUrl = `http://127.0.0.1:${requestedPort}`;
  try {
    await waitForHttp(baseUrl, 45_000);
  } catch (error) {
    await stopProcess(processInfo.child);
    processInfo.closeLog();
    throw new Error(`${error.message}. Web log: ${processInfo.logPath}`);
  }
  return { ...processInfo, port: requestedPort, baseUrl };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const error = new Error(`${options.method || 'GET'} ${url} failed: HTTP ${response.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function uploadFile(apiBaseUrl, project, filePath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  return jsonFetch(`${apiBaseUrl}/api/upload?project=${encodeURIComponent(project)}`, { method: 'POST', body: form });
}

function fixturePath(name) {
  return path.join(repoRoot, 'fixtures', 'synthetic', name);
}

function copyFixture(name, targetDir, targetName = name) {
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, targetName);
  fs.copyFileSync(fixturePath(name), target);
  return target;
}

function connectionHeader(connections) {
  return { 'x-user-connections': JSON.stringify(connections) };
}

function startMockQmetryServer(requestedPort) {
  const requests = [];
  return new Promise(async (resolve, reject) => {
    const port = requestedPort || await getFreePort();
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie, body: bodyText });
      const send = (status, payload) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      };
      if (!String(req.headers.authorization || '').startsWith('Basic ')) return send(401, { error: 'missing basic auth' });
      const url = req.url || '';
      if (url.includes('/projects/19703/testcycle-folders')) {
        return send(200, { folders: [{ id: 'wm-folder-1', name: 'WonderMiles Regression', path: 'Regression / WonderMiles' }], total: 1 });
      }
      if (url.includes('/testcycles/search')) {
        return send(200, {
          data: [{
            id: 'wm-cycle-1',
            key: 'DTTRV-TR-1',
            summary: 'WonderMiles On-Prem QMetry Cycle',
            folderId: 'wm-folder-1',
            updated: '2026-07-05',
            plannedStartDate: '2026-07-01',
            plannedEndDate: '2026-07-31',
            testcaseExecutionProgress: [
              { name: 'PASS', count: 2 },
              { name: 'FAIL', count: 1 },
              { name: 'BLOCKED', count: 1 },
            ],
          }],
          total: 1,
        });
      }
      if (url.includes('/testcycles/wm-cycle-1/testcases/search')) {
        return send(200, {
          data: [
            { key: 'DTTRV-TC-101', cycleKey: 'DTTRV-TR-1', cycleSummary: 'WonderMiles On-Prem QMetry Cycle', executionResult: { name: 'PASS' }, executionAssignee: { displayName: 'WM Tester One' }, updated: '2026-07-05' },
            { key: 'DTTRV-TC-102', cycleKey: 'DTTRV-TR-1', cycleSummary: 'WonderMiles On-Prem QMetry Cycle', executionResult: { name: 'FAIL' }, executionAssignee: { displayName: 'WM Tester Two' }, updated: '2026-07-05' },
            { key: 'DTTRV-TC-103', cycleKey: 'DTTRV-TR-1', cycleSummary: 'WonderMiles On-Prem QMetry Cycle', executionResult: { name: 'BLOCKED' }, executionAssignee: { displayName: 'WM Tester One' }, updated: '2026-07-05' },
            { key: 'DTTRV-TC-104', cycleKey: 'DTTRV-TR-1', cycleSummary: 'WonderMiles On-Prem QMetry Cycle', executionResult: { name: 'PASS' }, executionAssignee: { displayName: 'WM Tester Two' }, updated: '2026-07-05' },
          ],
          total: 4,
        });
      }
      return send(404, { error: `unhandled mock QMetry path ${url}` });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function loadPuppeteer() {
  try { return require('puppeteer-core'); } catch (firstError) {
    try { return require(path.join(repoRoot, 'apps', 'api', 'node_modules', 'puppeteer-core')); } catch {
      throw new Error(`puppeteer-core is unavailable: ${firstError.message}`);
    }
  }
}

function writeResult(name, payload) {
  const filePath = path.join(resultsDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2));
  return filePath;
}

module.exports = {
  repoRoot,
  resultsDir,
  ensureSyntheticFixtures,
  createSandbox,
  getFreePort,
  startApi,
  startWeb,
  stopProcess,
  waitForHttp,
  jsonFetch,
  uploadFile,
  fixturePath,
  copyFixture,
  connectionHeader,
  startMockQmetryServer,
  findChrome,
  loadPuppeteer,
  writeResult,
};
