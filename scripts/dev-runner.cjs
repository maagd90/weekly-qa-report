#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { clearGeneratedDevCache, envFlag } = require('./dev-cache.cjs');
const { spawnNpm } = require('./npm-spawn.cjs');

const ROOT = path.resolve(__dirname, '..');
const runtimePath = path.join(ROOT, 'config', 'runtime.json');

function readRuntimeConfig() {
  if (!fs.existsSync(runtimePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  } catch (error) {
    console.warn(`[dev-runner] Could not parse ${runtimePath}: ${error.message}`);
    return {};
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isContainerPath(value) {
  const normalized = clean(value).replace(/\\/g, '/');
  return normalized === '/data'
    || normalized.startsWith('/data/')
    || normalized === '/app'
    || normalized.startsWith('/app/');
}

function resolveLocalPath(value, fallback) {
  const selected = clean(value);
  if (!selected || isContainerPath(selected)) return fallback;
  return path.isAbsolute(selected) ? path.normalize(selected) : path.resolve(ROOT, selected);
}

function firstValue(...values) {
  return values.map(clean).find(Boolean) || '';
}

function findLocalBrowser(configuredPath) {
  const configured = clean(configuredPath);
  if (configured && !isContainerPath(configured) && fs.existsSync(configured)) return configured;

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function localPdfUrl(value) {
  const selected = clean(value);
  if (!selected || selected.includes('dashboard-web')) return 'http://localhost:3000/print/report';
  return selected;
}

function describeOverride(name, configured, resolved) {
  const raw = clean(configured);
  if (raw && raw !== resolved) console.log(`[dev-runner] ${name}: ${raw} -> ${resolved}`);
  else console.log(`[dev-runner] ${name}: ${resolved}`);
}

const runtime = readRuntimeConfig();
const runtimePaths = runtime.paths || {};
const env = { ...process.env };

const inputConfigured = firstValue(process.env.INPUT_DIR, runtimePaths.inputDir);
const outputConfigured = firstValue(process.env.OUTPUT_DIR, runtimePaths.outputDir);
const configConfigured = firstValue(process.env.CONFIG_DIR, runtimePaths.configDir);
const browserConfigured = firstValue(process.env.PUPPETEER_EXECUTABLE_PATH, runtimePaths.puppeteerExecutablePath);
const pdfConfigured = firstValue(process.env.PDF_PRINT_URL, runtimePaths.pdfPrintUrl);

const inputDir = resolveLocalPath(inputConfigured, path.join(ROOT, 'input'));
const outputDir = resolveLocalPath(outputConfigured, path.join(ROOT, 'output'));
const configDir = resolveLocalPath(configConfigured, path.join(ROOT, 'config'));
const browserPath = findLocalBrowser(browserConfigured);
const pdfPrintUrl = localPdfUrl(pdfConfigured);

fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });

const preserveDevCache = envFlag(process.env.PRESERVE_DEV_CACHE);
const cacheResult = clearGeneratedDevCache(outputDir, { preserve: preserveDevCache });
if (cacheResult.preserved) {
  console.log('[dev-runner] Generated dashboard/report cache preserved because PRESERVE_DEV_CACHE is enabled.');
} else if (cacheResult.deleted.length) {
  console.log(`[dev-runner] Cleared generated dashboard/report cache: ${cacheResult.deleted.join(', ')}`);
} else {
  console.log('[dev-runner] Generated dashboard/report cache already clean.');
}

env.NODE_ENV = env.NODE_ENV || 'development';
env.PROJECT_ROOT = ROOT;
env.INPUT_DIR = inputDir;
env.OUTPUT_DIR = outputDir;
env.CONFIG_DIR = configDir;
env.PDF_PRINT_URL = pdfPrintUrl;
if (browserPath) env.PUPPETEER_EXECUTABLE_PATH = browserPath;
else delete env.PUPPETEER_EXECUTABLE_PATH;

describeOverride('INPUT_DIR', inputConfigured, inputDir);
describeOverride('OUTPUT_DIR', outputConfigured, outputDir);
describeOverride('CONFIG_DIR', configConfigured, configDir);
describeOverride('PDF_PRINT_URL', pdfConfigured, pdfPrintUrl);
if (browserPath) describeOverride('PUPPETEER_EXECUTABLE_PATH', browserConfigured, browserPath);
else if (browserConfigured) console.warn(`[dev-runner] PUPPETEER_EXECUTABLE_PATH ignored because it does not exist locally: ${browserConfigured}`);

const child = spawnNpm(['run', 'dev:servers'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error(`[dev-runner] Failed to start npm: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code === null ? 1 : code;
});
