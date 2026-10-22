#!/usr/bin/env bun
/**
 * sovereign-builder/host.mjs — מארח-פעימות-הבנאי-הריבוני (גל-95 · agent-2 · בית-קנוני)
 * ═════════════════════════════════════════════════════════════════════════════════
 * הערה-היסטורית (גל-93): הנתיב-הישן /home/z/my-project/sovereign-builder-host.mjs
 * נעלם-בשחזור-קציר-3 — הרץ-החי-כעת-רק-תחת fleet-economy/bootstrap (בית-המארחים-הקנוני,
 * בדיוק-כמו-הלב: bootstrap/economy-beat-host.mjs).
 *
 * קצב: פעימת-בנאי-כל-30 דק' · ניסיון-חוזר-מהיר (5 דק') אחרי-כישלון.
 * יומן-חי: כל-פעימה-נרשמת-ל-builder-beat-host.log (איסור-כישלון-שקט).
 * דופק: builder-beat-heartbeat.json כל-30ש' — ה-watchdogs-של-המעגל-ההדדי-קוראים-אותו.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// גל-55 · שיעור-8b: כל-spawn = נתיב-מוחלט מאומת-קיום (PATH של-מארחים-חסרי-bun מת אחרי-מחזור-הפעלה)
const BUN = ["/usr/local/bin/bun", "/home/z/.bun/bin/bun", "/usr/bin/bun"].find((p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}) ?? "bun";

const BEAT = path.join(path.dirname(new URL(import.meta.url).pathname), "run-builder-beat.mjs");
const STATUS_FILE = "/home/z/audit/builder-beat-service-status.json";
const HB_FILE = "/home/z/audit/builder-beat-heartbeat.json";
const LOG_FILE = "/home/z/audit/builder-beat-host.log";
const CADENCE_MIN = 30;
const RETRY_MIN = 5;
const HARD_TIMEOUT = 20 * 60; // 20 דק' — פעימת-בנאי-לא-יכולה-לרוץ-לנצח

const state = {
  startedAt: new Date().toISOString(),
  beatCount: 0,
  running: false,
  lastRc: 0,
  lastDurationSec: 0,
  lastSummary: [],
  nextRunAt: new Date(Date.now() + 60_000).toISOString(),
  writer: "sovereign-builder-host",
  port: 3021,
};

function persist() {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2)); } catch {}
}
function heartbeat() {
  try { fs.writeFileSync(HB_FILE, JSON.stringify({ at: Date.now() })); } catch {}
}
function log(msg) {
  const line = `[builder-host] ${new Date().toISOString()} ${msg}`;
  try { console.log(line); } catch {}
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

async function runBeat() {
  if (state.running) return;
  state.running = true;
  persist();
  const t0 = Date.now();
  await new Promise((resolve) => {
    // גל-93: bun (הרץ-הקנוני) + יומן-פעימה-חי במקום stdio עיוור — כישלון-שקט לא-חוקי-עוד
    const out = fs.openSync(LOG_FILE, "a");
    const stamp = `[builder-beat] ${new Date().toISOString()} פעימה-מתחילה\n`;
    try { fs.writeSync(out, stamp); } catch {}
    const child = spawn(BUN, [BEAT], { stdio: ["ignore", out, out] });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, HARD_TIMEOUT * 1000);
    child.on("exit", (code) => { clearTimeout(killer); try { fs.closeSync(out); } catch {} state.lastRc = code ?? 1; resolve(); });
    child.on("error", (e) => { clearTimeout(killer); try { fs.writeSync(out, `[builder-beat] spawn-שגיאה: ${String(e?.message ?? e)}\n`); fs.closeSync(out); } catch {} state.lastRc = 1; resolve(); });
  });
  state.running = false;
  state.lastDurationSec = Math.round((Date.now() - t0) / 1000);
  state.beatCount += 1;
  const rcNote = state.lastRc === 0 ? "ok" : `rc=${state.lastRc}`;
  state.lastSummary = [`בנאי-beat #${state.beatCount} · ${rcNote} · ${state.lastDurationSec}ש'`];
  // ניסיון-חוזר-מהיר אחרי-כישלון — הבנאי-לא-נרתע
  state.nextRunAt = new Date(Date.now() + (state.lastRc === 0 ? CADENCE_MIN : RETRY_MIN) * 60_000).toISOString();
  persist();
  log(`פעימה-${state.beatCount} הסתיימה ${rcNote} ב-${state.lastDurationSec}ש' · הבאה-${state.nextRunAt}`);
}

function msUntil(iso) {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}

log(`מארח-הבנאי-עולה (גל-95, בית-קנוני bootstrap) · beat=${BEAT}`);
persist();
heartbeat();
const hbTimer = setInterval(heartbeat, 30_000);
hbTimer.unref?.();

async function loop() {
  for (;;) {
    const wait = msUntil(state.nextRunAt);
    await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
    if (msUntil(state.nextRunAt) > 1_000) continue;
    try { await runBeat(); } catch (e) { log(`שגיאת-לולאה: ${String(e?.message ?? e).slice(-200)}`); state.lastRc = 1; state.nextRunAt = new Date(Date.now() + RETRY_MIN * 60_000).toISOString(); persist(); }
  }
}
loop();
