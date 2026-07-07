#!/usr/bin/env node
/**
 * live-check-v2.mjs — QMetry live probe for Emirates/on-prem QTM4J UI APIs.
 *
 * Required env:
 *   QA_BASE_URL       e.g. https://jiraagile.example.com
 *   QA_AUTH_BASIC     e.g. Basic <base64> OR only <base64>
 *   QA_PROJECT_ID     e.g. 19703
 *
 * Optional env:
 *   QA_PROJECT_KEY    e.g. DLM
 *   QA_FOLDER_ID      e.g. 96225
 *   QA_COOKIE         full Cookie header value if your server requires browser session cookies
 *   QA_PROXY_URL      e.g. http://zscaler.example.com:10068
 *
 * Run:
 *   node scripts/live-check-v2.mjs
 */
import { ProxyAgent } from 'undici';

const BASE = (process.env.QA_BASE_URL || '').replace(/\/+$/, '');
const AUTH = (process.env.QA_AUTH_BASIC || '').trim();
const COOKIE = process.env.QA_COOKIE || '';
const PROJECT_KEY = process.env.QA_PROJECT_KEY || 'DLM';
const PID = process.env.QA_PROJECT_ID || '19703';
const FOLDER_ID = process.env.QA_FOLDER_ID || '96225';
const PROXY = (process.env.QA_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim();
const QTM = `${BASE}/rest/qtm4j/ui/latest`;

if (!BASE || (!AUTH && !COOKIE)) {
  console.error('Set QA_BASE_URL and QA_AUTH_BASIC or QA_COOKIE first.');
  process.exit(1);
}

const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
if (AUTH) headers.Authorization = /^Basic\s+/i.test(AUTH) ? AUTH : `Basic ${AUTH}`;
if (COOKIE) headers.Cookie = COOKIE.replace(/^Cookie:\s*/i, '');

const dispatcher = PROXY ? new ProxyAgent(PROXY) : undefined;

function safeUrl(url) {
  return url.replace(BASE, '<BASE>');
}

function preview(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}...<truncated>` : text;
}

async function call(method, url, body) {
  const startedAt = Date.now();
  const init = {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {}),
  };

  console.log(`\n--> ${method} ${safeUrl(url)}`);
  if (body !== undefined) console.log(`payload: ${preview(body, 800)}`);

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    console.log(`<-- HTTP ${res.status} ${Date.now() - startedAt}ms`);
    if (!res.ok || process.env.QA_VERBOSE === 'true') console.log(preview(json || text || '(empty)', 1500));
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
  'executionResult', 'executionAssignee', 'executedOn', 'executedBy', 'lastModified', 'build',
];

const TEST_CYCLE_FIELDS = 'key,summary,priority,status,assignee,reporter,testcaseExecutionProgress,plannedStartDate,plannedEndDate,updated,automationRule';

async function main() {
  console.log(`\n=== live-check v2 against ${BASE} ===`);
  console.log(`projectKey=${PROJECT_KEY} projectId=${PID} folderId=${FOLDER_ID} proxy=${PROXY ? 'yes' : 'no'}`);

  const projectIdNumber = Number(PID);
  const folderPayload = { filter: { projectId: projectIdNumber, folderId: String(FOLDER_ID) } };
  const projectPayload = { filter: { projectId: projectIdNumber } };

  console.log('\n--- 1. requested folder-tree POST flow ---');
  const folderUrl = `${QTM}/projects/${encodeURIComponent(PID)}/testcycle-folders?sort=NAME:ASC`;
  const folderRes = await call('POST', folderUrl, folderPayload);
  const folderRows = arrayFromResponse(folderRes.json);
  console.log(`folder result: HTTP ${folderRes.status}, parsedRows=${folderRows.length}`);
  if (folderRows.length) console.log(`folder sample: ${preview(folderRows[0], 1000)}`);

  console.log('\n--- 2. test cycle search using projectId/folderId ---');
  const cycleSearchUrl = `${QTM}/testcycles/search?startAt=0&maxResults=5&fields=${encodeURIComponent(TEST_CYCLE_FIELDS)}`;
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
    return;
  }

  console.log(`\nUsing cycle: ${cid}`);
  console.log(`cycle sample: ${preview(cycle, 1200)}`);

  const testCasePath = `${QTM}/testcycles/${encodeURIComponent(String(cid))}/testcases/search`;

  console.log('\n--- 3. field-by-field testcase validity with POST body {filter:{projectId}} ---');
  const valid = [];
  const invalid = [];
  for (const f of TEST_CASE_FIELDS) {
    const r = await call('POST', `${testCasePath}?startAt=0&maxResults=1&fields=${encodeURIComponent(f)}`, projectPayload);
    const ok = r.status === 200;
    (ok ? valid : invalid).push(f);
    console.log(`field ${ok ? 'OK ' : 'BAD'} ${f} HTTP ${r.status}`);
  }

  console.log(`\nVALID fields: ${valid.join(',') || '(none)'}`);
  console.log(`INVALID fields: ${invalid.join(',') || '(none)'}`);

  console.log('\n--- 4. combined valid testcase fields ---');
  if (valid.length) {
    const combined = await call('POST', `${testCasePath}?startAt=0&maxResults=5&fields=${encodeURIComponent(valid.join(','))}`, projectPayload);
    const rows = arrayFromResponse(combined.json);
    console.log(`combined result: HTTP ${combined.status}, parsedRows=${rows.length}`);
    if (rows.length) {
      const row = rows.find((x) => x.executionResult || x.executedOn || x.executedBy) || rows[0];
      console.log(`sample testcase row: ${preview(row, 2000)}`);
      console.log(`has executedOn=${Object.prototype.hasOwnProperty.call(row, 'executedOn')} executionResult=${Object.prototype.hasOwnProperty.call(row, 'executionResult')} executedBy=${Object.prototype.hasOwnProperty.call(row, 'executedBy')}`);
    }
  }

  console.log('\n--- 5. no-fields testcase default response ---');
  const nf = await call('POST', `${testCasePath}?startAt=0&maxResults=5`, projectPayload);
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
  console.log('\nPaste this output back. It should not contain secrets because request headers are not printed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
