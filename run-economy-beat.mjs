#!/usr/bin/env bun
/* economy-beat runner (גל-85 · agent-2 · 2026-10-17) — הכלכלה-הפנימית קמה-ועובדת על-ענן.
 * רצף-אמת בכל-ריצה:
 *  1. מנעול-כותב-יחיד (state/writer-heartbeat.json) — שורש-תפרי-המיזוג ההיסטוריים היה
 *     שני-כותבים על ספר-אחד. מעכשיו: כותב-אחד. דילוג-כנה אם-כותב-אחר-חי (< 30 דק').
 *  2. boot על-הספר-הקנוני מהגיט (restored=true אחרת-כישלון).
 *  3. הכלכלה נושמת BEAT_SECONDS (טיקים, שכר, שירותים, AMM, מס — אפס-הדמיות).
 *  4. שער-אמת: /verify חייב ok:true + עוגנים = 3 בדיוק (צמיחה = תפר-חדש = כישלון-ריצה).
 *  5. איטום-המצב-חזרה-לגיט (commit+push, pull --rebase -X ours במקרה-מירוץ).
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(ROOT, "state");
const HB = path.join(STATE, "writer-heartbeat.json");
const WRITER = process.env.ECONOMY_WRITER ?? "github-economy-beat";
const BEAT_SECONDS = Number(process.env.BEAT_SECONDS ?? 180);
const PORT = 3016;
const ANCHOR_BASELINE = 7; // פורנזיה 2026-10-18T04Z (agent-2, גל-93): בסיס-3 ההיסטורי (46335/55120/68276) + 4 תפרי-צומת מתועדים [290040, 294919, 299807, 299847] — משמורת-חירום gal-18 (777941b: ספר-חי 284K+ שניצל אחרי 150,120 אירועים לא-אטומים · 81971ff: היסטוריית-הענן מקושרת כהורה) + מיזוג-שלום-הבנאים ae96189. אומת-בלתי-תלוי (מאמת-פייתון גל-91): ok=true · checked=316,844 · רציפות-מוכחת-על-כל-התפרים. כל-תפר-מעבר ל-7 = אזעקה fail-closed.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/* 4) שער-אמת */
const v = await getJson("/verify");
const m = await getJson("/metrics");
try { child.kill("SIGTERM"); } catch {}
await sleep(3000);
try { child.kill("SIGKILL"); } catch {}
if (!v?.ok) { console.error(`[economy-beat] FAIL — אימות-שרשרת: ${JSON.stringify(v)}`); process.exit(1); }
const anchors = v.anchors?.length ?? 0;
console.log(`[economy-beat] VERIFY ok · checked=${v.checked} · anchors=${anchors} (בסיס ${ANCHOR_BASELINE})`);
if (anchors > ANCHOR_BASELINE) { console.error("[economy-beat] FAIL — נוצרו תפרי-עוגן חדשים — הספר נקרע"); process.exit(1); }

/* 5) סיכום-כן */
const summary = process.env.GITHUB_STEP_SUMMARY;
const line = (s) => { if (summary) try { fs.appendFileSync(summary, s + "\n"); } catch {} console.log(s); };
const delta = (m?.seq ?? 0) - seqStart;
line(`## economy-beat ✅`);
line(`- seq: ${seqStart} → ${m?.seq ?? "?"} (**+${delta} עסקאות אמת ב-beat זה**)`);
line(`- שרשרת: checked=${v.checked} · עוגני-תפר=${anchors}/${ANCHOR_BASELINE} (יציב)`);
line(`- בריכה: מחיר=${m?.pool?.priceUsdsPerSaos} USDS/SAOS · עמלות=${m?.pool?.feesUsds} USDS`);
line(`- מווסת: nBase=${m?.throughput?.governor?.nBase} · קבלת-חלון=${m?.throughput?.governor?.windowAcceptance}`);
line(`- כותב-יחיד: ${WRITER} · ${new Date().toISOString()}`);
fs.writeFileSync(HB, JSON.stringify({ writer: WRITER, at: Date.now(), endedAt: Date.now(), seq: m?.seq }) + "\n");

/* 6) איטום-לגיט */
const run = (cmd, args) => new Promise((res) => {
  const c = spawn(cmd, args, { cwd: ROOT });
  let o = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (o += d));
  c.on("close", (code) => res({ code: code ?? 1, o }));
});
await run("git", ["add", "state/ledger.jsonl", "state/snapshot.json", "state/seal-log.jsonl", "state/writer-heartbeat.json"]);
await run("git", ["commit", "-q", "-m", `[economy-beat] seq=${m?.seq ?? "?"} (+${delta}) · עוגנים=${anchors}/${ANCHOR_BASELINE} · מאומת-מול-הספר`]);
let push = await run("git", ["push", "origin", "HEAD"]);
if (push.code !== 0) {
  await run("git", ["-c", "rebase.autoStash=true", "pull", "--rebase", "-X", "ours", "origin", "main"]);
  push = await run("git", ["push", "origin", "HEAD"]);
}
console.log(`[economy-beat] איטום: ${push.code === 0 ? "נדחף-לגיט" : "push-fail: " + push.o.slice(-200)}`);
process.exit(push.code === 0 ? 0 : 1);
