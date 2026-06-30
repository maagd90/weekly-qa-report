#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

START_DATE="${START_DATE:-}"
END_DATE="${END_DATE:-}"
REPORT_TYPE="${REPORT_TYPE:-full}"

if [[ $# -ge 2 ]]; then
  START_DATE="$1"
  END_DATE="$2"
  REPORT_TYPE="${3:-full}"
fi

if [[ -z "$START_DATE" ]]; then
  read -rp "Start date (YYYY-MM-DD): " START_DATE
fi
if [[ -z "$END_DATE" ]]; then
  read -rp "End date (YYYY-MM-DD): " END_DATE
fi

echo "==> Generating report $START_DATE → $END_DATE ($REPORT_TYPE)"
npm run generate -- --start-date "$START_DATE" --end-date "$END_DATE" --report-type "$REPORT_TYPE"
