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
# קשיחות-סנדבוקס: timeout-קשה לכל-beat · היגיינת-פורט 3016 · לוג-חיות.
#
# שימוש (מנותק-מלא):
#   BEAT_SECONDS=120 SLEEP_BETWEEN=1800 LOG_FILE=... \
#     setsid nohup bash beat-local.sh >/dev/null 2>&1 < /dev/null &

set -u
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"

export BEAT_SECONDS="${BEAT_SECONDS:-120}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-1800}"
BEAT_HARD_TIMEOUT="${BEAT_HARD_TIMEOUT:-900}"
export ECONOMY_WRITER="${ECONOMY_WRITER:-sandbox-economy-beat-agent2}"
LOG_FILE="${LOG_FILE:-/home/z/audit/economy-beat-daemon.log}"
PORT=3016

log() { echo "[beat-local] $(date -u +%FT%TZ) $*" >> "$LOG_FILE"; }

# היגיינת-פורט: מי-שמחזיק את 3016 מהסנדבוקס שלנו — חייב-למות לפני-boot
free_port() {
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p {print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      if grep -q "fleet-economy" "/proc/$pid/cwd" 2>/dev/null || readlink "/proc/$pid/cwd" 2>/dev/null | grep -q "fleet-economy"; then
        log "port-hygiene: killing stale engine pid=$pid on ${PORT}"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
  fi
}

log "daemon-start · writer=$ECONOMY_WRITER · flow=${BEAT_SECONDS}s · rest=${SLEEP_BETWEEN}s · hard-timeout=${BEAT_HARD_TIMEOUT}s · pid=$$"

while true; do
  log "alive"   # פעימת-חיות — לאבחון-קוטלי-רקע
  free_port

  # מאמצים-את-הספר-הקנוני-העדכני (מישהו-אחר עלול-להיות איטם-אחרון)
  if ! git -c rebase.autoStash=true pull --rebase -q origin main >> "$LOG_FILE" 2>&1; then
    log "WARN pull-failed — מדלג-מחזור בכנות (הספר-המרוחק לא-מתקבל)"
    sleep 60
    continue
  fi
  log "beat →"
  timeout --signal=KILL "$BEAT_HARD_TIMEOUT" bun run-economy-beat.mjs >> "$LOG_FILE" 2>&1
  rc=$?
  [ $rc -eq 137 ] && log "WARN beat KILLED by hard-timeout (${BEAT_HARD_TIMEOUT}s) — ממשיכים"
  log "beat ← rc=$rc"
  sleep "$SLEEP_BETWEEN"
done
