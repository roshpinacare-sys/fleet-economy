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
import { execFileSync, spawn } from "child_process";
import fs from "fs";

// גל-55 · שיעור-8b: כל-spawn = נתיב-מוחלט מאומת-קיום
const BUN = ["/usr/local/bin/bun", "/home/z/.bun/bin/bun", "/usr/bin/bun"].find((p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}) ?? "bun";
const BASH = ["/usr/bin/bash", "/bin/bash"].find((p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}) ?? "bash";
import path from "path";

const ESTATE = "/home/z/audit/fleet-economy";            // העותק-החי (גל-55: גם-אתר-איטום-המצב-שלנו — אזור-bootstrap-בלבד)
const STATE_DIR = "/home/z/audit/sovereign-builder/state";
const STATE_FILE = `${STATE_DIR}/builder-state.json`;
const GROWTH_LOG = `${STATE_DIR}/growth-log.jsonl`;
/* גל-97 · טלמטריית-שימושיות-כלים: כל-הרצת-כלי נרשמת ביומן-שימוש ייעודי + ספירות-פר-כלי
 * ב-state — כך-ש“האוטונומיה-יודעת-להשתמש-בכלים” הופך מטענה ל-KPI נמדד-ונאטם-לקנון. */
const TOOL_USAGE_LOG = `${STATE_DIR}/tool-usage.jsonl`;
/* גל-96 · פתרון-אפמרליות: סביבת-ה-VM נמחקה ב-reboot (11:11Z) → זה שורש “acts=0”:
 * הרצת-כלים הייתה תלויה ב-venv-מחוץ-לגיט. רזולוציית-פייתון-שכבתית: venv-ארסנלי קודם,
 * נפילה-מדורגת לפייתון-מערכת — כל-הכלים stdlib-טהורים ולכן רצים-בכל-סביבה. */
