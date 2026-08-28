#!/usr/bin/env bash
# Master Beater launcher for macOS / Linux.
# Installs dependencies if needed, starts the server, opens your browser.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8461}"

# Stop any old instance still holding the port.
if command -v lsof >/dev/null 2>&1; then
  OLD_PID="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$OLD_PID" ]; then
    echo "Stopping old instance on port $PORT (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting Master Beater on http://localhost:$PORT ..."
PORT="$PORT" node server.js &
SERVER_PID=$!

# Once the port answers, open the browser.
(
  for _ in $(seq 1 20); do
    if command -v curl >/dev/null 2>&1 && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT"
  fi
) &

wait "$SERVER_PID"
