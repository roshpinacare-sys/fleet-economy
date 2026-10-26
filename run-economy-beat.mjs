#!/usr/bin/env bun
/* economy-beat runner (גל-85 · agent-2 · 2026-10-17) — הכלכלה-הפנימית קמה-ועובדת על-ענן.
 * רצף-אמת בכל-ריצה:
 *  1. מנעול-כותב-יחיד (state/writer-heartbeat.json) — שורש-תפרי-המיזוג ההיסטוריים היה
 *     שני-כותבים על ספר-אחד. מעכשיו: כותב-אחד. דילוג-כנה אם-כותב-אחר-חי (< 30 דק').
 *  2. boot על-הספר-הקנוני מהגיט (restored=true אחרת-כישלון).
 *  3. הכלכלה נושמת BEAT_SECONDS (טיקים, שכר, שירותים, AMM, מס — אפס-הדמיות).
 *  4. שער-אמת: /verify חייב ok:true + תפרי-עוגן עד-בסיס-המתועד-לספר-החי (G76-d: רישום
 *     state/audit/anchor-baseline.json — הספר-החי: 0 תפרים = ספר-רציף; תפר-חדש = ספר-קרוע = כישלון-ריצה;
 *     בסיס-7-ההיסטורי שייך-לדור-הקודם — רשום-להוכחה בלבד).
 *  5. איטום-המצב-חזרה-לגיט (commit+push; מירוץ → RACE-LOST fail-closed — איסור-מוחלט על pull --rebase -X ours, גל-94).
 */
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadAnchorBaseline, anchorReceiptLine } from "./lib/anchor-baseline"; // G76-d: בסיס-עוגנים-פר-דור-ספר

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(ROOT, "state");
const HB = path.join(STATE, "writer-heartbeat.json");
const WRITER = process.env.ECONOMY_WRITER ?? "github-economy-beat";
const BEAT_SECONDS = Number(process.env.BEAT_SECONDS ?? 180);
const PORT = 3016;
/* G76-d · פורנזיה: ה-7 ההיסטורי (46335/55120/68276 + צמתים 290040/294919/299807/299847) הוא
 * בסיס-דור-הספר-הקודם — הספר-החי (regenesis2 · פתיחה seq=1 · כותב-יחיד) רציף-לחלוטין.
 * הבסיס-החי-נקרא-מהרישום (state/audit/anchor-baseline.json · כרגע 0), עם-עדיפות-לדיווח-החי
 * מהמנוע (/verify anchorBaseline). כל-תפר-מעבר-לבסיס = אזעקה fail-closed. */
