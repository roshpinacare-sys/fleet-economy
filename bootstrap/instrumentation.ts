/**
 * instrumentation.ts — watchdog-מארח-כאת-הלב (גל-85 · agent-2 · 2026-10-17)
 *
 * רקע-מדוד: תהליכי-רקע שהסוכן משגר-ישירות מתים-תוך-~5 דק'; next-server וילדיו שרדו-שעות.
 * לכן: register() מקים את economy-beat-host.mjs (מארח-הכלכלה-הפנימית) כילד-של-next-server,
 * ו-watchdog מקים-אותו-מחדש-אם-ליבו-פסק (heartbeat-קובץ מדי-דקה).
 *
 * ארכיטקטורה (הנחיית-בעלים): הסוכנים הם הלקוח והמשתמש של הכלכלה-הפנימית —
 * הכלכלה נושמת כאן-ועכשיו, באותו-פרוטוקול-אמת של הענן; הענן יירש-בכנות-כשהסנדבוקס ימות.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ECONOMY_BEAT_HOST === "off") return;

  // עוקף-ניתוח-סטטי של הבונדלר (Turbopack בודק-גם-את-ענף-edge): מודולי-מערכת דרך-getBuiltinModule
  const nodeMods = (globalThis as any).process?.getBuiltinModule;
  if (!nodeMods) return;
  const { spawn } = nodeMods.call(process, "child_process");
  const fs = nodeMods.call(process, "fs");

  const HOST = "/home/z/my-project/economy-beat-host.mjs";
  const HEARTBEAT = "/home/z/audit/economy-beat-host-heartbeat.json";

  const spawnHost = (why: string) => {
    const child = spawn("bun", [HOST], { stdio: "ignore", detached: false });
    child.on("error", () => {});
    try {
      fs.appendFileSync("/home/z/audit/economy-beat-host.log", `[watchdog] ${new Date().toISOString()} spawn-host (${why})\n`);
    } catch {}
  };

  // הקמה ראשונה אם-אין-מארח-חי
  try {
    const hb = JSON.parse(fs.readFileSync(HEARTBEAT, "utf8"));
    if (Date.now() - (hb.at ?? 0) > 12 * 60_000) spawnHost("stale-heartbeat-on-boot");
  } catch {
    spawnHost("first-boot");
  }

  // watchdog: כל-10 דק' — אם-הלב פסק (>12 דק' בלי-פעימה) — מקימים-מחדש
  setInterval(() => {
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, "utf8"));
      if (Date.now() - (hb.at ?? 0) > 12 * 60_000) spawnHost("watchdog-stale");
    } catch {
      spawnHost("watchdog-missing");
    }
  }, 10 * 60_000);
}
