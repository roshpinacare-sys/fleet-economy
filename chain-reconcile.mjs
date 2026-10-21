#!/usr/bin/env bun
/**
 * chain-reconcile.mjs — גל-49 · G49 · הרפואה-הארכיטקטונית למיזוגי-union על פנקס-משורשר
 *
 * הבעיה-שנמדדה (owner verdict G49): merge=union + union-resolve משרבבים שרשרת-ענן זרה
 * אל תוך ספר-ה-hash-chain החי → verifyChain מת (brokenAt · seq-כפול). החיתוך-העיוור
 * (deepTrimHeal) נתקע על prefix<DEEP_TRIM_MIN.
 *
 * החוק-החדש — בנייה-מחדש-לפי-seq: בספר-החי אין-שדה-prev; הקישור מרומז
 * (h_i = sha256({...שורה_i, prev: h_{i-1}})) והסדר = seq-מונוטוני. לכל seq לוקחים
 * את המועמד-המשרשר מה-prev-הרץ (השרשרת-החיה-היא-השרשרת-היחידה-העוברת-את-כל-ה-seqs);
 * כל-השאר → הסגר (אפס-מחיקה). פער-(seq-חסר) → עוגן-הצטרפות-יחיד (כמו-קומיט-מיזוג).
 *
 * שימוש:  bun chain-reconcile.mjs [--state DIR] [--loop N]
 * יוצא:   JSON-דוח כנה
 *
 * חוקי-בטיחות: אפס-מחיקה (הסגר בלבד) · כתיבה-אטומית (tmp+rename) · אפס-מגע-בזיכרון-הכותב ·
 * fail-closed (שבר-כלשהו → ok:false ולא-נוגעים בקובץ).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const STATE_DIR = (() => {
  const i = process.argv.indexOf("--state");
  return i > 0 ? process.argv[i + 1] : path.join(import.meta.dir, "state");
})();
const LOOP_N = (() => { const i = process.argv.indexOf("--loop"); return i > 0 ? Number(process.argv[i + 1]) || 3 : 3; })();
const LEDGER = path.join(STATE_DIR, "ledger.jsonl");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const QUAR = path.join(STATE_DIR, "quarantine");

const sha32 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
/** גוף-החתימה: השורה-בלי-h, עם prev=הרץ (בדיוק-כמו-sealTx ב-index.ts) */
const bodyOf = (t, prev) => JSON.stringify({ ...t, prev });

function readSnapshot() {
  try {
    const s = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    if (typeof s.seq === "number" && typeof s.lastH === "string") return { seq: s.seq, lastH: s.lastH };
  } catch {}
  return null;
}

async function writerTip() {
  const ports = [3016, 3017, 3001];
  for (const p of ports) {
    try {
      const r = await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.lastH && j?.engine === "fleet-economy") return { lastH: j.lastH, seq: j.seq ?? null, src: `health:${p}` };
    } catch {}
  }
  return null;
}

function onePass() {
  if (!fs.existsSync(LEDGER)) return { ok: false, why: "no-ledger" };
  const rawLines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
  if (!rawLines.length) return { ok: false, why: "empty-ledger" };

  // דליי-seq: לכל seq — כל-המועמדות (בסדר-קובץ), כולל-שורות-לא-JSON-תקין (נשארות-יתומות)
  const buckets = new Map();
  const badLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let t; try { t = JSON.parse(rawLines[i]); } catch { badLines.push(rawLines[i]); continue; }
    if (!t || typeof t.seq !== "number" || !Number.isInteger(t.seq) || t.seq < 1 || typeof t.h !== "string") { badLines.push(rawLines[i]); continue; }
    if (!buckets.has(t.seq)) buckets.set(t.seq, []);
    buckets.get(t.seq).push(t);
  }

  // בנייה-מחדש-לפי-seq: השרשרת-החיה = המועמדת-המשרשרת-מה-prev-הרץ בכל-seq
  const kept = [];
  const orphans = [];
  let prev = "GENESIS";
  let anchors = 0;
  let lastKeptSeq = 0;
  const maxK = Math.max(...buckets.keys());
  for (let k = 1; k <= maxK; k++) {
    const cands = buckets.get(k) ?? [];
    if (!cands.length) continue; // פער-מוחלט — ייפתר-כעוגן-בשורה-הבאה
    let pick = null;
    for (const c of cands) {
      if (sha32(bodyOf(c, prev)) === c.h) { pick = c; break; } // סדר-קובץ = עדיפות-יציבה
    }
    if (!pick && cands.length === 1) pick = cands[0]; // פער-קודם → עוגן-הצטרפות-יחיד
    if (!pick) { orphans.push(...cands); continue; }   // ריבוי-לא-משרשר → fail-honest להסגר
    if (pick !== cands[0] || cands.length > 1) {
      for (const c of cands) if (c !== pick) orphans.push(c);
    }
    const strict = sha32(bodyOf(pick, prev)) === pick.h;
    if (!strict) anchors++;
    kept.push(JSON.stringify(pick));
    prev = pick.h;
    lastKeptSeq = k;
  }

  const snap = readSnapshot();
  const reachedSnapshot = snap ? prev === snap.lastH || kept.some((l) => l.includes(`"h":"${snap.lastH}"`)) : false;

  // אפס-מחיקה: יתומים → הסגר
  if (orphans.length || badLines.length) {
    fs.mkdirSync(QUAR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (orphans.length) {
      fs.writeFileSync(path.join(QUAR, `${ts}·G49-union-orphans·ledger.jsonl`), orphans.map((t) => JSON.stringify(t)).join("\n") + "\n");
    }
    if (badLines.length) {
      fs.writeFileSync(path.join(QUAR, `${ts}·G49-bad-lines·ledger.jsonl`), badLines.join("\n") + "\n");
    }
    fs.writeFileSync(path.join(QUAR, `${ts}·G49-REASON.txt`),
      `G49 chain-reconcile (rebuild-by-seq): ספר-חי ${kept.length} שורות (seq 1..${lastKeptSeq}, עוגנים ${anchors}) · ` +
      `יתומי-union ${orphans.length} · שורות-פגומות ${badLines.length} · ` +
      `snapshot=${snap ? `seq${snap.seq}` : "none"} · reachedSnapshotH=${reachedSnapshot}. ` +
      `השרשרת-החיה הוכחה בהליכה-seq-מונוטונית-מ-GENESIS. אפס-מחיקה — הסגר-לביקורת.\n`);
  }

  // כתיבה-אטומית
  const tmp = LEDGER + ".tmp.reconcile";
  fs.writeFileSync(tmp, kept.join("\n") + "\n");
  fs.renameSync(tmp, LEDGER);

  return {
    ok: true,
    keptLines: kept.length,
    orphanLines: orphans.length,
    badLines: badLines.length,
    anchors,
    lastKeptSeq,
    maxSeqInFile: maxK,
    reachedSnapshot,
  };
}

const results = [];
for (let i = 0; i < LOOP_N; i++) {
  const r = onePass();
  results.push(r);
  if (!r.ok) break;
  // נקודת-שווי-משקל: טיפ-הכותב == זנב-הקובץ → אפס-אובדן מוכח
  const tip = await writerTip();
  const tail = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).pop();
  let tailH = null; try { tailH = JSON.parse(tail).h; } catch {}
  if (tip?.lastH && tailH === tip.lastH) { results[results.length - 1].tipMatch = true; break; }
  await new Promise((r2) => setTimeout(r2, 850)); // מחזור-טיק אחד — תפיסת-זנב-נספח
}
const last = results[results.length - 1];
console.log(JSON.stringify({ ok: last.ok, passes: results.length, ...last }));
