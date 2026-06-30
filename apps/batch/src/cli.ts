#!/usr/bin/env node
import 'dotenv/config';
import { runGenerate } from './runGenerate';
import type { ReportType } from './types/dataset';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args['start-date'] || args.startDate;
  const endDate = args['end-date'] || args.endDate;
  const reportType = (args['report-type'] || args.reportType || 'full') as ReportType;

  if (!startDate || !endDate) {
    console.error('Usage: npm run generate -- --start-date YYYY-MM-DD --end-date YYYY-MM-DD [--report-type full|executive|testers|cycles]');
    process.exit(1);
  }

  const result = await runGenerate({
    startDate,
    endDate,
    reportType,
    search: args.search,
    result: (args.result as 'all') || 'all',
    project: args.project,
  });

  if (!result.ok && !result.payload) {
    console.error('Generate failed:', result.error);
    process.exit(1);
  }

  console.log('Generate complete');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