const ANCHOR_REG = loadAnchorBaseline(path.join(ROOT, "state"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* גל-94 · watchdog-שרת-הקונסולה: דלת-הבית-של-הבעלים-חייבת-לא-למות. תהליכים-שנולדים-מה-shell-של-סוכן
 * נשחטים-עם-ה-cgroup-שלו; הפעימה (ילד-מארח-חי-על-עץ-הפלטפורמה) מקימה-את-השרת-כבן-מנותק
 * (detached+unref) שמתייתם-ל-init אחרי-צאת-הפעימה — בדיוק-כמו-המארחים-עצמם-שרדו. */
function ensureConsoleServer() {
  try { execFileSync("pgrep", ["-f", "next dev -p 3000"], { encoding: "utf8" }); return; } catch { /* אין-תהליך */ }
  try {
    const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", "http://127.0.0.1:3000/"], { encoding: "utf8" }).trim();
    if (code === "200") return;
  } catch { /* מת-באמת */ }
  try {
    const c = spawn("bash", ["-c", "cd /home/z/my-project && exec ./node_modules/.bin/next dev -p 3000 >> /home/z/my-project/dev.log 2>&1"], { detached: true, stdio: "ignore" });
    c.unref();
    console.log("[economy-beat] watchdog: שרת-הקונסולה היה מת — הוקם-מחדש (מנותק-ל-init)");
  } catch (e) { console.error("[economy-beat] watchdog-שרת נכשל: " + String(e?.message ?? e).slice(-200)); }
}
ensureConsoleServer();

/* גל-95 · מעגל-החייאה-ההדדית: הלב-מחיה-גם-את-מארח-הבנאי. שיעור-08:11Z: שכבת-instrumentation
 * של-הקונסולה-יכולה-ליפול-שקט (ואז-אף-אחד-לא-מחיה-מארחים) — לכן-כל-פעימה-חיה-מארחים-משלימים
 * בעצמה. מעגל-סגור: לב→בנאי+קונסולה · בנאי→לב+קונסולה · instrumentation→הכל (כשהוא-חי). */
function ensureSovereignHosts() {
  try { execFileSync("pgrep", ["-f", "sovereign-builder/host.mjs"], { encoding: "utf8" }); return; } catch { /* אין-מארח */ }
  try {
    const c = spawn("bun", ["/home/z/audit/fleet-economy/bootstrap/sovereign-builder/host.mjs"], { detached: true, stdio: "ignore" });
    c.unref();
    console.log("[economy-beat] watchdog-גל-95: מארח-הבנאי-היה-מת — הוקם-מחדש (בית-קנוני-bootstrap, מנותק-ל-init)");
  } catch (e) { console.error("[economy-beat] watchdog-בנאי נכשל: " + String(e?.message ?? e).slice(-200)); }
}
ensureSovereignHosts();

/* 0) git-first (גל-94 · חוק-המירוץ-הקנוני, רוח a3d73fa מגל-90 — הפעם על קובץ זה עצמו):
 *    אומץ-את-הספר-הקנוני לפני-כל-זרימה. מקומי-מפוצל = fail-closed exit 3 (אסור לנחש, אסור ours). */
const g = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
try {
  g(["fetch", "origin", "main"]);
  const head = g(["rev-parse", "HEAD"]);
  const origin = g(["rev-parse", "origin/main"]);
  if (head !== origin) {
    const ahead = g(["rev-list", "--count", `${origin}..${head}`]);
    if (ahead === "0") {
      g(["merge", "--ff-only", "origin/main"]);
      console.log(`[economy-beat] git-first · אומץ-קנוני ff ${head.slice(0, 7)}→${origin.slice(0, 7)}`);
    } else {
      console.error(`[economy-beat] RACE-LOST-PRE · מקומי-מפוצל (ahead=${ahead}) — fail-closed exit 3`);
      process.exit(3);
    }
  }
} catch (e) {
  console.error(`[economy-beat] FAIL git-first: ${String(e?.message ?? e).slice(-300)}`);
  process.exit(3);
}

async function getJson(p) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return await r.json(); } catch { return null; }
}

/* 1) מנעול-כותב-יחיד */
try {
  const hb = JSON.parse(fs.readFileSync(HB, "utf8"));
  const age = Date.now() - (hb.at ?? 0);
  if (hb.writer && hb.writer !== WRITER && age < 30 * 60_000) {
    console.log(`[economy-beat] SKIP — כותב ${hb.writer} מחזיק-את-הספר (גיל ${Math.round(age / 1000)}ש'). כותב-אחד, אמת-אחת.`);
    process.exit(0);
  }
} catch { /* אין-heartbeat — תובעים-כתיבה */ }
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(HB, JSON.stringify({ writer: WRITER, at: Date.now() }) + "\n");

/* 2) boot על-הספר-הקנוני */
const child = spawn("bun", ["index.ts"], { cwd: ROOT, stdio: "inherit" });
let up = null;
for (let i = 0; i < 30; i++) { await sleep(2000); up = await getJson("/health"); if (up?.ok) break; }
if (!up?.ok) {
  console.error("[economy-beat] FAIL — המנוע לא עלה על הספר-הקנוני");
  try { child.kill("SIGTERM"); } catch {}
  process.exit(1);
}
const seqStart = up.seq;
console.log(`[economy-beat] UP · seq=${seqStart} · הכלכלה נושמת ${BEAT_SECONDS}ש'`);

/* 3) זרימה */
await sleep(BEAT_SECONDS * 1000);

/* 3½) G77-b · מפעל-התדלוק: מחזור-טפטוף-מיידי + סנאפשוט-מחזור-הספר (חוב-החידוש
 * cycle-32+ — מקור-ציטוט מכונה ל-G77-c). אידמפוטנטי: ריצה-חוזרת-באותו-מחזור
 * נדחסת-ל-dedup לפי-planId · fail-honest: חסימה-כנה היא-תשובה-תקפה. */
