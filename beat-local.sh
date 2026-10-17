#!/usr/bin/env bash
# beat-local.sh — דמון-כאת-לב של הכלכלה-הפנימית (גל-85 · agent-2 · 2026-10-17)
#
# הרעיון-הארכיטקטוני (הנחיית-בעלים): הסוכנים הם הלקוח והמשתמש של הכלכלה.
# הכלכלה-הפנימית חייבת להוכיח ערך-עצמי — נושמת עכשיו, לא תלויה בשער-ענן.
#
# אותו-פרוטוקול-אמת כמו הענן (run-economy-beat.mjs):
#   מנעול-כותב-יחיד (state/writer-heartbeat.json, TTL 30 דק') → pull מהספר-הקנוני
#   → boot (restored=true) → זרימה BEAT_SECONDS (שכר/שירותים/AMM/מס — אפס-הדמיות)
#   → שער-אמת (/verify ok + עוגנים=3 בדיוק) → איטום-חזרה-לגיט.
# אם-כותב-אחר-חי (ענן שנפתח / סוכן אחר) — ה-beat מדלג-בכנות. כותב-אחד, אמת-אחת.
#
# שימוש:
#   BEAT_SECONDS=120 SLEEP_BETWEEN=1800 LOG_FILE=/path/log nohup bash beat-local.sh &

set -u
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"

export BEAT_SECONDS="${BEAT_SECONDS:-120}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-1800}"
export ECONOMY_WRITER="${ECONOMY_WRITER:-sandbox-economy-beat-agent2}"
LOG_FILE="${LOG_FILE:-/home/z/audit/economy-beat-daemon.log}"

log() { echo "[beat-local] $(date -u +%FT%TZ) $*" >> "$LOG_FILE"; }
log "daemon-start · writer=$ECONOMY_WRITER · flow=${BEAT_SECONDS}s · rest=${SLEEP_BETWEEN}s · pid=$$"

while true; do
  # מאמצים-את-הספר-הקנוני-העדכני (מישהו-אחר עלול-להיות איטם-אחרון)
  if ! git -c rebase.autoStash=true pull --rebase -q origin main >> "$LOG_FILE" 2>&1; then
    log "WARN pull-failed — מדלג-מחזור בכנות (הספר-המרוחק לא-מתקבל)"
    sleep 60
    continue
  fi
  log "beat →"
  bun run-economy-beat.mjs >> "$LOG_FILE" 2>&1
  log "beat ← rc=$?"
  sleep "$SLEEP_BETWEEN"
done
