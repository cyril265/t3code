#!/usr/bin/env bash
# Usage: self-build-boot-check.sh <log-file>
# Starts the server from source on a throwaway home and fails unless it finishes starting.
set -uo pipefail

log="$1"
home="$(mktemp -d)"
port=38917
node apps/server/src/bin.ts serve --host 127.0.0.1 --port "$port" --no-browser --base-dir "$home" > "$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -rf "$home"' EXIT

# Until every handler is installed the server answers 503; this route answers 200 only after that.
for _ in $(seq 1 120); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "The server exited before it finished starting." >> "$log"
    exit 1
  fi
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$port/api/auth/session")" == 200 ]]; then
    exit 0
  fi
  sleep 0.5
done
echo "The server did not finish starting within 60 seconds." >> "$log"
exit 1