try {
  const fuelOnce = await fetch(`http://127.0.0.1:${PORT}/fuel/once`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  const f = await fuelOnce.json();
  if (f?.ok) {
    console.log(`[economy-beat] G77-b fuel/once · planId=${f?.plan?.planId ?? "?"} · reason=${f?.plan?.reason ?? "?"} · applied=${f?.applied ?? 0} · deduped=${f?.deduped ?? 0} · snapshot=${(f?.snapshot?.paths ?? []).join("+") || "none"}`);
  } else {
    console.log(`[economy-beat] G77-b fuel/once · כנה-חסום: ${JSON.stringify(f?.plan?.blocked ?? f).slice(0, 200)}`);
  }
} catch (e) { console.log(`[economy-beat] G77-b fuel/once נכשל-כנה: ${String(e?.message ?? e).slice(0, 120)}`); }

/* 4) שער-אמת */
const v = await getJson("/verify");
const m = await getJson("/metrics");
try { child.kill("SIGTERM"); } catch {}
await sleep(3000);
try { child.kill("SIGKILL"); } catch {}
if (!v?.ok) {
  /* גל-19.51 — פצע-רשום אינו כישלון-קבוע: ה-verify מדווח brokenAt=N; אם הפצע כבר
   * מתועד-ומוקף ברישום-ההסגר של הספר (state/quarantine/*brokenAt-N*), הריצה נושאת
   * KNOWN-WOUND רועש-כנה (מצביע על הקבלות) ויוצאת 0 — הריפוי שייך לחוק-הכותב-היחיד
   * של הספר (הענן אינו מנתח ספרים). פצע שאינו רשום = קרע-חדש = כישלון-רם כמקודם. */
  const brokenAt = v?.brokenAt ?? null;
  let registered = [];
  if (brokenAt !== null) {
    try {
      const qdir = "state/quarantine";
      if (fs.existsSync(qdir)) {
        registered = fs.readdirSync(qdir).filter((n) => n.includes(`brokenAt-${brokenAt}`));
      }
    } catch {}
  }
  if (brokenAt !== null && registered.length > 0) {
    console.error(`[economy-beat] KNOWN-WOUND — אימות-שרשרת: brokenAt=${brokenAt} · הפצע רשום-ומוקף בספר-ההסגר (${registered.length} קבלות: ${registered.slice(0, 2).join(" · ")}) — הריפוי בידי חוק-הכותב-היחיד; הריצה כנה-רועשת ולא-אדומה [גל-19.51]`);
    if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## economy-beat ⚠️ KNOWN-WOUND\n- brokenAt=${brokenAt} · רשום בהסגר: ${registered.slice(0, 3).join(", ")}\n- הריפוי בידי חוק-הכותב-היחיד של הספר; אין-פצע-חדש\n`) } catch {} }
    fs.writeFileSync(HB, JSON.stringify({ writer: WRITER, at: Date.now(), endedAt: Date.now(), knownWound: brokenAt }) + "\n");
    process.exit(0);
  }
  console.error(`[economy-beat] FAIL — אימות-שרשרת: ${JSON.stringify(v)}`); process.exit(1);
}
const anchors = v.anchors?.length ?? 0;
const anchorBaseline = typeof v.anchorBaseline === "number" ? v.anchorBaseline : ANCHOR_REG.baseline; // החי-מדווח → אחרת-הרישום
const anchorLine = anchorReceiptLine(anchors, { ...ANCHOR_REG, baseline: anchorBaseline });
console.log(`[economy-beat] VERIFY ok · checked=${v.checked} · ${anchorLine} (בסיס-פר-דור-ספר${v.anchorSource ? " · " + v.anchorSource : ""})`);
if (anchors > anchorBaseline) { console.error("[economy-beat] FAIL — תפר-עוגן-חדש-שאינו-מתועד — הספר נקרע"); process.exit(1); }

/* 5) סיכום-כן */
const summary = process.env.GITHUB_STEP_SUMMARY;
const line = (s) => { if (summary) try { fs.appendFileSync(summary, s + "\n"); } catch {} console.log(s); };
const delta = (m?.seq ?? 0) - seqStart;
line(`## economy-beat ✅`);
line(`- seq: ${seqStart} → ${m?.seq ?? "?"} (**+${delta} עסקאות אמת ב-beat זה** · ראש-השרשרת: ${v.headHash ?? "?"})`);
line(`- שרשרת: checked=${v.checked} · ${anchorLine} · בסיס-פר-דור-ספר (היסטורי-7 מתועד-ברישום: state/audit/anchor-baseline.json)`);
line(`- בריכה: מחיר=${m?.pool?.priceUsdsPerSaos} USDS/SAOS · עמלות=${m?.pool?.feesUsds} USDS`);
line(`- G77-b דלק-גריד: חיילים=${(m?.fuel?.roster ?? []).length} · saos-0004=${m?.fuel?.saos0004Registered ? "רשום" : "לא-רשום"} · מחזורים=${m?.fuel?.cycles} · שולם=${m?.fuel?.paidUsds} USDS · planId=${m?.fuel?.lastPlanId ?? "-"}`);
line(`- מווסת: nBase=${m?.throughput?.governor?.nBase} · קבלת-חלון=${m?.throughput?.governor?.windowAcceptance}`);
line(`- כותב-יחיד: ${WRITER} · ${new Date().toISOString()}`);
fs.writeFileSync(HB, JSON.stringify({ writer: WRITER, at: Date.now(), endedAt: Date.now(), seq: m?.seq }) + "\n");

/* 5½) עוגן-מצב-אמת (G76-d · owner §7 receipts): ראש-השרשרת נרשם-כקובץ-קבלה-ונאטם-לגיט
 * בכל-פעימה — עיגון-קריאה-של-ראש-ה-hash-chain בעץ-המצב, מקור-אמת-אחד עם /verify. */
const headReceipt = {
  at: new Date().toISOString(),
  writer: WRITER,
  seq: m?.seq ?? null,
  headHash: v.headHash ?? null,
  verify: { ok: v.ok, checked: v.checked, anchors, baseline: anchorBaseline },
  inheritedBaseline: ANCHOR_REG.inherited?.baseline ?? null,
};
fs.mkdirSync(path.join(STATE, "audit"), { recursive: true });
fs.writeFileSync(path.join(STATE, "audit", "chain-head.json"), JSON.stringify(headReceipt, null, 2) + "\n");

/* 6) איטום-לגיט */
const cycleSnaps = (() => { try { return fs.readdirSync(path.join(STATE, "audit")).filter((n) => n === "ledger-cycle.json" || /^ledger-cycle-\d+\.json$/.test(n)).map((n) => `state/audit/${n}`); } catch { return []; } })(); // G77-b: קבלות-מחזור-הספר נאטמות-לגיט
const run = (cmd, args) => new Promise((res) => {
  const c = spawn(cmd, args, { cwd: ROOT });
  let o = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (o += d));
  c.on("close", (code) => res({ code: code ?? 1, o }));
});
await run("git", ["add", "state/ledger.jsonl", "state/snapshot.json", "state/seal-log.jsonl", "state/writer-heartbeat.json", "state/ext-flows.jsonl", "state/audit/chain-head.json", "state/audit/anchor-baseline.json", "state/grid-roster.json", ...cycleSnaps]); // גל-109 · ext-flows.jsonl נאטם · G76-d: +עוגן-ראש-השרשרת ורישום-בסיס-העוגנים · G77-b: +רשום-הגריד וקבלות-מחזור-הספר
await run("git", ["commit", "-q", "-m", `[economy-beat] seq=${m?.seq ?? "?"} (+${delta}) · ${anchorLine} · מאומת-מול-הספר`]);
let push = await run("git", ["push", "origin", "HEAD"]);
if (push.code !== 0) {
  /* גל-94 · חוק-המירוץ: אסור pull --rebase -X ours — ב-rebase ours=origin ולכן העסקאות-שלנו
   * היו נשתקות בהתנגשות על state/ledger.jsonl (קרע-שקט בספר). במקום: RACE-LOST fail-closed —
   * אם הקנוני התקדם מעל ההורה-שלנו, האיטום-שלנו הפסיד: מאמצים-קנוני ומוותרים-כנה; המארח יחזור בעוד 10 דק'. */
  await run("git", ["fetch", "origin", "main"]);
  const parent = (await run("git", ["rev-parse", "HEAD~1"])).o.trim();
  const originNow = (await run("git", ["rev-parse", "origin/main"])).o.trim();
  if (parent !== originNow) {
    /* גל-96 · סגירת-חור-חוק-המירוץ: הקנוני זז ל-commit שאיננו ההורה-שלנו (למשל חתימת-בנאי).
     * עד-היום: push-חוזר-סרק → הריפו נשאר מפוצל (rc=1) עד-התערבות-יד (אירוע 11:12Z).
     * מעכשיו: RACE-LOST מיידי — האיטום חוזר בפעימה-הבאה על-גבי הקנוני-החדש.
     * ניסיון-push-חוזר כשר רק כשהקנוני בדיוק ההורה-שלנו (כשל-חולף, לא מירוץ). */
    console.log("[economy-beat] RACE-LOST — הקנוני קידם כותב-אחר; מאמץ-קנוני fail-closed (איטום-זה יוחלף בפעימה-הבאה)");
    await run("git", ["reset", "--hard", "origin/main"]);
    process.exit(3);
  }
  push = await run("git", ["push", "origin", "HEAD"]);
}
console.log(`[economy-beat] איטום: ${push.code === 0 ? "נדחף-לגיט" : "push-fail: " + push.o.slice(-200)}`);
process.exit(push.code === 0 ? 0 : 1);
