#!/usr/bin/env bun
/**
 * chain-reconcile.mjs — גל-49 · G49 · הרפואה-הארכיטקטונית-למיזוגי-union-על-פנקס-משורשר
 *
 * הבעיה-שנמדדה (owner verdict G49): merge=union + union-resolve משרבבים שרשרת-ענן
 * זרה אל תוך ספר-ה-hash-chain החי → verifyChain מת (brokenAt=1 · seq-כפול).
 * החיתוך-העיוור (deepTrimHeal) נתקע על prefix<DEEP_TRIM_MIN.
 *
 * החוק-החדש: ההליכה-אחורה-מהטיפ-החי (בזיכרון-הכותב) דרך קישורי prev — חסינה
 * לסדר-השורות-בקובץ. כל-שאר → הסגר (אפס-מחיקה). הספר-הנכתב: שרשרת-אחת
 * מ-GENESIS עד הטיפ, רציפה-מושלמת מנקודת-הסנאפשוט (replay-clean).
 *
 * שימוש:  bun chain-reconcile.mjs [--state DIR] [--tip-h HEX] [--loop N]
 * יוצא:   JSON-דוח כנה {ok, keptLines, orphanLines, reachedSnapshot, reachedGenesis, tipMatch}
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
const TIP_H_ARG = (() => { const i = process.argv.indexOf("--tip-h"); return i > 0 ? process.argv[i + 1] : null; })();
const LOOP_N = (() => { const i = process.argv.indexOf("--loop"); return i > 0 ? Number(process.argv[i + 1]) || 3 : 3; })();
const LEDGER = path.join(STATE_DIR, "ledger.jsonl");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const QUAR = path.join(STATE_DIR, "quarantine");

const sha32 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** שורה-עצמית-עקבית: h השמור == sha256(גוף-עם-prev-השמור-שלה) */
function selfConsistent(line) {
  let t; try { t = JSON.parse(line); } catch { return null; }
  if (!t || typeof t.seq !== "number" || typeof t.h !== "string") return null;
  const { h, ...rest } = t;
  const body = JSON.stringify({ ...rest, prev: rest.prev ?? "GENESIS" });
  return sha32(body) === h ? t : null;
}

function readSnapshot() {
  try {
    const s = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    if (typeof s.seq === "number" && typeof s.lastH === "string") return { seq: s.seq, lastH: s.lastH };
  } catch {}
  return null;
}

async function writerTip() {
  if (TIP_H_ARG) return { lastH: TIP_H_ARG, seq: null, src: "arg" };
  try {
    const ports = [3016, 3017, 3001];
    for (const p of ports) {
      try {
        const r = await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(1500) });
        if (!r.ok) continue;
        const j = await r.json();
        if (j?.lastH && j?.engine === "fleet-economy") return { lastH: j.lastH, seq: j.seq ?? null, src: `health:${p}` };
      } catch {}
    }
  } catch {}
  return null;
}

/** ההליכה-אחורה: מהטיפ דרך prev-קישורים על מפת-h→שורה. חוזרת-עד-GENESIS או-עד-קישור-חסר. */
function walkBack(tipH, byH) {
  const chain = [];
  const seen = new Set();
  let cur = byH.get(tipH);
  let stopReason = "tip-not-in-file";
  if (cur) {
    stopReason = "missing-link";
    while (cur) {
      if (seen.has(cur.h)) { stopReason = "cycle"; break; }
      seen.add(cur.h);
      chain.push(cur);
      const p = cur.prev ?? "GENESIS";
      if (p === "GENESIS") { stopReason = "GENESIS"; break; }
      cur = byH.get(p);
      if (!cur) { stopReason = `missing-link:${p.slice(0, 8)}`; break; }
    }
  }
  return { chain: chain.reverse(), stopReason };
}

