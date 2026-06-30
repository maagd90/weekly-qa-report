#!/usr/bin/env bash
# DLM QA Dashboard — project runner
# Usage:
#   ./run.sh              # show help
#   ./run.sh setup        # first-time setup (dirs, .env, npm install)
#   ./run.sh dev          # local dev (API :3001 + UI :5173)
#   ./run.sh build        # production build
#   ./run.sh test         # parser regression tests
#   ./run.sh generate     # CLI report generation
#   ./run.sh docker       # build & start Docker (UI :3000, API :3001)
#   ./run.sh docker down  # stop Docker containers
#   ./run.sh docker logs  # follow container logs

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}==>${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
err()   { echo -e "${RED}error:${NC} $*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "'$1' is required but not installed."
    exit 1
  fi
}

cmd_setup() {
  bash "$ROOT/scripts/setup.sh"
}

cmd_dev() {
  require_cmd node
  require_cmd npm
  [[ -d node_modules ]] || cmd_setup
  info "Starting dev servers (API http://localhost:3001, UI http://localhost:5173)"
  npm run dev
}

cmd_build() {
  require_cmd node
  require_cmd npm
  info "Building all workspaces"
  npm run build
  ok "Build complete"
}

cmd_test() {
  require_cmd node
  require_cmd npm
  npm test
}

cmd_generate() {
  require_cmd node
  require_cmd npm
  shift || true
  bash "$ROOT/scripts/generate-report.sh" "$@"
}

cmd_docker() {
  require_cmd docker
  sub="${1:-up}"
  shift || true

  case "$sub" in
    up|start)
      [[ -f .env ]] || cmd_setup
      mkdir -p input output config
      [[ -f config/integrations.json ]] || cp config/integrations.example.json config/integrations.json
      info "Building and starting Docker containers"
      docker compose up --build -d
      echo ""
      ok "Dashboard running:"
      echo "  UI:  http://localhost:3000"
      echo "  API: http://localhost:3001/health"
      echo ""
      echo "Stage Excel files in ./input/ or configure ./config/integrations.json"
      echo "Then open the UI → AI Report → Generate Report"
      ;;
    down|stop)
      info "Stopping Docker containers"
      docker compose down
      ok "Stopped"
      ;;
    logs)
      docker compose logs -f "$@"
      ;;
    restart)
      docker compose down
      cmd_docker up
      ;;
    build)
      docker compose build "$@"
      ok "Docker images built"
      ;;
    *)
      err "Unknown docker subcommand: $sub (use: up, down, logs, restart, build)"
      exit 1
      ;;
  esac
}

show_help() {
  cat <<'EOF'
DLM QA Dashboard

Usage: ./run.sh <command>

Commands:
  setup       First-time setup (.env, config, npm install)
  dev         Run locally (API :3001, Vite UI :5173)
  build       Production build (batch + api + web)
  test        Run parser regression tests
  generate    Generate dashboard + report from CLI
              ./run.sh generate 2026-06-24 2026-06-30 full

Docker:
  docker          Build and start containers (UI :3000, API :3001)
  docker down     Stop containers
  docker logs     Follow logs
  docker restart  Rebuild and restart
  docker build    Build images only

Quick start (local):
  ./run.sh setup
  cp fixtures/input/*.xlsx input/    # optional sample data
  ./run.sh dev
  open http://localhost:5173

Quick start (Docker):
  ./run.sh setup
  cp fixtures/input/*.xlsx input/    # optional sample data
  ./run.sh docker
  open http://localhost:3000

Environment (.env):
  ANTHROPIC_API_KEY   Optional — needed for AI reports
  JIRA_EMAIL          Optional — live JIRA fetch
  JIRA_API_TOKEN      Optional — live JIRA/QMetry fetch
EOF
}

main() {
  cmd="${1:-help}"
  shift || true

  case "$cmd" in
    help|-h|--help) show_help ;;
    setup)          cmd_setup ;;
    dev)            cmd_dev ;;
    build)          cmd_build ;;
    test)           cmd_test ;;
    generate)       cmd_generate "$@" ;;
    docker)         cmd_docker "$@" ;;
    *)
      err "Unknown command: $cmd"
      echo ""
      show_help
      exit 1
      ;;
  esac
}

main "$@"
