const fs = require('fs');
const path = require('path');

const GENERATED_DEV_CACHE_FILES = Object.freeze([
  'raw-dataset.live.json',
  'raw-dataset.json',
  'dataset-fingerprint.txt',
  'dashboard-data.json',
  'report.md',
  'report-meta.json',
]);

function envFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function clearGeneratedDevCache(outputDir, options = {}) {
  const preserve = options.preserve === true;
  const deleted = [];
  const missing = [];

  if (preserve) {
    return { preserved: true, deleted, missing, files: [...GENERATED_DEV_CACHE_FILES] };
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const filename of GENERATED_DEV_CACHE_FILES) {
    const target = path.join(outputDir, filename);
    if (!fs.existsSync(target)) {
      missing.push(filename);
      continue;
    }
    fs.rmSync(target, { force: true });
    deleted.push(filename);
  }

  return { preserved: false, deleted, missing, files: [...GENERATED_DEV_CACHE_FILES] };
}

module.exports = {
  GENERATED_DEV_CACHE_FILES,
  clearGeneratedDevCache,
  envFlag,
};
