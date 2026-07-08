#!/usr/bin/env node
/**
 * live-check-v2.mjs — QMetry live probe for Emirates/on-prem QTM4J UI APIs.
 *
 * Reads config/runtime.json and config/integrations.json by default.
 * Env vars still override config for one-off checks:
 *   QA_BASE_URL       e.g. https://jiraagile.example.com
 *   QA_AUTH_BASIC     e.g. Basic <base64> OR only <base64>
 *   QA_PROJECT_ID     e.g. 19703
 *
 * Optional env:
 *   QA_PROJECT_KEY    e.g. DLM
 *   QA_FOLDER_ID      e.g. 96225
 *   QA_COOKIE         full Cookie header value if your server requires browser session cookies
 *   QA_PROXY_URL      e.g. http://zscaler.example.com:10068
 *   QA_VERBOSE        true to print response previews for successful calls
 *
 * Run:
 *   node scripts/live-check-v2.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent, ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function configFile(name) {
  return path.join(process.env.CONFIG_DIR || path.join(ROOT, 'config'), name);
}

const runtime = readJson(process.env.RUNTIME_CONFIG_PATH || configFile('runtime.json'));
const integrations = readJson(configFile('integrations.json'));
const runtimeNetwork = runtime.network || {};
const runtimeJira = runtime.jira || {};
const runtimeQmetry = runtime.qmetry || {};
const integrationQmetry = integrations.qmetry || {};
const integrationJira = integrations.jira || {};

function clean(value) { return String(value || '').trim(); }
function first(...values) { return values.map(clean).find(Boolean) || ''; }
function truthy(value) { return ['1', 'true', 'yes', 'y', 'on'].includes(clean(value).toLowerCase()); }
function folderIdFromQmetryBody(body) { const filter = body?.filter || {}; return clean(filter.folderId || filter.filter?.folderId); }

const BASE = first(process.env.QA_BASE_URL, integrationQmetry.baseUrl, integrationJira.baseUrl).replace(/\/+$/, '');
const AUTH = first(process.env.QA_AUTH_BASIC, runtimeQmetry.basicAuth, runtimeJira.onPremSecret, runtimeJira.apiToken);
const COOKIE = first(process.env.QA_COOKIE, runtimeJira.sessionHeader);
const PROJECT_KEY = first(process.env.QA_PROJECT_KEY, integrationQmetry.projectKey, integrationJira.projectKeys?.[0], 'DLM');
const PID = first(process.env.QA_PROJECT_ID, integrationQmetry.projectId, '19703');
const FOLDER_ID = first(process.env.QA_FOLDER_ID, folderIdFromQmetryBody(integrationQmetry.testCyclesSearchBody), '96225');
const PROXY = first(process.env.QA_PROXY_URL, runtimeNetwork.officeProxyUrl, runtimeNetwork.httpsProxy, runtimeNetwork.httpProxy, process.env.HTTPS_PROXY, process.env.HTTP_PROXY);
const ALLOW_SELF_SIGNED = truthy(process.env.QA_ALLOW_SELF_SIGNED)
  || truthy(runtimeNetwork.integrationAllowSelfSignedCerts)
  || truthy(runtimeNetwork.jiraAllowSelfSigned)
  || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
const QTM = `${BASE}/rest/qtm4j/ui/latest`;

if (!BASE || (!AUTH && !COOKIE)) {
  console.error('Set config/runtime.json + config/integrations.json values first, or provide QA_BASE_URL and QA_AUTH_BASIC or QA_COOKIE.');
  console.error(`resolved base=${BASE ? 'set' : 'empty'} auth=${AUTH ? 'set' : 'empty'} cookie=${COOKIE ? 'set' : 'empty'}`);
  process.exit(1);
}

const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
if (AUTH) headers.Authorization = /^Basic\s+/i.test(AUTH) ? AUTH : `Basic ${AUTH}`;
if (COOKIE) headers.Cookie = COOKIE.replace(/^Cookie:\s*/i, '');

