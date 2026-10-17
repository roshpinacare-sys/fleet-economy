#!/usr/bin/env bun
/**
 * economy-beat-host.mjs — מארח-כאת-הלב של הכלכלה-הפנימית (גל-85 · agent-2 · 2026-10-17)
 *
 * רקע-מדוד: תהליכי-רקע שהסוכן משגר-ישירות מתים-תוך-~5 דק' (3 הוכחות).
 * היחידים-ששרדו: תהליכי-הבית (next-server + ילדיו). לכן המארח הזה נולד-כילד-של-next-server
 * (דרך src/instrumentation.ts), עם-watchdog בתוך-next-server שמקים-אותו-מחדש-אם-נהרג.
 *
 * ארכיטקטורה (הנחיית-בעלים): הסוכנים הם הלקוח והמשתמש של הכלכלה-הפנימית.
 * כל-מחזור = אותו-פרוטוקול-אמת של הענן (run-economy-beat.mjs):
 *   מנעול-כותב-יחיד → boot על הספר-הקנוני → זרימה (שכר/שירותים/AMM/מס — אפס-הדמיות)
 *   → שער-אמת (/verify + עוגנים=3) → איטום-חזרה-לגיט.
 * הענן יירש-בכנות דרך ה-heartbeat (TTL 30 דק') כשהסנדבוקס הזה ימות.
 */
import { spawn, execFileSync } from "child_process";
import fs from "fs";

const REPO = "/home/z/audit/fleet-economy";
const PAT_FILE = "/home/z/my-project/upload/pat.env";
const ORIGIN_HOST = "github.com/roshpinacare-sys/fleet-economy.git";
const PORT = 3020;
const WRITER = "economy-beat-host";
const BEAT_SECONDS = Number(process.env.BEAT_SECONDS ?? 75);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 45 * 60_000);
const HARD_TIMEOUT = 270;
const LOG_FILE = "/home/z/audit/economy-beat-host.log";
const STATUS_FILE = "/home/z/audit/economy-beat-service-status.json";
const HB_FILE = `${REPO}/state/writer-heartbeat.json`;

// גל-88 (agent-2 · 2026-10-17): self-provisioning-בזמן-ריצה.
// הוכח-חי היום 10:14: הסנדבוקס נמחק-חלקית-וקם — המיני-שירות הקים-את-הספר מהגיט באתחול,
// אבל למארח-הראשי לא היה יכולת כזו בזמן-ריצה (נשאר מת-עד אתחול-מלא אם הספר נמחק בעוד-המארח-חי).
// חוק: לפני-כל-beat — הספר-חייב-להיות-קיים ושלם; אם-חסר/שבור — משכפלים-מהגיט (PAT נקרא-בזמן-ריצה,
// לעולם-לא-בלוג). אין reset/fetch-כפה על ספר-קיים — רק הקמה-מחדש של עותק-שבור מהקנוני.
function ensureBook() {
  let ok = false;
  try {
    ok =
      fs.existsSync(`${REPO}/.git`) &&
      fs.existsSync(`${REPO}/run-economy-beat.mjs`) &&
      fs.existsSync(`${REPO}/state`);
  } catch {}
  if (ok) return true;
  log("ensure-book: ספר-חסר/שבור — self-provision מהגיט (gal-88)");
  try { fs.rmSync(REPO, { recursive: true, force: true }); } catch {}
  try {
    const pat = fs.readFileSync(PAT_FILE, "utf8").trim();
    execFileSync(
      "git",
      ["clone", "--depth", "1", `https://x-access-token:${pat}@${ORIGIN_HOST}`, REPO],
      { stdio: "ignore", timeout: 180_000 },
    );
    state.provisions = (state.provisions ?? 0) + 1;
    state.provisionedAt = new Date().toISOString();
    log("ensure-book: clone ok — הספר-הקנוני חי");
    saveStatus();
    return true;
  } catch (e) {
    log(`ensure-book: FAILED (${String(e?.message ?? e).slice(0, 140)})`);
    return false;
  }
}

