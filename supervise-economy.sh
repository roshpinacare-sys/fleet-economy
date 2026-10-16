#!/bin/bash
# supervise-economy.sh — משגיח-החייאה של הכלכלה-הפנימית (תורת fix-not-close):
# אם השירות נפל (OOM/קריסה) — מקים אותו תוך שניות, לנצח. אפס הדמיות: כל-החייאה נרשמת.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/state/supervisor.log"
while true; do
  if ! curl -s -m 3 http://127.0.0.1:3016/health > /dev/null 2>&1; then
    echo "$(date -u +%FT%TZ) DOWN — reviving fleet-economy" >> "$LOG"
    cd "$DIR"
    setsid nohup bun index.ts >> "$DIR/economy.log" 2>&1 < /dev/null &
    sleep 5
    if curl -s -m 3 http://127.0.0.1:3016/health > /dev/null 2>&1; then
      echo "$(date -u +%FT%TZ) REVIVED ok" >> "$LOG"
    else
      echo "$(date -u +%FT%TZ) REVIVE FAILED (will retry)" >> "$LOG"
    fi
  fi
  sleep 15
done
