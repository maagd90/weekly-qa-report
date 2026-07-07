#!/usr/bin/env bash
set -euo pipefail

fail() {
  local title="$1"
  local file="$2"
  local summary
  summary=$(tail -n 40 "$file" | tr '\n' ' ' | sed 's/%/%25/g; s/\r/%0D/g' | cut -c1-3500)
  echo "::error title=${title} failed::${summary}"
  exit 1
}

npm run build --workspace=apps/batch > /tmp/batch-build.log 2>&1 || fail "Batch build" /tmp/batch-build.log
npm run build --workspace=apps/api > /tmp/api-build.log 2>&1 || fail "API build" /tmp/api-build.log
npm run build --workspace=apps/web > /tmp/web-build.log 2>&1 || fail "Web build" /tmp/web-build.log
npm test > /tmp/regression-test.log 2>&1 || fail "Regression tests" /tmp/regression-test.log