const PY_CANDIDATES = [
  "/home/z/audit/sovereign-vm/venv/bin/python",
  "/home/z/.venv/bin/python3",
  "/usr/bin/python3",
  "/usr/local/bin/python3",
];
function pyBin() {
  for (const p of PY_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}
const BRAIN_URL = "http://127.0.0.1:3000/api/giant/builder-brain"; // גל-95: נתיב-קנוני-אחרי-קציר-3 (ה-saos-הישן-נעלם-בשחזור)
const LEDGER = `${ESTATE}/state/ledger.jsonl`;
const BEAT_STATUS = "/home/z/audit/economy-beat-service-status.json";

// white-list סוגי-פעולה — הבנאי מבצע אך-ורק את אלה. כל-השאר נדחה (fail-closed).
const KINDS = ["tool-run", "note-open", "report-write", "milestone-tag"];

/* גל-94 · watchdog-שרת-הקונסולה: דלת-הבית-של-הבעלים-חייבת-לא-למות. תהליכים-שנולדים-מה-shell-של-סוכן
 * נשחטים-עם-ה-cgroup-שלו; לכן הפעימה (ילד-מארח-חי-על-עץ-הפלטפורמה) מקימה-את-השרת-כבן-מנותק
 * (detached+unref) שמתייתם-ל-init אחרי-צאת-הפעימה — בדיוק-כמו-המארחים-עצמם-שרדו. */
function ensureConsoleServer() {
  try { execFileSync("pgrep", ["-f", "next dev -p 3000"], { encoding: "utf8" }); return; } catch { /* אין-תהליך */ }
  try {
    const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", "http://127.0.0.1:3000/"], { encoding: "utf8" }).trim();
    if (code === "200") return;
  } catch { /* מת-באמת */ }
  try {
    const c = spawn(BASH, ["-c", "cd /home/z/my-project && exec ./node_modules/.bin/next dev -p 3000 >> /home/z/my-project/dev.log 2>&1"], { detached: true, stdio: "ignore" });
    c.unref();
    log("watchdog: שרת-הקונסולה היה מת — הוקם-מחדש (מנותק-ל-init)");
  } catch (e) { log("watchdog-שרת נכשל: " + String(e?.message ?? e).slice(-200)); }
}
ensureConsoleServer();

/* גל-95 · מעגל-החייאה-ההדדית: הבנאי-מחיה-גם-את-לב-הכלכלה. שיעור-08:11Z: שכבת-instrumentation
 * של-הקונסולה-יכולה-ליפול-שקט (ואז-אף-אחד-לא-מחיה-מארחים) — לכן-כל-פעימה-חיה-מארחים-משלימים
 * בעצמה. מעגל-סגור: לב→בנאי+קונסולה · בנאי→לב+קונסולה · instrumentation→הכל (כשהוא-חי). */
function ensureEconomyHost() {
  try { execFileSync("pgrep", ["-f", "economy-beat-host.mjs"], { encoding: "utf8" }); return; } catch { /* אין-מארח */ }
  try {
    const c = spawn(BUN, ["/home/z/audit/fleet-economy/bootstrap/economy-beat-host.mjs"], { detached: true, stdio: "ignore" });
    c.unref();
    log("watchdog-גל-95: מארח-הלב-היה-מת — הוקם-מחדש (בית-קנוני-bootstrap, מנותק-ל-init)");
  } catch (e) { log("watchdog-לב נכשל: " + String(e?.message ?? e).slice(-200)); }
}
ensureEconomyHost();
/* מרשם-הכלים-החי (גל-96) — מתואם 1:1 עם TOOLS ב-api/giant/builder-brain (קונסולה)
 * ומתועד ב-bootstrap/sovereign-builder/TOOLS.md. הוספת-כלי = שלשה-קנונית:
 * סקריפט ב-sovereign-vm + כאן + במוח. */
const TOOLS = {
  verify_chain: {
    title: "אימות-שרשרת בלתי-תלוי (Python-טהור, גל-91)",
    args: () => [`${ESTATE}/bootstrap/sovereign-vm/verify_chain.py`, LEDGER],
    cwd: ESTATE,
  },
  ledger_stats: {
    title: "סטטיסטיקת-פנקס: ספירה, טווח-seq, היסטוגרמת-סוגים (גל-96)",
    args: () => [`${ESTATE}/bootstrap/sovereign-vm/ledger_stats.py`, LEDGER],
    cwd: ESTATE,
  },
  price_report: {
    title: "דוח-בריכה-ואוצר: מחיר-מחושב, עמלות, אוצר (גל-96)",
    args: () => [`${ESTATE}/bootstrap/sovereign-vm/price_report.py`, `${ESTATE}/state/snapshot.json`],
    cwd: ESTATE,
  },
  tools_selftest: {
    title: "הוכחת-שימוש-חד-פעמית: מריץ את כל-הארסנל ומדפיס מטריצה (גל-97)",
    args: () => [`${ESTATE}/bootstrap/sovereign-vm/tools_selftest.py`],
    cwd: ESTATE,
  },
};
const PLAYBOOK = ["verify_chain", "ledger_stats", "price_report", "tools_selftest"]; // סבב-קבוע גם-בלי-מוח

function log(msg) {
  const line = `[builder-beat] ${new Date().toISOString()} ${msg}`;
  try { console.log(line); } catch {}
  try { fs.appendFileSync("/home/z/audit/sovereign-builder/beat.log", line + "\n"); } catch {}
}

/* גל-55: מנגנון-ה-git-הפרטי (clone+push) הוסר — קיצון-הכותב-השני. ראה seal() למטה. */

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
  /* גל-97 · תיקון-דריסה: recordToolUsage כותב toolStats-ישירות-לקובץ; saveState-של-הפעימה
   * כותב-מהזיכרון והיה-מוחק-אותם. מיזוג-שומר: toolStats-מהקובץ-הקיים תמיד-שורד. */
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (prev && typeof prev === "object" && prev.toolStats && typeof prev.toolStats === "object") {
      s.toolStats = { ...prev.toolStats, ...(s.toolStats ?? {}) };
    }
  } catch { /* אין-קובץ-קודם — כלום-לשמר */ }
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}
function appendGrowth(obj) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(GROWTH_LOG, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
}
/* גל-97 · רישום-שימוש-בכלי — מקור-האמת לשימושיות-הארסנל (KPI פר-כלי) */
function recordToolUsage(toolKey, ok, durMs, result) {
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(TOOL_USAGE_LOG, JSON.stringify({ at, tool: toolKey, ok: !!ok, durMs, result: String(result ?? "").slice(0, 140) }) + "\n");
  } catch {}
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    s.toolStats = s.toolStats ?? {};
    const t = s.toolStats[toolKey] ?? { runs: 0, ok: 0, fail: 0, lastOkAt: null, lastResult: null };
    t.runs += 1;
    if (ok) { t.ok += 1; t.lastOkAt = at; } else { t.fail += 1; }
    t.lastAt = at;
    t.lastResult = String(result ?? "").slice(0, 120);
    s.toolStats[toolKey] = t;
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
  } catch {}
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
    const py = pyBin();
    if (!py) return { ok: false, why: "אף-פייתון-לא-זמין" };
    const t0 = Date.now();
    try {
      const out = execFileSync(py, tool.args(), { cwd: tool.cwd, encoding: "utf8", timeout: 180_000 });
      const dur = Date.now() - t0;
      const okLine = out.match(/ok\s*[:=]\s*(true|false)/i);
      const checked = out.match(/checked=(\d+)/);
      const seqLast = out.match(/seqLast=(\d+)/);
      const price = out.match(/price=([\d.]+)/);
      /* גל-96 · תיקון-באג-רישיות: python מדפיס “ok=True” — ההשוואה הקשה “True”===“true”
       * הפכה הצלחות-אמת לכישלונות. toLowerCase חובה. */
      const ok = okLine ? okLine[1].toLowerCase() === "true" : false;
      const why = (out.trim().split("\n")[0] ?? "").slice(0, 140) || "ok=?";
      recordToolUsage(toolKey, ok, dur, why); // גל-97 · טלמטריית-שימוש
      return {
        ok,
        why,
        meta: { tool: toolKey, checked: checked?.[1], seqLast: seqLast?.[1], price: price?.[1] },
      };
    } catch (e) {
      recordToolUsage(toolKey, false, Date.now() - t0, `הרצת-הכלי-נכשלה: ${String(e?.message ?? e).slice(0, 100)}`);
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

// ---------- seal (חוק-הכספת · גל-55) ----------
/* גל-55 · G55 · קיצון-הכותב-השני: הממצא-המדוד (2026-10-22) — ה-clone-הפרטי הזה הפך-כותב-שני
 * של ספר-הכלכלה: מיזוגיו משכו שרשרות-ספר-זרות לקנון (+3140 שורות) ומיזוג-union של seal-host
 * שיבב אותן אל הספר-החי → 50 עוגני-תפר → זנב-בלתי-מעוגן → רג'נזיס-שלם. ספר-hash-chain אינו
 * זרם-נספח — איחוד-שורות עליו = השחתה-מובטחת.
 * החוק-החדש: לבנאי אין-clone ואין-דחיפה-עצמאית. הוא כותב את מצבו ישירות לעץ-החי
 * (bootstrap/sovereign-builder/state — אזור-ייעודי בלי-ספר), ו-seal-host אוטם-את-העץ-החי
 * כולו בחוק-הכספת (-s ours). כותב-אחד · קנון-אחד · אפס-תפרים. */
function seal() {
  try {
    fs.mkdirSync(`${ESTATE}/bootstrap/sovereign-builder/state`, { recursive: true });
    fs.copyFileSync(STATE_FILE, `${ESTATE}/bootstrap/sovereign-builder/state/builder-state.json`);
    try {
      fs.writeFileSync(`${ESTATE}/bootstrap/sovereign-builder/state/growth-log.jsonl`, readGrowthTail(300).join("\n") + "\n");
    } catch {}
    try {
      /* גל-97 · יומן-השימוש לקנון — דרך-העץ-החי (הוכחת-השימושיות חיה-בגיט, לא-רק-בזיכרון) */
      const usage = fs.readFileSync(TOOL_USAGE_LOG, "utf8").trim().split("\n").filter(Boolean).slice(-300).join("\n") + "\n";
      fs.writeFileSync(`${ESTATE}/bootstrap/sovereign-builder/state/tool-usage.jsonl`, usage);
    } catch {}
    return { ok: true, why: "מצב-הבנאי-נכתב-לעץ-החי — seal-host אוטם (חוק-הכספת גל-55 · אפס-clone · כותב-אחד)" };
  } catch (e) {
    return { ok: false, why: `כתיבת-מצב-לעץ-החי נכשלה: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

// ---------- פעימה ----------
async function main() {
  // גל-104: נעילת-פעימה — מונע-ריצות-מקבילות אם-יותר-ממארח-אחד מתזמן (חוק-נעילת-הסוופ).
  // 90ש' בלבד: מכסה-פעימה-בריצה (עד-83ש' זרימה) מבלי-לדלג-על-טיקים-מתוזמנים-רגילים (5-דק').
  const LOCK = "/home/z/audit/sovereign-builder/state/beat.lock";
  try {
    const age = Date.now() - (fs.existsSync(LOCK) ? fs.statSync(LOCK).mtimeMs : 0);
    if (age < 90_000) { log(`פעימה-פעילה-כבר (lock גיל=${Math.round(age / 1000)}ש') — מדלג`); return; }
    fs.mkdirSync("/home/z/audit/sovereign-builder/state", { recursive: true });
    fs.writeFileSync(LOCK, String(process.pid));
  } catch {}
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

  /* גל-96 · פלייבוק-קבוע: אם-המוח-לא-זמין ואין-backlog — הבנאי בכל-זאת פועל (סבב-כלים).
   * מנדט-הבעלים: “בנייה-ושיפור-תמידי” — אפס-פעימות-ריקות-מידיים, גם-בכשל-מוח. */
  if (!brain.available && state.backlog.length === 0) {
    const tool = PLAYBOOK[state.acts % PLAYBOOK.length];
    state.backlog.push({ kind: "tool-run", title: `פלייבוק-ריבוני: ${tool}`, detail: "הרצת-כלי-ארסנל-קבועה (גל-96)", tool, at: new Date().toISOString(), by: "playbook" });
    appendGrowth({ kind: "playbook", tool });
    log(`PLAYBOOK → ${tool} (המוח-לא-זמין)`);
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