const tlsOptions = ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : undefined;
const dispatcher = PROXY
  ? new ProxyAgent({ uri: PROXY, requestTls: tlsOptions, proxyTls: tlsOptions })
  : ALLOW_SELF_SIGNED
    ? new Agent({ connect: tlsOptions })
    : undefined;

function safeUrl(url) { return url.replace(BASE, '<BASE>'); }
function preview(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}...<truncated>` : text;
}
function nonJsonHint(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (/<html/i.test(compact) && /BIG-IP logout page|apm\.css|logout|login|Sign In|SSO/i.test(compact)) return 'HTML login/logout page returned — session cookie is expired or not accepted for API requests.';
  if (/<html/i.test(compact)) return 'HTML returned instead of JSON — likely SSO/login redirect.';
  return '';
}

async function call(method, url, body) {
  const startedAt = Date.now();
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), ...(dispatcher ? { dispatcher } : {}) };
  console.log(`\n--> ${method} ${safeUrl(url)}`);
  if (body !== undefined) console.log(`payload: ${preview(body, 800)}`);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    const hint = json ? '' : nonJsonHint(text);
    console.log(`<-- HTTP ${res.status} ${Date.now() - startedAt}ms${hint ? ` · ${hint}` : ''}`);
    if (!res.ok || hint || process.env.QA_VERBOSE === 'true') console.log(preview(json || text || '(empty)', 1500));
    return { status: res.status, ok: res.ok, json, text };
  } catch (e) {
    console.log(`<-- ERROR ${Date.now() - startedAt}ms ${String(e)}`);
    return { status: 0, ok: false, json: null, text: '', err: String(e) };
  }
}

function arrayFromResponse(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.values)) return json.values;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.testCycles)) return json.testCycles;
  if (Array.isArray(json?.testCases)) return json.testCases;
  if (Array.isArray(json?.folders)) return json.folders;
  if (Array.isArray(json?.rootFolders)) return json.rootFolders;
  if (Array.isArray(json?.children)) return json.children;
  if (Array.isArray(json?.data?.children)) return json.data.children;
  if (Array.isArray(json?.data?.folders)) return json.data.folders;
  return [];
}

const TEST_CASE_FIELDS = [
  'seqNo', 'key', 'versionNo', 'summary', 'priority', 'status', 'environment',
  'executionResult', 'executionAssignee', 'executedBy', 'build', 'updated',
  // Known invalid on Emirates/on-prem /ui/latest testcase search, retained here to prove the server warning:
  'executedOn', 'lastModified',
];

const SUPPORTED_TESTCASE_FIELDS = 'seqNo,key,versionNo,summary,priority,status,environment,executionResult,executionAssignee,executedBy,build,updated';
const INVALID_DATE_FIELDS = 'key,executionResult,executedOn,lastModified';
const TEST_CYCLE_FIELDS = 'key,summary,priority,status,assignee,reporter,testcaseExecutionProgress,plannedStartDate,plannedEndDate,updated,automationRule';

function rowResultName(row) {
  return (row?.executionResult && (row.executionResult.name || row.executionResult)) || '';
}

function isExecuted(row) {
  return /pass|fail|blocked|wip|work in progress/i.test(String(rowResultName(row)));
}

function dateFormatHint(value) {
  const s = String(value ?? '');
  if (typeof value === 'number' || /^\d{10,}$/.test(s)) return s.length >= 13 ? 'epoch-millis' : 'epoch-seconds';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'ISO';
  if (/^\d{1,2}\/[A-Za-z]{3}\/\d{2,4}/.test(s)) return 'dd/MMM/yyyy';
  if (value && typeof value === 'object') return 'object';
  return 'unknown';
}

async function runBaseProbe(projectPayload, folderPayload) {
  console.log('\n--- 1. requested folder-tree POST flow ---');
  const folderUrl = `${QTM}/projects/${encodeURIComponent(PID)}/testcycle-folders?sort=NAME:ASC`;
  const folderRes = await call('POST', folderUrl, folderPayload);
  const folderRows = arrayFromResponse(folderRes.json);
  console.log(`folder result: HTTP ${folderRes.status}, parsedRows=${folderRows.length}`);
  if (folderRows.length) console.log(`folder sample: ${preview(folderRows[0], 1000)}`);

  console.log('\n--- 2. test cycle search using projectId/folderId ---');
  const cycleSearchUrl = `${QTM}/testcycles/search?startAt=0&maxResults=100&fields=${encodeURIComponent(TEST_CYCLE_FIELDS)}`;
  const cycleRes = await call('POST', cycleSearchUrl, folderPayload);
  const cycles = arrayFromResponse(cycleRes.json);
  console.log(`cycle result: HTTP ${cycleRes.status}, parsedRows=${cycles.length}`);
  if (!cycles.length) {
    console.log('No cycle returned from folder-specific search. Retrying with only projectId.');
    const fallbackCycleRes = await call('POST', cycleSearchUrl, projectPayload);
    cycles.push(...arrayFromResponse(fallbackCycleRes.json));
    console.log(`fallback cycle result: HTTP ${fallbackCycleRes.status}, parsedRows=${cycles.length}`);
  }

  const cycle = cycles[0];
  const cid = cycle?.id || cycle?.key || cycle?.testCycleId || cycle?.cycleId;
  if (!cid) {
    console.log('\nCould not get a cycle id. Check auth, projectId, folderId, and QMetry response shape above.');
    return { folderRes, folderRows, cycles, cid: null };
  }
  console.log(`\nUsing cycle: ${cid}`);
  console.log(`cycle sample: ${preview(cycle, 1200)}`);

  const testCasePath = `${QTM}/testcycles/${encodeURIComponent(String(cid))}/testcases/search`;

  console.log('\n--- 3. field-by-field testcase validity with POST body {filter:{projectId}} ---');
  const valid = [];
  const invalid = [];
  const warned = [];
  for (const f of TEST_CASE_FIELDS) {
    const r = await call('POST', `${testCasePath}?startAt=0&maxResults=1&fields=${encodeURIComponent(f)}`, projectPayload);
    const warningMessages = r.json?.warningMessages || [];
    const ok = r.status === 200 && !warningMessages.length;
    if (ok) valid.push(f); else invalid.push(f);
    if (warningMessages.length) warned.push(`${f}: ${warningMessages.join('; ')}`);
    console.log(`field ${ok ? 'OK ' : 'BAD'} ${f} HTTP ${r.status}${warningMessages.length ? ` warning=${JSON.stringify(warningMessages)}` : ''}`);
  }

  console.log(`\nVALID fields: ${valid.join(',') || '(none)'}`);
  console.log(`INVALID/WARNED fields: ${invalid.join(',') || '(none)'}`);
  if (warned.length) console.log(`Warnings: ${warned.join(' | ')}`);

  console.log('\n--- 4. combined supported testcase fields ---');
  const combined = await call('POST', `${testCasePath}?startAt=0&maxResults=100&fields=${encodeURIComponent(SUPPORTED_TESTCASE_FIELDS)}`, projectPayload);
  const rows = arrayFromResponse(combined.json);
  console.log(`combined result: HTTP ${combined.status}, parsedRows=${rows.length}, warningMessages=${JSON.stringify(combined.json?.warningMessages || [])}`);
  if (rows.length) {
    const row = rows.find((x) => x.executionResult || x.updated || x.executedBy) || rows[0];
    console.log(`sample testcase row: ${preview(row, 2000)}`);
    console.log(`has updated=${Object.prototype.hasOwnProperty.call(row, 'updated')} executionResult=${Object.prototype.hasOwnProperty.call(row, 'executionResult')} executedBy=${Object.prototype.hasOwnProperty.call(row, 'executedBy')}`);
  }

  console.log('\n--- 5. no-fields testcase default response ---');
  const nf = await call('POST', `${testCasePath}?startAt=0&maxResults=100`, projectPayload);
  const nfRows = arrayFromResponse(nf.json);
  console.log(`no-fields result: HTTP ${nf.status}, parsedRows=${nfRows.length}`);
  if (nfRows.length) {
    console.log(`default row keys: ${Object.keys(nfRows[0]).join(', ')}`);
    console.log(`default sample: ${preview(nfRows[0], 2000)}`);
  }

  console.log('\n=== summary ===');
  console.log(`folder POST: HTTP ${folderRes.status}, rows=${folderRows.length}`);
  console.log(`cycles found: ${cycles.length}`);
  console.log(`valid testcase fields: ${valid.join(',') || '(none)'}`);

  return { folderRes, folderRows, cycles, cid, testCasePath };
}

async function v4ExecutionDateProbe(projectPayload, cid) {
  console.log('\n=== v4: execution-date field discovery ===');
  let cycleId = cid;
  if (!cycleId) {
    const cyc = await call('POST', `${QTM}/testcycles/search?startAt=0&maxResults=1`, projectPayload);
    cycleId = cyc?.json?.data?.[0]?.id;
  }
  if (!cycleId) { console.log('  no cycle id — cannot probe executions (check auth/network above)'); return; }
  console.log(`  using cycle: ${cycleId}`);
  const path = `${QTM}/testcycles/${encodeURIComponent(cycleId)}/testcases/search`;

  const bad = await call('POST', `${path}?startAt=0&maxResults=3&fields=${encodeURIComponent(INVALID_DATE_FIELDS)}`, projectPayload);
  console.log('  [invalid-field check] warningMessages:', JSON.stringify(bad?.json?.warningMessages || []));

  const good = await call('POST', `${path}?startAt=0&maxResults=50&fields=${encodeURIComponent(SUPPORTED_TESTCASE_FIELDS)}`, projectPayload);
  console.log('  [qmetry supported field list] warningMessages:', JSON.stringify(good?.json?.warningMessages || []));
  const rows = arrayFromResponse(good.json);
  console.log(`  rows returned: ${rows.length} of total ${good?.json?.total}`);

  const executed = rows.filter(isExecuted);
  console.log(`  executed (Pass/Fail/Blocked/WIP) rows in this page: ${executed.length}`);

  const sample = executed[0] || rows[0];
  if (sample) {
    const dateKeys = Object.keys(sample).filter((k) => /date|updat|execut|time|modif/i.test(k));
    console.log('  sample row key:', sample.key, '| result:', rowResultName(sample));
    console.log('  date-ish fields on sample:');
    for (const k of dateKeys) {
      const v = sample[k];
      console.log(`     ${k} = ${typeof v === 'object' ? JSON.stringify(v) : JSON.stringify(v)}  (type ${typeof v})`);
    }
    if (!('updated' in sample)) console.log('  !! "updated" NOT present on the row even though requested');
  }

  const updatedVals = executed.map((r) => r.updated).filter((v) => v != null);
  console.log(`  executed rows WITH a populated "updated": ${updatedVals.length}/${executed.length}`);
  updatedVals.slice(0, 3).forEach((v, i) => console.log(`     updated[${i}] raw = ${JSON.stringify(v)}  -> looks like: ${dateFormatHint(v)}`));

  console.log('\n  CONCLUSION: report code should request "updated" and must not request unsupported "executedOn" / "lastModified" fields on this QMetry UI endpoint.');
}

async function main() {
  console.log(`\n=== live-check v2 against ${BASE} ===`);
  console.log(`projectKey=${PROJECT_KEY} projectId=${PID} folderId=${FOLDER_ID} proxy=${PROXY ? 'yes' : 'no'} allowSelfSigned=${ALLOW_SELF_SIGNED ? 'yes' : 'no'}`);
  console.log(`auth=${AUTH ? 'set' : 'empty'} cookie=${COOKIE ? 'set' : 'empty'} runtime=${runtime && Object.keys(runtime).length ? 'loaded' : 'missing'} integrations=${integrations && Object.keys(integrations).length ? 'loaded' : 'missing'}`);

  const projectIdNumber = Number(PID);
  const folderPayload = { filter: { projectId: projectIdNumber, folderId: String(FOLDER_ID) } };
  const projectPayload = { filter: { projectId: projectIdNumber } };

  const result = await runBaseProbe(projectPayload, folderPayload);
  await v4ExecutionDateProbe(projectPayload, result.cid);

  console.log('\nPaste this output back. It should not contain secrets because request headers are not printed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
