#!/usr/bin/env bash
# Запуск игры на свежем раннере: зависимости -> (сборка) -> HTTP-сервер на ${PORT:-3000}.
# Сервер работает в foreground (для tmux/systemd). Туннель настраивается отдельно в workflow.
set -euo pipefail

PORT="${PORT:-3000}"

step() {
  local name="$1"; shift
  local start end code
  start=$(date +%s)
  echo "[startup] >>> ${name}"
  set +e
  "$@"
  code=$?
  set -e
  end=$(date +%s)
  echo "[startup] <<< ${name} (exit=${code}, ${end}s elapsed: $((end - start))s)"
  return $code
}

step "cd to project root" cd "$(dirname "${BASH_SOURCE[0]}")"
echo "[startup] dir=$(pwd) port=${PORT}"

# --- Зависимости (идемпотентно: повторные запуски переиспользуют node_modules) ---
if [ -f package.json ]; then
  if [ -d node_modules ]; then
    step "reuse node_modules" echo "node_modules exists, skipping install"
  elif [ -f package-lock.json ]; then
    step "npm ci" npm ci --no-audit --no-fund
  else
    step "npm install" npm install --no-audit --no-fund
  fi
  # --- Сборка, если предусмотрена ---
  if node -e "process.exit(require('./package.json').scripts && require('./package.json').scripts.build ? 0 : 1)" 2>/dev/null; then
    step "npm run build" npm run build
  else
    step "skip build" echo "no build script, skipping"
  fi
else
  step "skip install" echo "no package.json (static game, vendored three.js), nothing to install"
fi

# --- Entrypoint: dist/index.html приоритетнее, иначе ./index.html ---
SERVE_DIR="."
if [ -f "dist/index.html" ]; then
  SERVE_DIR="dist"
elif [ ! -f "index.html" ]; then
  echo "[startup] ERROR: neither ./dist/index.html nor ./index.html exists" >&2
  exit 1
fi
step "verify entrypoint" test -f "${SERVE_DIR}/index.html"
echo "[startup] serving '${SERVE_DIR}/index.html' on port ${PORT}"

# --- HTTP-сервер в foreground ---
if command -v python3 >/dev/null 2>&1; then
  step "start server (python3 http.server, foreground)" \
    python3 -m http.server "${PORT}" --directory "${SERVE_DIR}"
else
  echo "[startup] ERROR: python3 not found, cannot serve static files" >&2
  exit 1
fi
