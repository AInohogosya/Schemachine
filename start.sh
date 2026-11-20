#!/usr/bin/env bash
# SCHEMACHINE one-command launcher (macOS / Linux).
# Checks node+npm, installs deps, builds, serves on http://localhost:3000
# and opens the default browser.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "SCHEMACHINE: '$1' is required but was not found on PATH."
    echo "Please install Node.js v18+ (https://nodejs.org) and re-run ./start.sh"
    exit 1
  fi
}
need node
need npm

echo "SCHEMACHINE: node $(node --version), npm $(npm --version)"

if [ ! -d node_modules ]; then
  echo "SCHEMACHINE: installing dependencies (first run)…"
  npm install --no-audit --no-fund
fi

NEED_BUILD=0
if [ ! -f dist/index.html ]; then
  NEED_BUILD=1
else
  if [ -n "$(find src index.html package.json vite.config.ts -newer dist/index.html 2>/dev/null | head -n 1)" ]; then
    NEED_BUILD=1
  fi
fi
if [ "$NEED_BUILD" = "1" ]; then
  echo "SCHEMACHINE: building production bundle…"
  npm run build
else
  echo "SCHEMACHINE: build is up to date, skipping (delete ./dist to force a rebuild)."
fi

echo "SCHEMACHINE: starting server at ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 1.5 && open "${URL}") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 1.5 && xdg-open "${URL}") &
fi

PORT="${PORT}" exec npm run serve
