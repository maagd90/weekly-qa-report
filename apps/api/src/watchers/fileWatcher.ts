import chokidar from 'chokidar';
import path from 'path';
import { importExcel } from '../importers/excelImporter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastImportResult: any = null;

export function getLastImportResult() {
  return lastImportResult;
}

export function startWatcher(filePath: string) {
  const resolved = path.resolve(filePath);
  console.log(`[watcher] Watching Excel file: ${resolved}`);

  // Run initial import
  runImport(resolved);

  const watcher = chokidar.watch(resolved, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  });

  watcher.on('change', () => {
    console.log(`[watcher] File changed, re-importing...`);
    runImport(resolved);
  });

  watcher.on('error', (err) => {
    console.error(`[watcher] Error: ${err}`);
  });
}

export function runImport(filePath: string) {
  try {
    const result = importExcel(filePath);
    lastImportResult = result;
    console.log(`[import] Done — added: ${result.rowsAdded}, updated: ${result.rowsUpdated}, skipped: ${result.rowsSkipped}, errors: ${result.errors.length}`);
  } catch (e) {
    console.error('[import] Failed:', e);
    lastImportResult = { error: (e as Error).message, importedAt: new Date().toISOString() };
  }
}
