#!/usr/bin/env bun
/* ═══ fuel-stream-once.ts — CLI --once: מחזור-טפטוף-אחד במגרש-חול ═══
 * ===========================================================================
 * G77-b · הוכחת-הייצור-הכנה: מריץ את המנוע-האמיתי (bun index.ts) על ספר-סינתטי
 * טרי במדינת-חול מבודדת (FLEET_STATE_DIR/FLEET_PORT — אפס-נגיעה בספר-החי ובמנעול-
 * הכותב שלו), מבצע מחזור-טפטוף אחד (POST /fuel/once), ואז מחזור-שני-על-אותו-מחזור
 * כדי-להוכיח-אידמפוטנטיות (ריצה-חוזרת ⇒ applied=0 · dedup=N), ומדפיס JSON כנה.
 *
 * אפס-הדמיות: המנוע-עצמו זורע ספר-ג'נזיס אמת (seed), כל-טפטוף עסקת-שרשרת
 * חתומה, הקבלות נכתבות ל-state/audit/ledger-cycle[-<N>].json במדינת-החול.
 *
 * שימוש:
 *   bun scripts/fuel-stream-once.ts [--cycle 32] [--port 30166] [--state <dir>] [--keep]
 * יציאה: 0 = תקין (כולל חסימה-כנה) · 1 = כישלון-אמת. */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const argOf = (name: string, dflt: string | null): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const hasFlag = (name: string) => args.includes(name);

const PORT = Number(argOf("--port", "30166"));
const CYCLE = Number(argOf("--cycle", "0")); // 0 = אוטומטי (ברירת-המחדל 32 = חוב-החידוש)
const STATE = path.resolve(argOf("--state", path.join("/home/z/coord-work/tmp/G77b", `fuel-once-${Date.now()}`, "state"))!);
const KEEP = hasFlag("--keep");

const j = async (p: string, opts?: RequestInit): Promise<any> => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, opts);
  return await r.json();
};

const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));

async function main(): Promise<number> {
  // 1) מדינת-חול מבודדת — הספר-החי-ומנעול-הכותב-שלו לא נוגעים
  fs.mkdirSync(STATE, { recursive: true });
  const rosterSrc = path.join(ROOT, "state", "grid-roster.json");
  if (fs.existsSync(rosterSrc)) fs.copyFileSync(rosterSrc, path.join(STATE, "grid-roster.json"));

  // 2) המנוע-האמיתי על הספר-הסינתטי (ג'נזיס אמת מ-seed)
  const child = spawn("bun", ["index.ts"], {
    cwd: ROOT,
    env: { ...process.env, FLEET_STATE_DIR: STATE, FLEET_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let engineLog = "";
  child.stdout.on("data", (d) => (engineLog += d));
  child.stderr.on("data", (d) => (engineLog += d));
  let health: any = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { health = await j("/health"); if (health?.ok) break; } catch { /* עוד-רגע */ }
  }
  if (!health?.ok) {
    out({ ok: false, error: "engine-not-up", engineLog: engineLog.slice(-800) });
    try { child.kill("SIGKILL"); } catch {}
    return 1;
  }
  try {
    // 3) מחזור-טפטוף ראשון — הביצוע האמיתי
    const r1 = await j("/fuel/once", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycle: CYCLE }) });
    // 4) מחזור-שני על אותו-מחזור — הוכחת-האידמפוטנטיות (ריצה-חוזרת לא מכפילה):
    //    או-דחיסת-אותם-refs (applied=0 · dedup=N) או-נקודת-שבת (all-above-floor ·
    //    אפס-טפטופים) — בשני-המקרים הסך-ששולם-בספר לא זז (אפס-תשלום-כפול).
    const r2 = await j("/fuel/once", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycle: CYCLE }) });
    const paid1 = (await j("/metrics"))?.fuel?.paidUsds;
    const r3 = await j("/fuel/once", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycle: CYCLE }) });
    const paid2 = (await j("/metrics"))?.fuel?.paidUsds;
    // 5) קבלות-המדידה
    const cycle = await j("/cycle");
    const verify = await j("/verify");
    const metrics = await j("/metrics");
    const snapPath = r1?.snapshot?.paths?.[0] ?? null;
    const snapFull = snapPath ? path.join(STATE, snapPath) : null;
    const snapExists = snapFull ? fs.existsSync(snapFull) : false;
    const fixedPoint = (r2?.plan?.reason === "all-above-floor" && (r2?.plan?.drips?.length ?? 0) === 0) || (r2?.applied ?? 0) === 0;
    const idempotent = fixedPoint && paid1 === paid2 && (r3?.applied ?? 0) === 0;
    const result = {
      ok: verify?.ok === true && idempotent && snapExists,
      engine: { seq: health.seq, port: PORT, state: STATE },
      firstCall: { applied: r1?.applied, deduped: r1?.deduped, planId: r1?.plan?.planId, reason: r1?.plan?.reason, totalUsds: r1?.plan?.totalUsds ?? null, drips: r1?.plan?.drips?.length, blocked: r1?.plan?.blocked?.length, snapshot: r1?.snapshot },
      idempotencyProof: { fixedPoint, repeatCallsPaidUsds: [paid1, paid2], secondApplied: r2?.applied, secondReason: r2?.plan?.reason, thirdApplied: r3?.applied, idempotent },
      receipts: { snapshotExists: snapExists, snapshotPath: snapFull, cycle: cycle?.cycle, saos0004Registered: cycle?.roster?.saos0004Registered, gridRoster: cycle?.roster?.grid?.map((g: any) => g.id) },
      book: { verifyOk: verify?.ok, checked: verify?.checked, headHash: verify?.headHash, fuelPaidUsds: metrics?.fuel?.paidUsds, treasuryUsds: cycle?.treasury?.usds },
    };
    out(result);
    return result.ok ? 0 : 1;
  } finally {
    try { child.kill("SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 1200));
    try { child.kill("SIGKILL"); } catch {}
    if (!KEEP) { try { fs.rmSync(path.dirname(STATE), { recursive: true, force: true }); } catch { /* כנה */ } }
  }
}

process.exit(await main());