// שימור-המשכיות על-פני הקמות-מחדש (watchdog): beatCount + מנוחת-nextRunAt לא-מתאפסים
// (גל-86-תיקון: בלי-זה הקמה-מחדש-בזמן-מנוחה הייתה-מזנקת-ל-beat-מיידי-ודורסת-את-קצב-ה-45-דק')
let __restored = null;
try { __restored = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch {}
const state = {
  startedAt: new Date().toISOString(),
  beatCount: Number(__restored?.beatCount ?? 0),
  running: false,
  lastRc: __restored?.lastRc ?? null,
  lastDurationSec: __restored?.lastDurationSec ?? null,
  lastSummary: Array.isArray(__restored?.lastSummary) ? __restored.lastSummary : [],
  nextRunAt:
    __restored?.nextRunAt && Date.now() < new Date(__restored.nextRunAt).getTime()
      ? __restored.nextRunAt
      : null,
};

const log = (s) => {
  const l = `[beat-host] ${new Date().toISOString()} ${s}`;
  try { fs.appendFileSync(LOG_FILE, l + "\n"); } catch {}
  console.log(l);
};
const saveStatus = () => { try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...state, writer: WRITER, port: PORT }, null, 2) + "\n"); } catch {} };

// פעימת-חיות ל-watchdog שב-next-server
setInterval(() => {
  try { fs.writeFileSync("/home/z/audit/economy-beat-host-heartbeat.json", JSON.stringify({ at: Date.now(), beatCount: state.beatCount, running: state.running }) + "\n"); } catch {}
}, 60_000);

const waitMsForLock = () => {
  try {
    const hb = JSON.parse(fs.readFileSync(HB_FILE, "utf8"));
    const age = Date.now() - (hb.at ?? 0);
    if (hb.writer && hb.writer !== WRITER && age < 30 * 60_000) {
      const ms = 30 * 60_000 - age + 60_000;
      log(`lock-respect: כותב ${hb.writer} חי-לכאורה (גיל ${Math.round(age / 1000)}ש') — ממתין ${Math.round(ms / 1000)}ש'`);
      return Math.min(ms, 25 * 60_000);
    }
  } catch {}
  return 0;
};

function parseSummary(out) {
  return out.split("\n").filter((l) =>
    /עסקאות אמת|VERIFY ok|עוגני-תפר=|מחיר=|FAIL|SKIP|איטום:|UP · seq/.test(l)
  ).slice(-8).map((l) => l.trim().slice(0, 180));
}