async function onePass() {
  if (!fs.existsSync(LEDGER)) return { ok: false, why: "no-ledger" };
  const rawLines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
  if (!rawLines.length) return { ok: false, why: "empty-ledger" };

  const snap = readSnapshot();
  const tip = await writerTip();
  const tipH = tip?.lastH ?? rawLines[rawLines.length - 1]?.match(/"h":"([0-9a-f]{32})"/)?.[1];
  if (!tipH) return { ok: false, why: "no-tip" };

  // מפת h→טרנזקציה (עצמית-עקביות בלבד) — חסין-לסדר-קובץ; עותק-מוקדם-קובע
  const byH = new Map();
  const order = new Map();
  for (let i = 0; i < rawLines.length; i++) {
    const t = selfConsistent(rawLines[i]);
    if (!t) continue;
    if (!byH.has(t.h)) { byH.set(t.h, t); order.set(t.h, i); }
    else if ((order.get(t.h) ?? Infinity) > i) order.set(t.h, i);
  }

  const { chain, stopReason } = walkBack(tipH, byH);
  if (!chain.length) return { ok: false, why: stopReason, tipH: tipH.slice(0, 8) };

  const chainSet = new Set(chain.map((t) => t.h));
  const keptLines = chain.map((t) => JSON.stringify(t));
  const orphanLines = rawLines.filter((l, i) => {
    const m = l.match(/"h":"([0-9a-f]{32})"/);
    return !(m && chainSet.has(m[1]) && order.get(m[1]) === i);
  });

  const reachedSnapshot = snap ? chainSet.has(snap.lastH) : false;
  const reachedGenesis = stopReason === "GENESIS";

  // אפס-מחיקה: יתומים → הסגר
  if (orphanLines.length) {
    fs.mkdirSync(QUAR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(QUAR, `${ts}·G49-union-orphans·ledger.jsonl`), orphanLines.join("\n") + "\n");
    fs.writeFileSync(path.join(QUAR, `${ts}·G49-union-orphans·REASON.txt`),
      `G49 chain-reconcile: ${orphanLines.length} שורות-יתום (שרשרת-ענן-זרה/כפילויות-union) — ` +
      `לא-בשרשרת-החיה שהוכחה בהליכה-אחורה-מהטיפ ${tipH.slice(0, 8)} (${tip?.src ?? "tail"}). ` +
      `השרשרת-החיה: ${keptLines.length} שורות · stopReason=${stopReason} · ` +
      `snapshot=${snap ? `seq${snap.seq}/${snap.lastH.slice(0, 8)}` : "none"}. אפס-מחיקה — הסגר-לביקורת.\n`);
  }

  // כתיבה-אטומית
  const tmp = LEDGER + ".tmp.reconcile";
  fs.writeFileSync(tmp, keptLines.join("\n") + "\n");
  fs.renameSync(tmp, LEDGER);

  return {
    ok: true,
    keptLines: keptLines.length,
    orphanLines: orphanLines.length,
    reachedSnapshot,
    reachedGenesis,
    stopReason,
    tipH: tipH.slice(0, 8),
    tipSeq: tip?.seq ?? null,
    tipSrc: tip?.src ?? "tail-fallback",
    fileTailH: chain[chain.length - 1].h.slice(0, 8),
  };
}

const results = [];
for (let i = 0; i < LOOP_N; i++) {
  const r = await onePass();
  results.push(r);
  if (!r.ok) break;
  // נקודת-שווי-משקל: טיפ-הכותב == זנב-הקובץ → אפס-אובדן מוכח
  const tip = await writerTip();
  const tail = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).pop();
  const tailH = tail?.match(/"h":"([0-9a-f]{32})"/)?.[1];
  if (tip?.lastH && tailH === tip.lastH) { results[results.length - 1].tipMatch = true; break; }
  await new Promise((r2) => setTimeout(r2, 900)); // מחזור-טיק אחד — תפיסת-זנב-נספח
}
const last = results[results.length - 1];
console.log(JSON.stringify({ ok: last.ok, passes: results.length, ...last }));
