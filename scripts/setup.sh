#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Creating data directories"
mkdir -p input output config

if [[ ! -f config/runtime.json ]]; then
  cp config/runtime.example.json config/runtime.json
  echo "==> Created config/runtime.json from example — edit it only if server-side runtime defaults are needed"
else
  echo "==> config/runtime.json already exists"
fi

if [[ ! -f config/integrations.json ]]; then
  cp config/integrations.example.json config/integrations.json
  echo "==> Created config/integrations.json from example"
else
  echo "==> config/integrations.json already exists"
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing npm dependencies"
  npm install
else
  echo "==> node_modules present — run 'npm install' manually if packages changed"
fi

echo ""
echo "Setup complete."
echo "  Local dev:  ./run.sh dev"
echo "  Docker:     ./run.sh docker"
