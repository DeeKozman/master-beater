#!/usr/bin/env bash
# Stop a running Master Beater (macOS / Linux).
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8461}"

if command -v lsof >/dev/null 2>&1; then
  PID="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$PID" ]; then
    echo "Stopping Master Beater on port $PORT (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    echo "Done."
  else
    echo "Nothing listening on port $PORT."
  fi
else
  if pkill -f "node .*server\.js" 2>/dev/null; then
    echo "Stopped."
  else
    echo "Nothing to stop."
  fi
fi