function runBeat() {
  // גל-86-תיקון: guard-שקט. הגרסה-הקודמת רשמה-לוג-בכל-קריאה — וה-scheduler (waitMs=0
  // כש-nextRunAt-כבר-עבר-אבל-ה-beat-עוד-רץ) יצר-לולאה-צמודה: 82,203 שורות-ספאם ב-84ש'
  // (≈980/שנייה, 4.6MB). ה-scheduler-מתוקן-מדלל-סקר-למינימום-15ש' — כך-שגם-הלוג-וגם-ה-cpu-נקיים.
  if (state.running) return;
  // כבוד-למנוחה: סקר-ה-15ש' לא-דורס את-מנוחת-ה-45-דק' שנקבעה-אחרי-מחזור
  if (state.nextRunAt && Date.now() < new Date(state.nextRunAt).getTime()) return;
  // גל-88: הספר חייב להיות קיים ושלם לפני כל-beat (הסנדבוקס רשאי להימחק בכל רגע).
  // כשל-provision לא נחשב-beat (beatCount לא זז) — ניסיון-חוזר בעוד 5 דק'.
  if (!ensureBook()) {
    state.lastRc = 125;
    state.lastSummary = ["ensure-book FAILED — אין-ספר-קנוני; ניסיון-חוזר בעוד 5 דק'"];
    state.nextRunAt = new Date(Date.now() + 5 * 60_000).toISOString();
    saveStatus();
    return;
  }
  state.running = true;
  saveStatus(); // נראה-מיד-להקמה-מחדש-שהיה-beat-בעיצומו (הגנה-כפולה-עם-מנעול-הכותב)
  const started = Date.now();
  log(`beat → #${state.beatCount + 1} (flow=${BEAT_SECONDS}s)`);
  const child = spawn(
    "bash",
    ["-c", `cd ${REPO} && ECONOMY_WRITER=${WRITER} BEAT_SECONDS=${BEAT_SECONDS} timeout --signal=KILL ${HARD_TIMEOUT} bun run-economy-beat.mjs`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (out.length > 100_000) out = out.slice(-60_000); });
  child.stderr.on("data", (d) => { out += d; if (out.length > 100_000) out = out.slice(-60_000); });
  child.on("close", (code) => {
    state.beatCount += 1;
    state.lastRc = code ?? 1;
    state.lastDurationSec = Math.round((Date.now() - started) / 1000);
    state.lastSummary = parseSummary(out);
    state.running = false;
    state.nextRunAt = new Date(Date.now() + INTERVAL_MS).toISOString();
    log(`beat ← #${state.beatCount} rc=${state.lastRc} dur=${state.lastDurationSec}s`);
    saveStatus();
  });
  child.on("error", (e) => { state.running = false; log(`beat-error: ${e.message}`); });
}

let __schedTimer = null;
function scheduler() {
  // גל-86-תיקון: מינימום-סקר-15ש' — אסור-שה-scheduler יסתובב-צמוד (היה-היפוך-לוגיקה:
  // בזמן-ריצה nextRunAt-הישן-כבר-עבר → waitMs=0 → ספין-מלא). כש-running, ה-guard-השקט
  // מחזיר-בלי-רעש עד-שה-close-מעדכן nextRunAt-החדש.
  // גל-88-תיקון: טריגר-ידני (/beat POST) מעיר את ה-scheduler מיד — קודם ה-POST רק עדכן
  // nextRunAt אך ה-timeout-הישן המשיך לישון עד-המועד-הקודם (נמדד 10:37Z: trigger→שתיקה).
  const waitMs = Math.max(
    waitMsForLock(),
    state.nextRunAt ? Math.max(0, new Date(state.nextRunAt).getTime() - Date.now()) : 15_000,
    15_000,
  );
  if (__schedTimer) clearTimeout(__schedTimer);
  __schedTimer = setTimeout(() => { __schedTimer = null; runBeat(); scheduler(); }, waitMs);
}
function wakeScheduler() {
  if (__schedTimer) { clearTimeout(__schedTimer); __schedTimer = null; }
  scheduler();
}

try {
  Bun.serve({
    port: PORT,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/health") return Response.json({ ok: true, service: "economy-beat-host", ...state });
      if (u.pathname === "/status") return Response.json({ ...state, writer: WRITER, port: PORT });
      if (u.pathname === "/beat" && req.method === "POST") {
        if (state.running) return Response.json({ ok: false, reason: "beat-already-running" }, { status: 409 });
        state.nextRunAt = new Date().toISOString();
        saveStatus(); // גל-88: הטריגר שורד הקמה-מחדש
        wakeScheduler(); // גל-88: הערה-מיידית — הטריגר בפועל ולא בעוד שעות
        return Response.json({ ok: true, triggered: true });
      }
      return new Response("economy-beat-host · /health /status /beat(POST)\n");
    },
  });
  log(`host-up · port=${PORT} · interval=${Math.round(INTERVAL_MS / 60000)}min · flow=${BEAT_SECONDS}s · repo=${REPO}`);
} catch (e) {
  log(`port-busy (${e.message}) — מארח-אחר חי; יוצא-בכבוד`);
  process.exit(0);
}
saveStatus();
scheduler();
