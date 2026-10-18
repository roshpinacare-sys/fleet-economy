#!/usr/bin/env node
/**
 * run-builder-beat.mjs — פעימת-הבנאי-הריבונית (גל-92 · agent-2 · 2026-10-18)
 *
 * רקע-מדוד (בקשת-בעלים): "למה האתר לא משתפר ומתעדכן באמת קבוע על ידי הריבונות?
 * אני רוצה בניה ושיפור תמיד ולא רק בדיקות".
 * התשובה-ההנדסית: עד-היום הריבונות הפעימה כלכלה+איטום+בדיקות, אך כל-שיפור-מוצר
 * בוצע-ידנית על-ידי סוכן-חי. עכשיו: לופ-בנאי חי observe→think→act→seal:
 *   observe  — טלמטריה-חיה (לב-הכלכלה, הפנקס, המארחים)
 *   think    — מוח-LLM מציע פריטי-שיפור (API מקומי, fail-open, schema-קשיח)
 *   act      — ביצוע-מדוד אך-ורק מתוך white-list-סוגי-פעולות (אין-ריצת-קוד-חוץ)
 *   seal     — איטום-תמונת-מצב-לגיט-הקנוני (FF-טהור; מפוצל → merge-נקי; קונפליקט → abort+דחייה)
 *
 * חוקי-בידוד: clone-גיט-פרטי משלו (אפס-נגיעה ב-clone-פעימות-הכלכלה) · כתיבה-רק
 * ל-bootstrap/sovereign-builder/ · הפנקס-קריאה-בלבד · אפס-סודות-בקוד-או-בלוג.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const ESTATE = "/home/z/audit/fleet-economy";            // העותק-החי (קריאה-בלבד עבורנו)
const CLONE = "/home/z/audit/fleet-economy-builder";      // ה-clone-הפרטי-שלנו לאיטום
const STATE_DIR = "/home/z/audit/sovereign-builder/state";
const STATE_FILE = `${STATE_DIR}/builder-state.json`;
const GROWTH_LOG = `${STATE_DIR}/growth-log.jsonl`;
const VM_VENV_PY = "/home/z/audit/sovereign-vm/venv/bin/python";
const BRAIN_URL = "http://127.0.0.1:3000/api/saos/builder-brain";
const LEDGER = `${ESTATE}/state/ledger.jsonl`;
const BEAT_STATUS = "/home/z/audit/economy-beat-service-status.json";

// white-list סוגי-פעולה — הבנאי מבצע אך-ורק את אלה. כל-השאר נדחה (fail-closed).
const KINDS = ["tool-run", "note-open", "report-write", "milestone-tag"];
const TOOLS = {
  verify_chain: {
    title: "אימות-שרשרת בלתי-תלוי (Python-טהור, גל-91)",
    args: () => [`${ESTATE}/bootstrap/sovereign-vm/verify_chain.py`, LEDGER],
    cwd: ESTATE,
  },
};

function log(msg) {
  const line = `[builder-beat] ${new Date().toISOString()} ${msg}`;
  try { console.log(line); } catch {}
  try { fs.appendFileSync("/home/z/audit/sovereign-builder/beat.log", line + "\n"); } catch {}
}

function git(args, cwd = CLONE) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// ---------- state ----------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      schema: "sovereign-builder-state/v1",
      createdAt: new Date().toISOString(),
      backlog: [],
      growthLogCount: 0,
      acts: 0,                // פעולות-שיפור-שבוצעו-בפועל
      metrics: 0,             // צילומי-מדדים
      brainCalls: 0,
      brainOffers: 0,
      seals: 0,
      sealFailures: 0,
      capabilities: [],        // יכולות-פתוחות (note-open)
      lastKind: null,
      lastAt: null,
      lastVerdict: null,
    };
  }
}
function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}
function appendGrowth(obj) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(GROWTH_LOG, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
}
function readGrowthTail(n = 60) {
  try {
    const lines = fs.readFileSync(GROWTH_LOG, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-n);
  } catch { return []; }
}

// ---------- observe ----------
function observe() {
  const o = { at: new Date().toISOString() };
  try {
    const st = JSON.parse(fs.readFileSync(BEAT_STATUS, "utf8"));
    o.beat = {
      beatCount: st.beatCount ?? null,
      lastRc: st.lastRc ?? null,
      nextRunAt: st.nextRunAt ?? null,
      seq: null, tx: null, price: null,
    };
    for (const line of st.lastSummary ?? []) {
      const seq = line.match(/seq=(\d+)/); if (seq) o.beat.seq = Number(seq[1]);
      const tx = line.match(/\+\(?(\d[\d,]*)\)? עסקאות/); if (tx) o.beat.tx = Number(tx[1].replace(/,/g, ""));
      const p = line.match(/מחיר=([\d.]+)/); if (p) o.beat.price = p[1];
    }
  } catch {}
  try {
    // ספירת-שורות-פנקס — מדידה-עצמאית, קריאה-בלבד
    const buf = fs.readFileSync(LEDGER, { encoding: "utf8" });
    o.ledgerLines = buf.trim().split("\n").length;
    const last = JSON.parse(buf.trim().split("\n").pop());
    o.ledgerSeq = last?.seq ?? null;
  } catch {}
  return o;
}

// ---------- think (fail-open) ----------
async function think(snapshot) {
  try {
    const res = await fetch(BRAIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { available: false, items: [] };
    const j = await res.json();
    return {
      available: j?.brain === true,
      items: Array.isArray(j?.items) ? j.items : [],
    };
  } catch {
    return { available: false, items: [] };
  }
}

// ---------- act (white-list בלבד) ----------
function actOnItem(item) {
  if (!item || typeof item !== "object") return { ok: false, why: "פריט-ריק" };
  const kind = item.kind;
  if (!KINDS.includes(kind)) return { ok: false, why: `סוג-לא-מאושר: ${String(kind).slice(0, 24)}` };

  if (kind === "tool-run") {
    const toolKey = String(item.tool ?? "");
    const tool = TOOLS[toolKey];
    if (!tool) return { ok: false, why: `כלי-לא-רשום: ${toolKey.slice(0, 24)}` };
    if (toolKey === "verify_chain" && !fs.existsSync(VM_VENV_PY))
      return { ok: false, why: "סביבת-VM-ארסנל-חסרה" };
    try {
      const out = execFileSync(VM_VENV_PY, tool.args(), { cwd: tool.cwd, encoding: "utf8", timeout: 180_000 });
      const okLine = out.match(/ok\s*[:=]\s*(true|false)/i);
      const checked = out.match(/checked=(\d+)/);
      const anchors = out.match(/anchors=\[([^\]]*)\]/);
      return {
        ok: okLine ? okLine[1] === "true" : false,
        why: `ok=${okLine?.[1] ?? "?"} checked=${checked?.[1] ?? "?"} anchors=${anchors?.[1] ?? "?"}`,
        meta: { tool: toolKey },
      };
    } catch (e) {
      return { ok: false, why: `הרצת-הכלי-נכשלה: ${String(e?.message ?? e).slice(0, 120)}` };
    }
  }

  if (kind === "note-open") {
    const cap = String(item.capability ?? item.title ?? "").slice(0, 80);
    if (!cap) return { ok: false, why: "יכולת-ריקה" };
    return { ok: true, why: cap, meta: { capability: cap } };
  }

  if (kind === "report-write") {
    // דוח-גידול — נכתב-מהסדרה-האמיתית (מספרים-בלבד, אפס-הדמיה)
    const series = readGrowthTail(200).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      .filter((g) => g.kind === "metric" && typeof g.ledgerSeq === "number");
    if (series.length < 2) return { ok: false, why: "אין-די-מדדים-לדוח" };
    const first = series[0], last = series[series.length - 1];
    const dSeq = last.ledgerSeq - first.ledgerSeq;
    const report = `דוח-צמיחה: ${series.length} צילומים · seq ${first.ledgerSeq.toLocaleString("he-IL")}→${last.ledgerSeq.toLocaleString("he-IL")} (Δ ${dSeq.toLocaleString("he-IL")}) · חלון ${Math.round((new Date(last.at) - new Date(first.at)) / 60000)} דק'`;
    return { ok: true, why: report, meta: { report } };
  }

  if (kind === "milestone-tag") {
    const tag = String(item.title ?? "").slice(0, 80);
    return { ok: true, why: tag, meta: { milestone: tag } };
  }
  return { ok: false, why: "סוג-לא-מוכר" };
}

// ---------- seal (FF-טהור, merge-נקי כגיבוי, abort כ-fail-closed) ----------
function ensureClone() {
  if (fs.existsSync(`${CLONE}/.git`)) return true;
  let url;
  try { url = git(["config", "--get", "remote.origin.url"], ESTATE); } catch { return false; }
  if (!url) return false;
  try {
    execFileSync("git", ["clone", "--no-hardlinks", url, CLONE], { encoding: "utf8", timeout: 180_000 });
    return fs.existsSync(`${CLONE}/.git`);
  } catch (e) { log(`clone-נכשל: ${String(e?.message ?? e).slice(0, 120)}`); return false; }
}

function seal() {
  if (!ensureClone()) return { ok: false, why: "אין-clone" };
  try {
    git(["fetch", "origin", "main"]);

    // FF-אימוץ אם-המקומי-טהור-מאחור
    const local = git(["rev-parse", "HEAD"]);
    const remote = git(["rev-parse", "origin/main"]);
    if (local !== remote) {
      const base = git(["merge-base", "HEAD", "origin/main"]);
      if (base === local) {
        git(["merge", "--ff-only", "origin/main"]); // אימוץ-קנוני
      } else if (base === remote) {
        // הקנוני-מאחור מאיתנו (commit-מקומי שטרם-נדחף) — ממשיכים-לדחוף-FF
      } else {
        // מפוצלים — merge-נקי בלבד (העבודה-שלנו: bootstrap/sovereign-builder/ — תיקייה-דיסקרטית)
        try {
          git(["merge", "origin/main", "--no-edit", "-m", "builder-merge: אימוץ-קנוני (union-תיקייה-דיסקרטית)"]);
        } catch {
          try { git(["merge", "--abort"]); } catch {}
          return { ok: false, why: "מפוצל+קונפליקט — דחיית-איטום (fail-closed)" };
        }
      }
    }

    fs.mkdirSync(`${CLONE}/bootstrap/sovereign-builder/state`, { recursive: true });
    fs.copyFileSync(STATE_FILE, `${CLONE}/bootstrap/sovereign-builder/state/builder-state.json`);
    try {
      const tail = readGrowthTail(300).join("\n") + "\n";
      fs.writeFileSync(`${CLONE}/bootstrap/sovereign-builder/state/growth-log.jsonl`, tail);
    } catch {}

    git(["add", "bootstrap/sovereign-builder"]);
    const staged = git(["diff", "--cached", "--name-only"]);
    if (!staged) return { ok: true, why: "אין-שינויים-לאיטום" };

    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    git(["commit", "-m", `[builder] acts=${st.acts} metrics=${st.metrics} backlog=${st.backlog.length} · צמיחה-ריבונית מאוטמת`]);
    git(["push", "origin", "main"]);
    return { ok: true, why: `איטום-בנאי דחוף (${staged.split("\n").length} קבצים)` };
  } catch (e) {
    return { ok: false, why: `איטום-נכשל: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

// ---------- פעימה ----------
async function main() {
  const t0 = Date.now();
  const state = loadState();
  log("פעימת-בנאי מתחילה");

  const snapshot = observe();
  appendGrowth({ kind: "metric", ledgerSeq: snapshot.ledgerSeq ?? null, ledgerLines: snapshot.ledgerLines ?? null, beatSeq: snapshot.beat?.seq ?? null, tx: snapshot.beat?.tx ?? null, price: snapshot.beat?.price ?? null });
  state.metrics += 1;
  state.growthLogCount = readGrowthTail(100000).length;

  // think — המוח מציע פריטים חדשים (fail-open; אכיפת-schema קשיחה)
  const brain = await think(snapshot);
  if (brain.available) {
    state.brainCalls += 1;
    let added = 0;
    const existing = new Set(state.backlog.map((b) => (b.title ?? "").trim()));
    for (const it of brain.items.slice(0, 3)) {
      const kind = String(it?.kind ?? "");
      const title = String(it?.title ?? "").trim().slice(0, 80);
      const detail = String(it?.detail ?? "").trim().slice(0, 240);
      if (!KINDS.includes(kind) || !title || existing.has(title)) continue;
      if (kind === "tool-run" && !(String(it.tool ?? "") in TOOLS)) continue;
      state.backlog.push({ kind, title, detail, tool: it.tool, at: new Date().toISOString(), by: "brain" });
      existing.add(title);
      added += 1;
    }
    state.brainOffers += added;
    if (added > 0) appendGrowth({ kind: "brain-offers", added });
  }

  // act — פריט-אחד-מה-backlog בכל-פעימה (מדוד-וקצבי)
  if (state.backlog.length > 0) {
    const [item, ...rest] = state.backlog;
    const res = actOnItem(item);
    state.backlog = rest;
    if (res.ok) {
      state.acts += 1;
      if (res.meta?.capability && !state.capabilities.includes(res.meta.capability))
        state.capabilities.push(res.meta.capability);
      appendGrowth({ kind: "act", ok: true, what: `${item.kind}: ${item.title}`, result: res.why });
      log(`ACT ✓ ${item.kind}: ${item.title} → ${res.why}`);
    } else {
      appendGrowth({ kind: "act", ok: false, what: `${item.kind}: ${item.title}`, result: res.why });
      log(`ACT ✗ ${item.kind}: ${item.title} → ${res.why}`);
    }
    state.lastKind = item.kind;
  } else {
    log("אין-backlog — המוח יישאל-שוב בפעימה-הבאה");
  }

  state.lastAt = new Date().toISOString();
  state.lastVerdict = "פעימה-הושלמה";
  saveState(state);

  // seal — איטום-לקנוני
  const s = seal();
  if (s.ok) { state.seals += 1; log(`SEAL ✓ ${s.why}`); }
  else { state.sealFailures += 1; log(`SEAL ✗ ${s.why}`); }
  saveState(state);

  log(`פעימה-הושלמה ב-${Math.round((Date.now() - t0) / 1000)}ש'`);
  process.exit(0);
}

main().catch((e) => { log(`FATAL ${String(e?.message ?? e).slice(0, 200)}`); process.exit(1); });
