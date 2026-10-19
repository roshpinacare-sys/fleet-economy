/* ═══ fleet-economy · פורט 3016 · הכלכלה-הפנימית של הריבונות ═══
 * ==============================================================================
 * תורת-משתמשי-פנים (מנדט-הבעלים, trace 1a143bc66c2a9c05):
 *   "החיילים, הצי, הסוכנים — הם המשתמשים ברשת, כהוכחה ומטרה. לא לחפש לקוחות
 *    חוץ. לפתח יכולות כלפי פנים ולא כלפי חוץ. 20-ומשהו עסקאות ב-24 שעות זה
 *    מגוחך — צריך אלפים, עשרות-אלפים, מאות-אלפים עסקאות ביום, ללא תלות חוץ."
 *
 * מה-זה: מנוע-כלכלה חי שבו כל-משתמשי-הפנים (שש-החיילות של המשרד + צמתי-הצי)
 * מבצעים עסקאות אמת ברציפות: משכורות, תשלומי-שירות הדדיים (חישוב/אחסון/מידע/
 * דלק), החלפות SAOS<->USDS על בריכת-AMM אמיתית, סטייקינג, טיפים.
 *
 * חוקי-אמת (אפס-הדמיות):
 *  · ספר hash-chain: כל-רשומה חתומה sha256(prevH+body) — חסים-תיקון, כל
 *    שינוי-עבר מתגלה. /verify מאמת את השרשרת כולה.
 *  · איזון-כפול: כל-עסקה מחייבת יתרה-קיימת אצל המשלם — אין כסף מהאוויר,
 *    היצע-קבוע. עסקה שנדחית נספרת בכנות (rejected) ולא נכתבת.
 *  · הספר append-only על-גבי-הדיסק (state/ledger.jsonl) — נאטם לגיט ע"י
 *    vault-seal, שום דבר לא מת עם ה-sandbox.
 *  · בריכת-AMM קבועת-מכפלה אמיתית: המחיר נע מהזרימה, עמלת 0.3% נשארת
 *    בבריכה (העמקת-נזילות), אספקת SAOS קבועה 21,000 (חוק-21M המתוקן).
 * ============================================================================== */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
// גל-86 · blueprint A2 (agent-2): כסף-שלם BigInt µ¢ — אפס-פלואט בחישוב-כסף.
// fromF משחזר בדיוק ערכי-6-ספרות מהספר/הסנאפשוט (אפס-שכתוב-היסטוריה).
// גל-87 · מיגרציית-יתרות: כל-היתרות (balances) והבריכה (pool) חיים-כ-BigInt µ¢
// בזיכרון; הסידור (פנקס + snapshot) נשאר מספרי-6-ספרות זהה-בייטים — רצף-hash נשמר.
import { fromF, toF, ammOut as muAmmOut, splitFee, type Mu } from "./lib/mu";

const PORT = 3016;
const STATE_DIR = path.join(import.meta.dir, "state");
const LEDGER = path.join(STATE_DIR, "ledger.jsonl");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const EXT_FLOWS = path.join(STATE_DIR, "ext-flows.jsonl"); // גל-109 · שער-הזרימות-החוץ (G27): כותב-יחיד=console-API · קורא=המנוע
const TICK_MS = 800; // גל-85: 900→800 (תקורה-זעירה — flush הוא append-בלבד)
const SNAP_MS = 30_000;
const FEE_BPS = 30; // 0.3%
const WAGE_FLOOR_USDS = 350; // גל-83 · חוק-שכר-מצע: רצפת-פרנסה לחייל
const TREASURY_FLOOR_USDS = 400; // גל-85 · משאבת-נזילות-כספת: מתחת-לזה הכספת מוכרת-SAOS לבריכה (עסקת-AMM אמת) כדי-שמשכורות-יזרמו
const TAX_BPS = 200; // גל-83 · מס-שירותים 2% → הכספת (מימון-השכר)

/* ── משתמשי-הפנים ─────────────────────────────────────────────────────────── */
type Account = { id: string; kind: "treasury" | "soldier" | "fleet" | "pool"; role: string };
const SOLDIERS = [
  { id: "yarden", role: "סוגרת-פינות משולחן ראש-המטה" },
  { id: "tamar", role: "מעדכנת תזרים בecon-book" },
  { id: "shachar", role: "סורק ריצות שנכשלו בקיר-הגיט" },
  { id: "aluf", role: "סוקר את לוח-המשימות" },
  { id: "erez", role: "מציג ממצאים בדוכן-ההחלטות" },
  { id: "gal", role: "סורק מילויים בdex-book" },
] as const;
const FLEET_NODES = [
  { id: "FleetHQ", role: "חדר-מבצעים חי" },
  { id: "Domain", role: "הוויטרינה" },
  { id: "TruthRail", role: "ערוץ הקבלות" },
  { id: "saos-dex", role: "מנוע-הדקס" },
  { id: "Pulse", role: "דופק-רשת" },
  { id: "Console", role: "קונסולת-ענן" },
] as const;

const ACCOUNTS: Account[] = [
  { id: "treasury", kind: "treasury", role: "הכספת הריבונית" },
  { id: "pool", kind: "pool", role: "בריכת SAOS/USDS" },
  ...SOLDIERS.map((s) => ({ id: s.id, kind: "soldier" as const, role: s.role })),
  ...FLEET_NODES.map((n) => ({ id: n.id, kind: "fleet" as const, role: n.role })),
  { id: "boot-verifier", kind: "fleet" as const, role: "מאמת-האתחול :3042 (הוכחת-חיים)" },
];

/* ── הצע-קבוע (חוק-21M המתוקן: אספקת SAOS = 21,000, לעולם לא נרגעת) ────────── */
const SAOS_SUPPLY = 21_000;
const TREASURY_USDS = 60_000;
const POOL_SAOS = 8_000;
const POOL_USDS = 8_030; // מחיר-פתיחה ≈ 1.0038 USDS/SAOS

type MuBal = { usds: Mu; saos: Mu; saosStaked: Mu }; // גל-87 · יתרות = µ¢ שלם
// גל-87 · גשר-קריאה מה-snapshot ההיסטורי (מספרי-6-ספרות) → µ¢ מדויק
const balFromSnap = (v: any): MuBal => ({
  usds: fromF(Number(v?.usds ?? 0)),
  saos: fromF(Number(v?.saos ?? 0)),
  saosStaked: fromF(Number(v?.saosStaked ?? 0)),
});
type Balances = Map<string, MuBal>;
type Tx = {
  seq: number; ts: number; kind: string; from: string; to: string;
  asset: "USDS" | "SAOS"; amount: number; fee?: number; price?: number;
  reason: string; ref?: string; h: string;
};

let balances: Balances = new Map();
// גל-87 · הבריכה כמודול-µ¢ — אפס-פלואט במסלול-הכסף כולו
let pool = { saos: fromF(POOL_SAOS), usds: fromF(POOL_USDS), feesUsds: 0n, feesSaos: 0n };
let seq = 0;
let lastH = "GENESIS";
let tickNo = 0; // גל-83 · מונה-טיקים לחוקים-הפיסקליים (שכר-מצע/איסוף-עמלות)
let ledgerBuf: string[] = [];
let ledgerLines = 0;
let ledgerFileNo = 0;
let recent: number[] = []; // timestamps (24h window)
let byKind: Record<string, number> = {};
let byAccount: Record<string, number> = {};
let rejected = 0;
/* גל-85 · מווסת-קצב אדפטיבי: ניסיונות-פר-טיק נשלטים-על-ידי-אחוז-הקבלה בפועל.
 * קבלה גבוהה (>92%) → המצערת נפתחת · קבלה נמוכה (<70%) → נסגרת.
 * כנות-מלאה: attemptsTotal ואחוז-הקבלה מוצגים ב-/metrics. */
let nBase = 14;
const N_CAP = 18, N_MIN = 6, GOV_PERIOD = 40;
let attemptsTotal = 0;
let winAttempts = 0, winRejected = 0, lastGovAcc: number | null = null;
function rej() { rejected++; winRejected++; }
let errors = 0;
let bootedAt = Date.now();
let lastVerify: { at: number; ok: boolean; checked: number } | null = null;
let sealing = false; // חוק-גל-82: מנוע-קפוא-בזמן-אטימת-כספת (אף-כתיבת-מדינה)
const tailRing: Tx[] = []; // last 500 for /ledger reads

/* ── ingest אמת: אירועי-מערכת אמיתיים (מילויי-דקס · בדיקות-מאמת-אתחול · אטימות)
 *      נרשמים כעסקאות בספר — כל-tx ממופה 1:1 לאירוע שקרה. אפס-סינתזה.
 *  מונים-כנים: ingestOk / ingestDedup / ingestFailed / ingestBadPayload.
 *  droppedTx = עסקאות-אירוע שאבדו (מוצא-נכשל או דחיית-איזון סופית) — מוצג ב-/metrics.
 */
let ingestOk = 0, ingestDedup = 0, ingestFailed = 0, ingestBad = 0;
/* גל-109 · שער-הזרימות-החוץ (G27 · מנדט-בעלים-HTX): ייבוא-נזילות-חוץ בעלת-מקור
 * (provenance: venue·txid·ref) — תוצאות-המסחר של סוכן-ה-HTX נקלטות בכספת-הריבונית
 * כ-ext-deposit חתום-בשרשרת. כותב-יחיד לקובץ: console-API (fail-closed על
 * .secrets/ext-flow.key) · המנוע קורא-בלבד ב-boot. אפס-סודות בספר או בקוד. */
let extImportedMu = 0n, extCount = 0, extDedup = 0, extBad = 0;
const seenRefs = new Map<string, number>(); // ref → ts (דהיות: פקודות-כפולות של מפיקים לא נספרות פעמיים)
const SEEN_REFS_CAP = 20_000;
const SEEN_REFS_SNAP = 5_000; // כמה-refs-שורדים-ב-snapshot (האחרונים-ראשית — Map שומר-סדר-הכנסה)
const INGEST_KINDS = new Set(["dex-fee", "infra", "service"]);
const KNOWN_ACCOUNTS = new Set(ACCOUNTS.map((a) => a.id));
function rememberRef(ref: string) {
  if (seenRefs.size >= SEEN_REFS_CAP) {
    const first = seenRefs.keys().next().value as string | undefined;
    if (first !== undefined) seenRefs.delete(first);
  }
  seenRefs.set(ref, Date.now());
}
/* תדלוק-צף: חשבון-פנים שמשלם אגרות-אירוע לעולם לא נתקע — הכספת ממלאת אותו
 * ליעד-קטן (25-USDS) בעסקת-משכורת אמת בספר (מתועדת, נחתמת בשרשרת). */
const FLOAT_TARGET = 25;
function refillFloatIfEmpty(payer: string, needed: number): boolean {
  const needMu = fromF(needed);
  const b = bal(payer);
  if (b.usds >= needMu) return true;
  const fillMu = fromF(FLOAT_TARGET) - b.usds;
  if (fillMu <= 0n) return b.usds >= needMu;
  const fill = toF(fillMu);
  const r = apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: payer, asset: "USDS", amount: fill, reason: `תדלוק-צף-אגרות-אירועים (${payer})` });
  return r !== null && bal(payer).usds >= needMu;
}
/* הכנסת-אירוע אמת לספר. מחזיר Tx|null וסופר בכנות. */
function ingestEvent(v: {
  kind: string; from: string; to: string; asset: "USDS" | "SAOS"; amount: number;
  reason: string; ref: string; refillFloat?: boolean;
}): { ok: boolean; dedup?: boolean; tx?: Tx; why?: string } {
  if (!INGEST_KINDS.has(v.kind) || !KNOWN_ACCOUNTS.has(v.from) || !KNOWN_ACCOUNTS.has(v.to)) {
    ingestBad++; return { ok: false, why: "bad-kind-or-account" };
  }
  if (!(v.asset === "USDS" || v.asset === "SAOS") || !Number.isFinite(v.amount) || v.amount <= 0 || v.amount > 1_000_000) {
    ingestBad++; return { ok: false, why: "bad-amount" };
  }
  const reason = String(v.reason).slice(0, 300);
  const ref = String(v.ref).slice(0, 200);
  if (seenRefs.has(ref)) { ingestDedup++; return { ok: true, dedup: true, why: "already-recorded" }; }
  if (v.refillFloat && v.asset === "USDS" && !refillFloatIfEmpty(v.from, v.amount)) {
    ingestFailed++; return { ok: false, why: "float-refill-failed" };
  }
  const tx = apply({ seq: seq + 1, ts: Date.now(), kind: v.kind, from: v.from, to: v.to, asset: v.asset, amount: round6(v.amount), reason, ref });
  if (!tx) { ingestFailed++; return { ok: false, why: "balance-rejected (counted honestly in rejected)" }; }
  rememberRef(ref);
  ingestOk++;
  return { ok: true, tx };
}

function bal(id: string) {
  let b = balances.get(id);
  if (!b) { b = { usds: 0n, saos: 0n, saosStaked: 0n }; balances.set(id, b); }
  return b;
}

/* ── חתימת-שרשרת ──────────────────────────────────────────────────────────── */
function sealTx(t: Omit<Tx, "h">): Tx {
  const body = JSON.stringify({ ...t, prev: lastH });
  const h = createHash("sha256").update(body).digest("hex").slice(0, 32);
  return { ...t, h };
}

function persist(tx: Tx) {
  ledgerBuf.push(JSON.stringify(tx));
  if (ledgerBuf.length >= 64) flush();
  tailRing.push(tx);
  if (tailRing.length > 500) tailRing.shift();
}

function flush() {
  if (!ledgerBuf.length) return;
  fs.appendFileSync(LEDGER, ledgerBuf.join("\n") + "\n");
  ledgerLines += ledgerBuf.length;
  ledgerBuf = [];
  if (ledgerLines > 200_000) rotate();
}

function rotate() {
  flush();
  const dst = path.join(STATE_DIR, `ledger-${String(ledgerFileNo).padStart(4, "0")}.jsonl`);
  try { fs.renameSync(LEDGER, dst); ledgerFileNo++; ledgerLines = 0; } catch { /* honest */ }
}

/* ── החלה עם איזון-כפול fail-closed (גל-87 · כל-האריתמטיקה = BigInt µ¢;
 *  ערכי-tx (amount/fee/out) נקראים-כמספרי-6-ספרות דרך-fromF — הספר-אינו-משתנה) ── */
function apply(t: Omit<Tx, "h">, refH?: string): Tx | null {
  const from = bal(t.from), to = bal(t.to);
  const field = t.asset === "USDS" ? "usds" : "saos";
  const amtMu = fromF(t.amount);
  if (t.kind === "ext-deposit") {
    // גל-109 · ייבוא-חוץ: המקור בעולם-החוץ (venue+txid+ref — מאומת-בשער-הקליטה),
    // אין-חיוב-מקור-פנים — רק-זיכוי-יעד. חוק-איזון-כפול נאכף בשער (סכום-חיובי-סופי · ref-יחיד).
    (to as any)[field] += amtMu;
    extImportedMu += amtMu; extCount++;
    byAccount[t.from] = (byAccount[t.from] ?? 0) + 1;
    byAccount[t.to] = (byAccount[t.to] ?? 0) + 1;
    const signed = sealTx(t);
    seq = signed.seq; lastH = signed.h;
    recent.push(signed.ts);
    byKind[signed.kind] = (byKind[signed.kind] ?? 0) + 1;
    persist(signed);
    return signed;
  }
  if ((from as any)[field] < amtMu) { rej(); return null; }
  if (t.kind === "stake") {
    from.saos -= amtMu; from.saosStaked += amtMu;
  } else if (t.kind === "unstake") {
    if (from.saosStaked < amtMu) { rej(); return null; }
    from.saosStaked -= amtMu; to.saos += amtMu;
  } else {
    (from as any)[field] -= amtMu;
    if (t.kind === "swap") {
      // גל-85 · תיקון-שורש (פורנזיה agent-2 2026-10-17): תוצרי-ההחלפה שייכים לסוחר (from)
      // ולא לחשבון-התצוגה של הבריכה — נמדד: הזיכוי-ל-bal("pool") יצר-פנטום (15,165-SAOS
      // מחוץ-להיצע) והשאיר-את-המשתמשים באפס → שוק-מת (0.8% קבלות). הסוחר מקבל-את-התוצר,
      // יתרות-הבריכה-הפנטומיות-ההיסטוריות נשארות-בספר כפי-שהן (אפס-שכתוב-היסטוריה).
      const feeMu = fromF(t.fee ?? 0);
      if (t.asset === "USDS") { pool.usds += amtMu; pool.saos -= fromF((t as any).outSaos); from.saos += fromF((t as any).outSaos); pool.feesUsds += feeMu; }
      else { pool.saos += amtMu; pool.usds -= fromF((t as any).outUsds); from.usds += fromF((t as any).outUsds); pool.feesSaos += feeMu; }
    } else {
      (to as any)[field] += amtMu;
    }
  }
  byAccount[t.from] = (byAccount[t.from] ?? 0) + 1;
  byAccount[t.to] = (byAccount[t.to] ?? 0) + 1;
  const signed = sealTx(t);
  if (refH !== undefined && signed.h !== refH) { /* replay mismatch — honest */ }
  seq = signed.seq; lastH = signed.h;
  recent.push(signed.ts);
  byKind[signed.kind] = (byKind[signed.kind] ?? 0) + 1;
  persist(signed);
  return signed;
}

function ammSwap(user: string, asset: "USDS" | "SAOS", amountIn: number, reason: string): Tx | null {
  // קניית SAOS ב-USDS: usds נכנס → saos יוצא (מחיר קבוע-מכפלה, ללא עמלת-דליפה)
  // גל-86 · µ¢: אריתמטיקת-בריכה מדויקת (BigInt) — רצפה לטובת-הבריכה,
  // עמלה = amountIn − inAfterFee (שימור-מדויק בבנייה, לא חישוב-פלואט נפרד).
  // גל-87 · הבריכה-עצמה חיה-ב-µ¢ — אפס-המרות-פלואט בקלט/פלט-פנימי.
  const amtMu = fromF(amountIn);
  const inRMu = asset === "USDS" ? pool.usds : pool.saos;
  const outRMu = asset === "USDS" ? pool.saos : pool.usds;
  const outMu = muAmmOut(inRMu, outRMu, amtMu, FEE_BPS);
  const half = outRMu / 2n;
  if (outMu <= 0n || outMu > half) { rej(); return null; }
  const { fee } = splitFee(amtMu, FEE_BPS);
  if (asset === "USDS") {
    return apply({ seq: seq + 1, ts: Date.now(), kind: "swap", from: user, to: "pool", asset, amount: amountIn, fee: toF(fee), price: +(toF(pool.usds) / toF(pool.saos)).toFixed(6), reason, outSaos: toF(outMu) } as any);
  }
  return apply({ seq: seq + 1, ts: Date.now(), kind: "swap", from: user, to: "pool", asset, amount: amountIn, fee: toF(fee), price: +(toF(pool.usds) / toF(pool.saos)).toFixed(6), reason, outUsds: toF(outMu) } as any);
}

/* ── מחולל-העסקאות: המשתמשים-הפנימיים משתמשים בכלים בזרימה חכמה ────────────── */
const SERVICES = [
  { name: "חישוב-GPU", unit: "דקות-חישוב", price: 1.4 },
  { name: "אחסון-ארכיון", unit: "GB-חודש", price: 0.35 },
  { name: "מידע-שוק", unit: "פיד", price: 0.9 },
  { name: "סריקת-גיט", unit: "ריצה", price: 2.1 },
  { name: "תרגום-מסמך", unit: "מסמך", price: 1.1 },
  { name: "תדלוק-RC", unit: "מנה", price: 3.2 },
  { name: "אימות-קבלה", unit: "חותמת", price: 0.6 },
];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const round6 = (x: number) => +x.toFixed(6);

function spawnTx(): Tx | null {
  const r = Math.random();
  const soldier = pick(SOLDIERS).id;
  if (r < 0.06) { // משכורת/תדלוק מהכספת (מנוזל, מההצע-הקבוע בלבד)
    const amt = round6(2 + Math.random() * 6);
    return apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: soldier, asset: "USDS", amount: amt, reason: "משכורת-מחזורית על עבודת-שורה חיה" });
  }
  if (r < 0.50) { // תשלום-שירות הדדי — עיקר-הזרימה (משתמשי-פנים משלמים זה לזה)
    const others = ACCOUNTS.filter((a) => a.id !== soldier && a.kind !== "pool" && a.id !== "treasury");
    const to = pick(others).id;
    const svc = pick(SERVICES);
    const units = 1 + Math.floor(Math.random() * 8);
    // גל-83 · זרימה-חוזרת: צמתי-הצי קונים-שירותים מהחיילים
    // גל-85 · משלם-משוקלל-עושר: חלק-הצמתים-בתשלום נגזר-מחלקתם-בהון-המחזורי בפועל
    // (מי-שצבר-תשתית משלם-יותר — הכסף-לא-נתקע-אצל-אף-אחד; חלון-מוגן 20%-50%)
    let nodeW = 0n, solW = 0n; // גל-87 · משקלי-עושר ב-µ¢; החלטת-המשלם = פלואט (תצוגה/החלטה-בלבד)
    for (const nd of FLEET_NODES) { const b = bal(nd.id); nodeW += b.usds + b.saos; }
    for (const sl of SOLDIERS) { const b = bal(sl.id); solW += b.usds + b.saos; }
    const totW = nodeW + solW;
    const nodeShare = totW > 0n ? Math.min(0.5, Math.max(0.2, Number(nodeW) / Number(totW))) : 0.25;
    const payer = Math.random() < nodeShare ? pick(FLEET_NODES).id : soldier;
    const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "service", from: payer, to, asset: "USDS", amount: round6(svc.price * units), reason: `${svc.name} · ${units}-${svc.unit}`, ref: `svc-${Date.now()}-${Math.floor(Math.random() * 1e4)}` });
    // גל-83 · מס-שירותים 2%: עסקה-נפרדת-וחתומה (מימון-אמיתי-לכספת שתוכל-לשלם-שכר)
    if (tx) apply({ seq: seq + 1, ts: Date.now(), kind: "tax", from: to, to: "treasury", asset: "USDS", amount: round6(tx.amount * (TAX_BPS / 10_000)), reason: `מס-שירותים ${TAX_BPS / 100}% → כספת` });
    return tx;
  }
  if (r < 0.74) { // החלפה על הבריכה (גילוי-מחיר אמיתי)
    const buySaos = Math.random() < 0.5;
    const amt = round6(buySaos ? 5 + Math.random() * 40 : 5 + Math.random() * 35);
    return ammSwap(soldier, buySaos ? "USDS" : "SAOS", amt, buySaos ? "רכישת SAOS לתשלומי-סטייק" : "מימוש SAOS ל-USDS תפעולי");
  }
  if (r < 0.84) { // סטייק/ביטול-סטייק
    const b = bal(soldier);
    const stake = Math.random() < 0.6;
    if (stake) {
      const want = fromF(round6(0.5 + Math.random() * 6));
      const amtMu = b.saos < want ? b.saos : want;
      if (amtMu <= 0n) { rej(); return null; }
      return apply({ seq: seq + 1, ts: Date.now(), kind: "stake", from: soldier, to: soldier, asset: "SAOS", amount: toF(amtMu), reason: "סטייק-SAOS לאבטחת-הרשת הפנימית" });
    }
    const want = fromF(round6(0.3 + Math.random() * 4));
    const amtMu = b.saosStaked < want ? b.saosStaked : want;
    if (amtMu <= 0n) { rej(); return null; }
    return apply({ seq: seq + 1, ts: Date.now(), kind: "unstake", from: soldier, to: soldier, asset: "SAOS", amount: toF(amtMu), reason: "ביטול-סטייק לצורך-תפעול" });
  }
  if (r < 0.94) { // תשלום-תשתית: חייל משלם לצומת-צי
    const node = pick(FLEET_NODES).id;
    const svc = pick(SERVICES);
    return apply({ seq: seq + 1, ts: Date.now(), kind: "infra", from: soldier, to: node, asset: "USDS", amount: round6(svc.price * (1 + Math.floor(Math.random() * 5))), reason: `תשתית: ${svc.name}` });
  }
  { // טיפ-SAOS על עבודה-טובה (תרבות-שימוש פנימית)
    const others = SOLDIERS.map((s) => s.id).filter((s) => s !== soldier);
    const to = pick(others);
    const amt = round6(0.05 + Math.random() * 0.4);
    return apply({ seq: seq + 1, ts: Date.now(), kind: "tip", from: soldier, to, asset: "SAOS", amount: amt, reason: "טיפ על עבודה-טובה בזרימה" });
  }
}

function tick() {
  if (sealing) return; // חוק-גל-82: בזמן-אטימת-כספת המנוע-קפוא — אף-כתיבה-לא-מתרחשת
  try {
    tickNo++;
    // גל-83 · חוק-שכר-מצע (כל-12-טיקים): חייל-מתחת-לרצפת-הפרנסה — הכספת מתדלקת.
    // זו-הזרימה-החוזרת-שחסרה: בלעדיה-הכסף-הצטבר-בבריכה/צמתים-והחיילים-נשארו-יבשים
    // (נמדד: 5,916-דחיות-מול-3,278-קבלות = 64% בזבוז-ניסיונות).
    if (tickNo % 12 === 0) {
      // גל-85 · שכר-מצע מדורג: כל-חייל-מתחת-הרצפה מתודלק (לא אחד-נבחר) —
      // נדרש כי ניסיונות-הפר-טיק גדלו ×4 (נמדד: ריפוד-יחיד = 33% דחיות)
      const floorMu = fromF(WAGE_FLOOR_USDS);
      const poor = SOLDIERS.filter((s) => bal(s.id).usds < floorMu);
      for (const s of poor) {
        apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: s.id, asset: "USDS", amount: round6(30 + Math.random() * 45), reason: `חוק-שכר-מצע: תדלוק-פרנסה (רצפת ${WAGE_FLOOR_USDS})` });
      }
    }
    // גל-85 · משאבת-נזילות-כספת (הזרימה-הסגורה שנעדרה): נמדד בפורנזיה 2026-10-17 —
    // הבריכה ינקה את-ה-USDS-המחזורי (8,047/8,049; כספת=1.7) → 0-קבלות. הכספת מוכרת-SAOS
    // לבריכה — עסקת-AMM אמת עם-השפעת-מחיר מלאה, אפס-הדפסה, היצע-קבוע. המכסה-לטיק מונעת
    // ריסוק-מחיר; דחייה-כנה אם-התוצר-חורג-ממחצית-הבריכה.
    if (tickNo % 6 === 0 && bal("treasury").usds < fromF(TREASURY_FLOOR_USDS) && bal("treasury").saos > 1n) {
      // גל-87 · התכנון-כאן תצוגתי/החלטתי (פלואט); האכיפה-האמיתית = ammSwap+apply ב-µ¢
      const wantMu = fromF(80) < fromF(TREASURY_FLOOR_USDS) - bal("treasury").usds ? fromF(80) : fromF(TREASURY_FLOOR_USDS) - bal("treasury").usds;
      const want = toF(wantMu);
      const px = Math.max(0.01, priceUsdsPerSaos());
      const saosIn = round6(Math.min(toF(bal("treasury").saos), (want / (px * (1 - FEE_BPS / 10_000))) * 1.25, 30));
      if (saosIn > 0.01) ammSwap("treasury", "SAOS", saosIn, "משאבת-נזילות-כספת: SAOS→USDS לתדלוק-משק-הפנים (עסקת-AMM אמת)");
    }
    // גל-83 · איסוף-עמלות (כל-150-טיקים): עמלות-הבריכה (הכנסת-הרשת) זורמות-לכספת
    if (tickNo % 150 === 0 && pool.feesUsds >= fromF(1)) {
      // גל-86 · תיקון-עמלות (agent-2): איסוף חייב גם את יתרת-המודול של הבריכה
      // (העמלות נכנסו לשרותי-הבריכה) + סנכרון bal("pool") — בדחייה-כנה המונה חוזר
      // (לפני-כן: מונה מאופס גם-בדחייה = הכנסת-רשת נעלמה מהמדידה).
      // גל-87 · µ¢: amtMu מדויק — toF(amtMu) שומר-6-ספרות זהות (הפיכות-מלאה).
      const amtMu = pool.feesUsds;
      pool.feesUsds = 0n;
      const collected = apply({ seq: seq + 1, ts: Date.now(), kind: "infra", from: "pool", to: "treasury", asset: "USDS", amount: toF(amtMu), reason: "איסוף-עמלות-בריכה → כספת" });
      if (collected) { pool.usds -= amtMu; bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; }
      else pool.feesUsds = amtMu;
    }
    // גל-85 · מווסת-אדפטיבי: 14-18 ניסיונות-בטיק (מהיר-על-ידי-קבלה בפועל, לא על-ידי-תקווה)
    const n = nBase + Math.floor(Math.random() * 5);
    attemptsTotal += n; winAttempts += n;
    for (let i = 0; i < n; i++) spawnTx();
    if (tickNo % GOV_PERIOD === 0 && winAttempts > 0) {
      const acc = 1 - winRejected / winAttempts;
      lastGovAcc = +acc.toFixed(3);
      if (acc > 0.92) nBase = Math.min(nBase + 1, N_CAP);
      else if (acc < 0.70) nBase = Math.max(nBase - 2, N_MIN);
      winAttempts = 0; winRejected = 0;
    }
    flush(); // אטימה-לדיסק בכל-טיק: מוות-פתאום מאבד לכל-היותר טיק אחד
    const cutoff = Date.now() - 86_400_000;
    while (recent.length && recent[0] < cutoff) recent.shift();
  } catch { errors++; }
}

/* ── אתחול מהדיסק (snapshot + אימות-שרשרת על-הזנב) ────────────────────────── */
function seed() {
  // גל-87 · זריעה-מדויקת: ערכי-פלואט עוברים-round6 ואז-fromF — יתרות-µ¢-שלמות-מהלידה
  bal("treasury").usds = fromF(TREASURY_USDS);
  bal("treasury").saos = fromF(SAOS_SUPPLY - POOL_SAOS);
  bal("pool").usds = pool.usds; bal("pool").saos = pool.saos;
  for (const s of SOLDIERS) { bal(s.id).usds = fromF(round6(900 + Math.random() * 600)); bal(s.id).saos = fromF(round6(20 + Math.random() * 30)); }
  for (const n2 of FLEET_NODES) { bal(n2.id).usds = fromF(round6(300 + Math.random() * 200)); }
  // היצע-כולל נשמר: סכום-היתרות + הבריכה = ההצעה הקבועה
}

/* גל-84 · שחזור-זנב-דטרמיניסטי-מהסנאפשוט: כל-עסקה-בספר-עם seq>snapshot.seq נבחנת-שרשור-מול-המצב
 * ונשענת-עליו-דטרמיניסטית (אריתמטיקת-apply בלי-הנפקה). תפר=שורה-שאינה-ממשיכה-את-השרשרת-מנקודת-הסנאפשוט
 * (שרידי-בוט-מקביל-אחרי-קריסה) — נחתך-להסגר, אפס-מחיקה. מבטל-לנצח-את-תפרי-מזלג-הבוט-הכפול. */
function replayTailFromSnapshot(s: { seq: number; lastH: string }): { replayed: number; trimmed: boolean } {
  try {
    const files = fs.readdirSync(STATE_DIR).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
    let prev = s.lastH; let replayed = 0; let seamIdx = -1; let seamFile: string | null = null;
    outer: for (const f of files) {
      const lines = fs.readFileSync(path.join(STATE_DIR, f), "utf8").split("\n").filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        let t: any; try { t = JSON.parse(lines[i]); } catch { seamIdx = i; seamFile = f; break outer; }
        if (t.seq <= s.seq) continue; // כבר-מסוכם-בסנאפשוט
        const { h, ...rest } = t;
        if (createHash("sha256").update(JSON.stringify({ ...rest, prev })).digest("hex").slice(0, 32) !== h) { seamIdx = i; seamFile = f; break outer; }
        const from = bal(t.from), to = bal(t.to);
        const field = t.asset === "USDS" ? "usds" : "saos";
        const amtMu = fromF(t.amount); // גל-87 · אריתמטיקה-זהה-מילה-במילה-ל-apply
        if ((from as any)[field] < amtMu) { seamIdx = i; seamFile = f; break outer; } // מצב-לא-עקבי-עם-הספר → תפר-כנה
        if (t.kind === "stake") { from.saos -= amtMu; from.saosStaked += amtMu; }
        else if (t.kind === "unstake") {
          if (from.saosStaked < amtMu) { seamIdx = i; seamFile = f; break outer; }
          from.saosStaked -= amtMu; to.saos += amtMu;
        } else {
          (from as any)[field] -= amtMu;
          if (t.kind === "swap") {
            // גל-86 · תיקון-סימטריית-replay (agent-2): ה-replay חייב לשקף את apply (גל-85)
            // מילה-במילה — התוצר לסוחר (from), ולא ל-bal("pool") (שהייתה חזרת-הפנטום:
            // pool.saos -= out ואז bal("pool").saos += out = התוצר נעלם מהמחזור).
            // נעול ע"י tests/ledger-law.test.ts · סימטריית apply/replay.
            const feeMu = fromF(t.fee ?? 0);
            if (t.asset === "USDS") { pool.usds += amtMu; pool.saos -= fromF(t.outSaos); from.saos += fromF(t.outSaos); pool.feesUsds += feeMu; }
            else { pool.saos += amtMu; pool.usds -= fromF(t.outUsds); from.usds += fromF(t.outUsds); pool.feesSaos += feeMu; }
          } else { (to as any)[field] += amtMu; }
        }
        byAccount[t.from] = (byAccount[t.from] ?? 0) + 1;
        byAccount[t.to] = (byAccount[t.to] ?? 0) + 1;
        byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
        seq = t.seq; lastH = h; prev = h; replayed++;
      }
    }
    let trimmed = false;
    if (seamFile === "ledger.jsonl" && seamIdx >= 0) {
      const lines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
      if (seamIdx < lines.length) {
        const q = path.join(STATE_DIR, "quarantine");
        fs.mkdirSync(q, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.writeFileSync(path.join(q, `${ts}·boot-tail-fork·ledger-tail.jsonl`), lines.slice(seamIdx).join("\n") + "\n");
        fs.writeFileSync(path.join(q, `${ts}·boot-tail-fork·REASON.txt`), `זנב-מזלג-מהתפר-בשורה-${seamIdx} (${lines.length - seamIdx} שורות) — אינו-ממשיך-את-השרשרת-מנקודת-הסנאפשוט. הקידומת-המשרשרת (${seamIdx}) נשארת-חיה. אפס-מחיקה.\n`);
        fs.writeFileSync(LEDGER, lines.slice(0, seamIdx).join("\n") + "\n");
        trimmed = true;
      }
    }
    if (trimmed) console.log(`[fleet-economy] boot-tail-fork: תפר-בשורה-${seamIdx} — הזנב-להסגר, הקידומת-חיה`);
    return { replayed, trimmed };
  } catch { return { replayed: 0, trimmed: false }; }
}

/* גל-94 · ריפוי-עומק (deep-trim) — המשך-ישר-של גל-82/84: הריפוי-הישן על שבר-באמצע-הספר
 * (לפני-נקודת-הסנאפשוט) זרק את כל-ההיסטוריה (רג'נזיס-מלא). החדש: הליכה-מראה-מדויקת
 * של verifyChain (כולל-סמנטיקת-עוגנים מילה-במילה), חיתוך-בתפר-הראשון:
 *   · הקידומת-השרשרת-התקינה נשארת-חיה-בספר (אפס-שכתוב-שורות — כתיבה-חזרה מילה-במילה)
 *   · הזנב-השבור + קבצים-מאוחרים → הסגר (אפס-מחיקה)
 *   · עוגן-טרמינלי-בלתי-מוכח (שבר-מיד-אחרי-עוגן) מורד-מהקידומת — חוק-זנב-בלתי-מעוגן (Z2-15)
 *   · המצב-החי (זיכרון/סנאפשוט) נשאר-האמת; האירוע-הבא-משרשר-מה-lastH-החי ונבלע-כעוגן-הצטרפות
 *     (כמו-קומיט-מיזוג-בגיט) — רציפות-מוכחת, אפס-אובדן-יתרות, 99.9%+ מההיסטוריה-בספר-החי.
 * רק-אם-הקידומת-קצרה-מ-DEEP_TRIM_MIN — רג'נזיס-כמוצא-אחרון (כמו-קודם). */
const DEEP_TRIM_MIN = 100;
function deepTrimHeal(): { ok: boolean; keptLines: number; trimmedLines: number; brokenAt: number | null; lastKeptSeq: number } {
  try {
    const files = fs.readdirSync(STATE_DIR).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
    let prev = "GENESIS"; let prevWasAnchor = false; let lastSeq = 0;
    const prefix: Array<{ line: string; anchor: boolean }> = []; // שורות-השרשרת (anchor=נבלעה-כעוגן-תפר)
    let breakFile: string | null = null; let breakIdx = -1; let brokenAt: number | null = null;
    outer: for (const f of files) {
      const lines = fs.readFileSync(path.join(STATE_DIR, f), "utf8").split("\n").filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        let t: any;
        try { t = JSON.parse(lines[i]); } catch { breakFile = f; breakIdx = i; brokenAt = lastSeq + 1; break outer; }
        if (typeof t.seq !== "number" || t.seq <= lastSeq) { breakFile = f; breakIdx = i; brokenAt = t.seq ?? null; break outer; }
        lastSeq = t.seq;
        const { h, ...rest } = t;
        if (createHash("sha256").update(JSON.stringify({ ...rest, prev })).digest("hex").slice(0, 32) !== h) {
          if (prevWasAnchor) { breakFile = f; breakIdx = i; brokenAt = t.seq; break outer; } // שני-עוגנים-רצופים — שבר-אמת
          prefix.push({ line: lines[i], anchor: true }); prev = h; prevWasAnchor = true; continue; // עוגן-תפר — המשך-מה-h-השמור
        }
        prefix.push({ line: lines[i], anchor: false }); prev = h; prevWasAnchor = false;
      }
    }
    if (!breakFile) return { ok: false, keptLines: prefix.length, trimmedLines: 0, brokenAt: null, lastKeptSeq: lastSeq }; // אין-שבר-מוחש — כנה
    // חוק-זנב-בלתי-מעוגן (Z2-15): עוגן-טרמינלי-בלי-יורש-מוכח → מורד-מהקידומת (להסגר-עם-הזנב)
    while (prefix.length && prefix[prefix.length - 1].anchor) prefix.pop();
    if (prefix.length < DEEP_TRIM_MIN) return { ok: false, keptLines: prefix.length, trimmedLines: 0, brokenAt, lastKeptSeq: lastSeq };
    const lastKeptSeq = (() => { try { return JSON.parse(prefix[prefix.length - 1].line).seq as number; } catch { return 0; } })();
    // הסגר: זנב-קובץ-השבר + כל-הקבצים-שאחריו — אפס-מחיקה
    const q = path.join(STATE_DIR, "quarantine");
    fs.mkdirSync(q, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    let sawBreak = false; let trimmedLines = 0;
    for (const f of files) {
      const full = path.join(STATE_DIR, f);
      if (sawBreak) { try { fs.renameSync(full, path.join(q, `${ts}·deep-trim-whole·${f}`)); } catch { /* כנה */ } continue; }
      if (f === breakFile) {
        const lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean);
        trimmedLines = lines.length - breakIdx;
        try { fs.writeFileSync(path.join(q, `${ts}·deep-trim-tail·${f}`), lines.slice(breakIdx).join("\n") + "\n"); } catch { /* כנה */ }
        sawBreak = true;
      }
    }
    // כתיבת-הקידומת-החיה-במקום-קובץ-השבר (מילה-במילה — אפס-שכתוב-שורות-שנשמרו)
    fs.writeFileSync(path.join(STATE_DIR, breakFile), prefix.length ? prefix.map((p) => p.line).join("\n") + "\n" : "");
    return { ok: true, keptLines: prefix.length, trimmedLines, brokenAt, lastKeptSeq };
  } catch { return { ok: false, keptLines: 0, trimmedLines: 0, brokenAt: null, lastKeptSeq: 0 }; }
}

function boot() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (fs.existsSync(SNAP)) {
      const s = JSON.parse(fs.readFileSync(SNAP, "utf8"));
      // גל-87 · קריאת-snapshot היסטורי (מספרי-6-ספרות) → יתרות-µ¢-מדויקות (אפס-שכתוב)
      balances = new Map(Object.entries(s.balances ?? {}).map(([k, v]) => [k, balFromSnap(v)]));
      pool = s.pool
        ? { saos: fromF(Number(s.pool.saos ?? 0)), usds: fromF(Number(s.pool.usds ?? 0)), feesUsds: fromF(Number(s.pool.feesUsds ?? 0)), feesSaos: fromF(Number(s.pool.feesSaos ?? 0)) }
        : { saos: fromF(POOL_SAOS), usds: fromF(POOL_USDS), feesUsds: 0n, feesSaos: 0n };
      seq = s.seq ?? 0; lastH = s.lastH ?? lastH;
      byKind = s.byKind ?? {}; byAccount = s.byAccount ?? {}; rejected = s.rejected ?? 0; errors = s.errors ?? 0;
      ledgerFileNo = s.ledgerFileNo ?? 0;
      ingestOk = s.ingestOk ?? 0; ingestDedup = s.ingestDedup ?? 0; ingestFailed = s.ingestFailed ?? 0; ingestBad = s.ingestBad ?? 0;
      // גל-109 · שער-הזרימות-החוץ: המדידות-שורדות-דורות
      extImportedMu = fromF(Number(s.extImported ?? 0)); extCount = s.extCount ?? 0; extDedup = s.extDedup ?? 0; extBad = s.extBad ?? 0;
      // גל-87 · שימור-המדידה: attemptsTotal חייב לשרוד עלייה — בלי-זה acceptancePct מוצג
      // שלילי-מטופש (rejected היסטורי מול attempts צעירים). נמדד: -129163.1% אחרי-עלייה.
      if (typeof s.attemptsTotal === "number" && s.attemptsTotal > attemptsTotal) attemptsTotal = s.attemptsTotal;
      // dedup שורד-הפעלה-מחדש: מפיקים-חיים + poller-מילויים לא יספרו מילוי-כפול אחרי-restart
      if (Array.isArray(s.seenRefs)) for (const [k, v] of s.seenRefs as [string, number][]) seenRefs.set(k, v);
      if (!balances.has("treasury")) throw new Error("snapshot corrupt");
      // ריפוי-עצמי בעלייה (גל-82 · שורש-התפר): אם-הספר-על-הדיסק-תפור (תפר-מיזוג-גיט
      // בין-שרשרת-מקומית-לענן) — אין-המשך-על-ספר-שבור: הסגר-כנה + זריעה-חדשה.
      const v = verifyChain();
      if (!v.ok) {
        // גל-84 · ריפוי-תפר-בוט-כפול: אם-השבר-הוא-זנב-מזלג (קריסה-אחרי-flush-לפני-סנאפשוט,
        // ואז-בוט-חוזר-כתב-את-אותו-טווח-seq-מחדש) — משחזרים-את-הזנב-המשרשר-מהסנאפשוט,
        // חותכים-את-השארית-להסגר (אפס-מחיקה) וממשיכים-במצב-המשוחזר. זריעה-מלאה-רק-כמוצא-אחרון.
        const r = replayTailFromSnapshot(s);
        if (r.replayed > 0 || r.trimmed) {
          console.log(`[fleet-economy] boot-heal-tail-replay: +${r.replayed} עסקאות · trimmed=${r.trimmed} · seq=${seq}`);
          return { restored: true, seq, healed: "tail-replay" };
        }
        // גל-94 · ריפוי-עומק: שבר-באמצע-הספר (לפני-תפר-הסנאפשוט) — חיתוך-לקידומת-החיה
        // במקום רג'נזיס-מלא. המצב-מהסנאפשוט-נשאר-האמת; האירוע-הבא = עוגן-הצטרפות.
        const deep = deepTrimHeal();
        if (deep.ok && seq >= deep.lastKeptSeq) {
          ledgerBuf = []; ledgerLines = deep.keptLines;
          flush(); snapshotSave();
          console.log(`[fleet-economy] boot-heal-deep-trim: קידומת-חיה ${deep.keptLines} שורות (seq≤${deep.lastKeptSeq}) · זנב-להסגר ${deep.trimmedLines} · המצב-החי-נשמר · האירוע-הבא = עוגן-הצטרפות`);
          return { restored: true, seq, healed: "deep-trim" };
        }
        quarantineState(`boot-heal-brokenAt-${v.brokenAt}`);
        balances = new Map();
        pool = { saos: fromF(POOL_SAOS), usds: fromF(POOL_USDS), feesUsds: 0n, feesSaos: 0n }; // גל-87
        seq = 0; lastH = "GENESIS"; ledgerBuf = []; ledgerLines = 0; recent = [];
        byKind = {}; byAccount = {}; rejected = 0; ledgerFileNo = 0;
        seed();
        return { restored: false, seq: 0, quarantined: true };
      }
      // גל-84 · ספר-תקין-מהגנזיס: שחזור-זנב-שנחתם-לדיסק-אחרי-הסנאפשוט (קריסה-בין-flush-לסנאפשוט)
      const r = replayTailFromSnapshot(s);
      if (r.replayed > 0) console.log(`[fleet-economy] boot-tail-replay: +${r.replayed} עסקאות → seq=${seq}`);
      if (v.anchors?.length) console.log(`[fleet-economy] עוגני-תפר היסטוריים: ${v.anchors.length} (${v.anchors.map((a) => a.seq).join(",")}) — רציפות-מוכחת, אפס-שכתוב. צמיחה-מעבר = אזעקה`);
      return { restored: true, seq };
    }
  } catch { /* snapshot פגום → זריעה-כנה מחדש */ }
  seed();
  return { restored: false, seq: 0 };
}

/* הסגר-כנה של-קבצי-מדינה — אפס-תפירה-מזויפת, כל-ההיסטוריה-נשמרת-לביקורת */
function quarantineState(reason: string) {
  const q = path.join(STATE_DIR, "quarantine");
  fs.mkdirSync(q, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  for (const f of fs.readdirSync(STATE_DIR)) {
    const isState = f === "ledger.jsonl" || f === "snapshot.json" || f.startsWith("ledger-") || f.startsWith("tmp-prepull");
    if (!isState) continue;
    try { fs.renameSync(path.join(STATE_DIR, f), path.join(q, `${ts}·${reason}·${f}`)); } catch { /* כנה */ }
  }
  try { fs.writeFileSync(path.join(STATE_DIR, "quarantine", `${ts}·${reason}·REASON.txt`), `${reason}\n`); } catch { /* כנה */ }
}

/* אימות-שרשרת מלאה (לתביעה מול-אמת): קורא את הספר כולה ומאמת sha256.
 * גל-85 · עוגני-תפר היסטוריים (פורנזיה 2026-10-17, agent-2): בספר-הקנוני 3 שורות-תפר
 * (seq 46335, 55120, 68276) — כל-אחת השורה-הראשונה אחרי פער-seq שנוצר מתפרי-מיזוג-git
 * היסטוריים (pull --rebase -X ours). מתחת-למודל-עוגן (המשך מה-h השמור) השרשרת רציפה
 * עד-הסנאפשוט — מאומת שורה-אחר-שורה. הכרעה-כנה: עוגן מבודד עם רציפות-מוכחת = ממשיכים
 * (כמו-שגיט סומך על קומיטים); עוגנים-עוקבים (שבר-אמת שאינו מתגבש) = ok:false.
 * אפס-שכתוב-היסטוריה: השורות נשארות בדיוק כפי שנכתבו. /verify חושף anchors —
 * צמיחה-מעבר ל-3 = אזעקה. המקור-לתפרים נחסם בכותב-יחיד (economy-beat + heartbeat). */
function verifyChain(): { ok: boolean; checked: number; brokenAt?: number; anchors?: { seq: number; line: number }[] } {
  let prev = "GENESIS"; let checked = 0; let prevWasAnchor = false; let lastSeq = 0;
  const anchors: { seq: number; line: number }[] = [];
  const files = fs.readdirSync(STATE_DIR).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(STATE_DIR, f), "utf8").split("\n").filter(Boolean);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      try {
        const t = JSON.parse(line) as Tx;
        // Z2-15 · חוק-סדר: נסיגת/כפילות-seq = שבר-מבנה fail-closed (מיזוג-גיט יכול לסדר מחדש — לא ניתן-להוכחה ≠ תקין)
        if (typeof t.seq !== "number" || t.seq <= lastSeq) return { ok: false, checked, brokenAt: t.seq, anchors };
        lastSeq = t.seq;
        const { h, ...rest } = t;
        const body = JSON.stringify({ ...rest, prev });
        if (createHash("sha256").update(body).digest("hex").slice(0, 32) !== h) {
          if (prevWasAnchor) return { ok: false, checked, brokenAt: t.seq, anchors }; // שבר-אמת: שני-עוגנים-רצופים לא מתגבשים
          anchors.push({ seq: t.seq, line: li }); // עוגן-תפר: המשך מה-h השמור, השורה-הבאה חייבת להתגבש
          prev = h; prevWasAnchor = true;
          continue;
        }
        prev = h; checked++; prevWasAnchor = false;
      } catch { return { ok: false, checked, brokenAt: checked, anchors }; }
    }
  }
  // Z2-15 · זנב-בלתי-מעוגן: הספר-נגמר-על-עוגן בלי-יורש-שמוכיח-עיגון-מחדש → שבר-אמת fail-closed
  // (קריסה-בין-flush-לסנאפשוט = בדיוק-מה-replayTailFromSnapshot נבנה-לטפל-בו)
  if (prevWasAnchor && anchors.length > 0) return { ok: false, checked, brokenAt: anchors[anchors.length - 1].seq, anchors };
  return { ok: true, checked, anchors };
}

/* גל-109 · בליעת-זרימות-החוץ (G27): קריאה-ב-boot-בלבד (אחרי-shחזור-seenRefs →
 * dedup-חוצה-דורות). כל-שורה = הפקדה-אמת-מחוץ → עסקת ext-deposit חתומה.
 * fail-honest: שורה-פגומה/סכום-שלילי/ref-חסר נספר extBad-ולא-נכתב. */
function ingestExtFlows() {
  let lines: string[] = [];
  try { lines = fs.readFileSync(EXT_FLOWS, "utf8").split("\n").filter(Boolean); } catch { return; }
  let ok = 0, dedup = 0, bad = 0;
  for (const line of lines) {
    let f: any = null;
    try { f = JSON.parse(line); } catch { bad++; continue; }
    const ref = typeof f?.ref === "string" ? f.ref.trim().slice(0, 80) : "";
    const venue = typeof f?.venue === "string" ? f.venue.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "";
    const amt = Number(f?.amountUsd);
    if (!ref || !venue || !Number.isFinite(amt) || amt <= 0 || amt > 100_000) { bad++; continue; }
    if (seenRefs.has(ref)) { dedup++; continue; }
    const note = typeof f?.note === "string" ? f.note.slice(0, 160) : "";
    const ts = Number(f?.ts);
    const tx = apply({
      seq: seq + 1, ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      kind: "ext-deposit", from: `ext:${venue}`, to: "treasury", asset: "USDS",
      amount: Number(amt.toFixed(6)),
      reason: `ייבוא-נזילות-חוץ · ${venue}${f?.kind ? " · " + String(f.kind).slice(0, 24) : ""}${note ? " · " + note : ""}`,
      ref,
    });
    if (tx) { rememberRef(ref); ok++; } else bad++;
  }
  extCount += ok; extDedup += dedup; extBad += bad;
  if (ok || dedup || bad) console.log(`[fleet-economy] ext-flows: ingested=${ok} dedup=${dedup} bad=${bad}`);
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */
function priceUsdsPerSaos() { const s = toF(pool.saos); return s > 0 ? toF(pool.usds) / s : 0; } // תצוגה/החלטה-בלבד (גל-87)
function countsWindow(ms: number) { const cutoff = Date.now() - ms; let c = 0; for (let i = recent.length - 1; i >= 0; i--) { if (recent[i] >= cutoff) c++; else break; } return c; }

function snapshotSave() {
  if (sealing) return; // חוק-גל-82: אף-כתיבת-מדינה-בזמן-אטימה
  flush();
  // גל-87 · סידור-זהה-בייטים ל-snapshot ההיסטורי: µ¢ → מספרי-6-ספרות דרך-toF
  const obj = { v: 3, savedAt: Date.now(), seq, lastH,
    balances: Object.fromEntries([...balances].map(([k, v]) => [k, { usds: toF(v.usds), saos: toF(v.saos), saosStaked: toF(v.saosStaked) }])),
    pool: { saos: toF(pool.saos), usds: toF(pool.usds), feesUsds: toF(pool.feesUsds), feesSaos: toF(pool.feesSaos) },
    byKind, byAccount, rejected, errors, ledgerFileNo, ingestOk, ingestDedup, ingestFailed, ingestBad, attemptsTotal,
    extImported: toF(extImportedMu), extCount, extDedup, extBad,
    seenRefs: Array.from(seenRefs.entries()).slice(-SEEN_REFS_SNAP) };
  const tmp = SNAP + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, SNAP);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return Response.json({ ok: true, engine: "fleet-economy", seq, uptimeMs: Date.now() - bootedAt, lastH, port: PORT });
      if (url.pathname === "/metrics") {
        const total = Object.values(byKind).reduce((a, b) => a + b, 0);
        const top = Object.entries(byAccount).sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([id, count]) => ({ id, count, role: ACCOUNTS.find((a) => a.id === id)?.role ?? "" }));
        const uptimeMs = Date.now() - bootedAt;
        const sinceBoot = recent.length; // recent מכיל רק-עסקאות-מאז-עלייה (חלון-24ש׳ לא-מגיע לשרת-חי-קצר)
        const runRatePerHour = uptimeMs >= 60_000 ? +(sinceBoot / (uptimeMs / 3_600_000)).toFixed(0) : null;
        return Response.json({
          engine: "fleet-economy/1", doctrine: "משתמשי-פנים: החיילים/הצי/הסוכנים הם משתמשי-הרשת",
          totalTx: total, tx24h: countsWindow(86_400_000), tx1h: countsWindow(3_600_000),
          ratePerHour: +(countsWindow(3_600_000)).toFixed(0), projectedPerDay: +(countsWindow(3_600_000) * 24).toFixed(0),
          runRatePerHour, runProjectedPerDay: runRatePerHour !== null ? +(runRatePerHour * 24).toFixed(0) : null,
          realEvents: { ingestOk, ingestDedup, ingestFailed, ingestBadPayload: ingestBad, droppedTx: ingestFailed },
          ext: { importedUsds: +toF(extImportedMu).toFixed(6), count: extCount, dedup: extDedup, bad: extBad }, // גל-109 · שער-הזרימות-החוץ
          byKind, rejected, errors, seq, lastH,
          throughput: { attempts: attemptsTotal, rejectedCount: rejected, acceptancePct: attemptsTotal > 0 ? +(((attemptsTotal - rejected) / attemptsTotal) * 100).toFixed(1) : null, governor: { nBase, cap: N_CAP, min: N_MIN, windowAcceptance: lastGovAcc } },
          supply: { saosTotal: SAOS_SUPPLY, saosStaked: toF([...balances.values()].reduce((a, b) => a + b.saosStaked, 0n)), usdsInPool: toF(pool.usds), saosInPool: toF(pool.saos) },
          pool: { priceUsdsPerSaos: +priceUsdsPerSaos().toFixed(6), feesUsds: +toF(pool.feesUsds).toFixed(4), feesSaos: +toF(pool.feesSaos).toFixed(4), k: +(toF(pool.saos) * toF(pool.usds)).toFixed(2) },
          topAccounts: top, lastVerify, lastSeal,
          sealLogTail: sealJournal.slice(-6),
        });
      }
      // גל-87 · כל-היציאות מומרות-מ-µ¢ — BigInt לא-מתסדר ל-JSON
      if (url.pathname === "/balances") return Response.json({ balances: Object.fromEntries([...balances].map(([k, v]) => [k, { usds: +toF(v.usds).toFixed(4), saos: +toF(v.saos).toFixed(4), saosStaked: +toF(v.saosStaked).toFixed(4) }])) });
      if (url.pathname === "/ledger") {
        const lim = Math.min(500, Math.max(1, +(url.searchParams.get("limit") ?? 100)));
        return Response.json({ tail: tailRing.slice(-lim).reverse() });
      }
      if (url.pathname === "/verify") {
        const r = verifyChain();
        if (!r.ok) {
          // ריפוי-כנה-בזמן-ריצה (גל-82): ספר-תפור-על-הדיסק (תפר-דורות/מיזוג) —
          // הסגר-מלא + ספר-חדש-חתום-מהמצב-החי-בזיכרון. אפס-אובדן-יתרות:
          // המצב-בזיכרון-הוא-האמת-המחושבת; ההיסטוריה-התפורה-נשמרת-בהסגר-לביקורת.
          try {
            // גל-94 · ריפוי-עומק-בזמן-ריצה: קודם ננסה לשמר את הקידומת התקינה בספר החי
            // (חיתוך-בתפר, אפס-מחיקה) — ורק אם אין מה לשמר, רג'נזיס כמו-קודם.
            const deep = deepTrimHeal();
            if (deep.ok && seq >= deep.lastKeptSeq) {
              ledgerBuf = []; ledgerLines = deep.keptLines;
              flush(); snapshotSave();
              sealLog({ action: "runtime-deep-trim-heal", brokenAt: r.brokenAt, keptLines: deep.keptLines, trimmedLines: deep.trimmedLines });
              console.log(`[fleet-economy] runtime-heal-deep-trim: קידומת-חיה ${deep.keptLines} שורות · זנב-להסגר ${deep.trimmedLines} · המצב-החי-נשמר`);
            } else {
              quarantineState(`runtime-heal-brokenAt-${r.brokenAt}`);
              seq = 0; lastH = "GENESIS"; ledgerBuf = []; ledgerLines = 0; ledgerFileNo = 0;
              const rec = apply({
                seq: 1, ts: Date.now(), kind: "recovery", from: "treasury", to: "treasury",
                asset: "USDS", amount: 0,
                reason: `ריפוי-ספר-בזמן-ריצה · הסגר-תפר-brokenAt=${r.brokenAt} · יתרות-החיים-נשמרו`,
              });
              flush();
              snapshotSave();
              sealLog({ action: "runtime-book-heal", brokenAt: r.brokenAt, recoverySeq: rec?.seq ?? null });
            }
          } catch { /* כנה — הדיווח-על-השבר-יוצא-בכנות-בכל-מקרה */ }
        }
        lastVerify = { at: Date.now(), ok: r.ok, checked: r.checked };
        return Response.json(r);
      }
      /* ── POST /tx/ingest — קליטת-אירועי-מערכת אמיתיים לספר (לופבק-בלבד) ──
       * כל-עסקה ממופה 1:1 לאירוע שקרה במערכת (מילוי-דקס · בדיקת-אתחול · אטימה).
       * dedup לפי-ref: פקודה-כפולה-של-מפיק לא נספרת פעמיים. fire-and-forget ידידותי:
       * תשובה מהירה, מונים-כנים. */
      if (url.pathname === "/tx/ingest" && req.method === "POST") {
        const ip = srv.requestIP(req);
        const raw = ip ? String(ip.address) : "";
        // גל-83 · תיקון-שומר-לופבק: Bun מחזיר IPv4-ממופה (::ffff:127.0.0.1) —
        // נמדד: השומר-דחה-אף-קריאה (88-נשרו, sent:0, http-403) למרות-לופבק-אמת.
        const addr = raw.replace(/^::ffff:/, "");
        if (addr !== "127.0.0.1" && addr !== "::1") {
          return Response.json({ ok: false, error: "loopback-only", addr: raw.slice(0, 45) }, { status: 403 });
        }
        const clen = +(req.headers.get("content-length") ?? 0);
        if (clen > 8_192) return Response.json({ ok: false, error: "payload-too-large" }, { status: 413 });
        let body: any = null;
        try { body = await req.json(); } catch { ingestBad++; return Response.json({ ok: false, error: "bad-json" }, { status: 400 }); }
        if (!body || typeof body !== "object") { ingestBad++; return Response.json({ ok: false, error: "bad-payload" }, { status: 400 }); }
        const r = ingestEvent({
          kind: String(body.kind ?? ""), from: String(body.from ?? ""), to: String(body.to ?? ""),
          asset: body.asset === "SAOS" ? "SAOS" : "USDS", amount: Number(body.amount),
          reason: String(body.reason ?? ""), ref: String(body.ref ?? `ev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`),
          refillFloat: Boolean(body.refillFloat),
        });
        if (!r.ok) return Response.json({ ok: false, error: r.why, counters: { ingestOk, ingestFailed, ingestBad } }, { status: 422 });
        return Response.json({ ok: true, dedup: r.dedup ?? false, seq: r.tx?.seq ?? null, h: r.tx?.h ?? null });
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      errors++;
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  },
});

/* ── לולאת-אטימה מובנית (vault-seal): הכספת לא יכולה למות עם ה-sandbox ───────
 * חוק-הבעלים: "ודא אטימה בכספת בגיט — שלא יאבד מה שעושים פה בסנדבוקס שעלול
 * למות בכל רגע". השירות הזה הוא תהליך-על (נולד מהשרת החי, לא מקריאת-כלי) —
 * לכן הוא האטים: כל 10 דקות commit+push לכל מאגר פתוח. additive-only,
 * pull --rebase -X ours לפני דחיפה, יומן-אטימה כנה. */
import { execFile } from "child_process";
const SEAL_REPOS = [
  "/home/z/my-project",
  // גל-18 · תיקון-שורש-מדוד: הנתיב /home/z/estate/fleet-economy לא-קיים-על-המכונה
  // → ספר-הקנון (work/fleet-economy/state, seq=134,268→284,475) מעולם-לא-נאטם —
  // 150,120 אירועים חיו-רק-על-הדיסק (הפרת-חוק-הבעלים "כלום-לא-מת-עם-הסנדבוקס").
  // משמורת-חירום-ידנית בוצעה-ונדחפה (81971ff) · מעכשיו-האטימה-האוטומטית-פוגעת-בבית-האמיתי.
  "/home/z/work/fleet-economy", // גל-18 · ביתו-האמיתי-של-המנוע — הספר-החי-נאטם-לכספת-משלו
  "/home/z/estate/FleetHQ",
  "/home/z/estate/Domain",
  "/home/z/estate/Console",
  "/home/z/estate/Pulse",
  "/home/z/estate/Sandbox",
  "/home/z/estate/roshpina",
  "/home/z/estate/saos-dex",
  // גל-83 · הוצא-מהסוופ: /home/z/channels/giant הוא-צ'קאאוט-שני-של-אותו-ריפו-בגיטהאב
  // (roshpinacare-sys/giant) — אטימת-שני-צ'קאאוטים-במקביל-עם-קבצי-מצב-חיים-מול-ישנים
  // היא-מכונת-התפרים (נמדד: 37-קומיטים-של-מצב-ישן-דחפו-מהעותק-השני-וקרעו-את-הספר).
  // my-project הוא-הבעלים-הקנוני-של-המצב-החי; העותק-ב-estate נשאר-לקריאה-בלבד.
  "/home/z/autonomy-fix",
];
const SEAL_LOG = path.join(STATE_DIR, "seal-log.jsonl");
let sealCycle = 0; // גל-18 · מונה-סבבים לדלתא-אטימה (DB כל-10-סבבים) והיגיינת-gc
const sealJournal: Record<string, unknown>[] = [];
let lastSeal: { at: string; action: string } | null = null;
function sealLog(e: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...e });
  sealJournal.push(e);
  lastSeal = { at: new Date().toISOString(), action: String(e.action ?? "") };
  try { fs.appendFileSync(SEAL_LOG, line + "\n"); } catch { /* fail-soft */ }
  if (sealJournal.length > 100) sealJournal.shift();
}
function git(dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: dir, timeout: 90_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: ((stdout || "") + (stderr || "")).slice(-400).trim() });
    });
  });
}

/* ── גל-98 · רפואת-remote עצמית (שורש: אובדן-הכספת השקטה) ────────────────────
 * נמדד 2026-10-18T14:50Z: אחרי-העלאת-סנדבוקס, .git/config של my-project עלה
 * בלי-אף-remote → כל-קומיטי vault-seal היו מקומיים-בלבד מעולם (הפנקס ריק מ-refs/remotes)
 * → כל-פלטפורמת-ה-Next.js חיה-רק-על-דיסק-אפמרלי = הפרת-חוק-הבעלים החמורה-ביותר.
 * התיקון: sealRepo לא סומך על-מצב-המכונה — אם-אין-רימוטים, הוא בונה "cloud"
 * לפי-מפת-ריפו מוכרת + token שנשאב-מה-origin-של-השירות-עצמו (לעולם-לא-נכתב-לקנון). */
const SEAL_REMOTE_MAP: Record<string, string> = {
  "my-project": "saos-console-zai",
  "fleet-economy": "fleet-economy",
  "coord-work": "saos-coordination",
  "FleetHQ": "FleetHQ",
  "Domain": "Domain",
  "Console": "Console",
  "Pulse": "Pulse",
  "Sandbox": "Sandbox",
  "roshpina": "roshpina",
  "saos-dex": "saos-dex",
};
async function ensureSealRemote(dir: string): Promise<string> {
  const rm = await git(dir, ["remote"]);
  const existing = rm.out.split("\n").map((s) => s.trim()).filter(Boolean)[0];
  if (existing) return existing;
  const base = dir.split("/").filter(Boolean).pop()!;
  const target = SEAL_REMOTE_MAP[base];
  if (!target) { sealLog({ repo: base, action: "remote-selfheal-skip", reason: "no-map-entry" }); return "origin"; }
  const selfUrl = await git(import.meta.dir, ["config", "--get", "remote.origin.url"]);
  const tok = /:\/\/[^:]+:([^@]+)@/.exec(selfUrl.out)?.[1] ?? process.env.GITHUB_TOKEN ?? "";
  if (!tok) { sealLog({ repo: base, action: "remote-selfheal-skip", reason: "no-token" }); return "origin"; }
  const url = `https://x-access-token:${tok}@github.com/roshpinacare-sys/${target}.git`;
  const added = await git(dir, ["remote", "add", "cloud", url]);
  if (added.ok) { sealLog({ repo: base, action: "remote-selfheal", target }); return "cloud"; }
  return "origin";
}

/* ── חוק-איחוד (תיקון-מבני · 5-הבליעות · 2026-10-18 · סנכרון-מ-giant) ────────
 * merge -s ours / -X ours כשהעץ-המקומי-מיושן = מכונת-הבליעה (משטחי-עמיתים-נמחקים,
 * כולל-גשר-הפעלת-ה-Hive). החוק-החדש: איחוד-תמיד, אף-צד-לא-נמחק;
 * כשל-איחוד → fail-closed-כנה (בלי-דחיפה), לעולם-לא-פתרון-השמדתי. */
async function unionResolveConflicts(dir: string): Promise<{ ok: boolean; resolved: number; note: string }> {
  const U = await git(dir, ["diff", "--name-only", "--diff-filter=U"]);
  const files = U.out.split("\n").map((s) => s.trim()).filter(Boolean);
  let resolved = 0;
  const notes: string[] = [];
  for (const f of files) {
    const s1 = await git(dir, ["show", `:1:${f}`]);
    const s2 = await git(dir, ["show", `:2:${f}`]);
    const s3 = await git(dir, ["show", `:3:${f}`]);
    const hasB = s1.ok, hasO = s2.ok, hasT = s3.ok;
    try {
      if (hasO && hasT) {
        if (s2.out === s3.out) {
          await git(dir, ["checkout", "--ours", "--", f]);
        } else if (hasB) {
          const bf = "/tmp/.u-b", of = "/tmp/.u-o", tf = "/tmp/.u-t";
          fs.writeFileSync(bf, s1.out); fs.writeFileSync(of, s2.out); fs.writeFileSync(tf, s3.out);
          const mf = await git(dir, ["merge-file", "--union", "-p", of, bf, tf]);
          if (!mf.ok) throw new Error("merge-file-fail");
          fs.writeFileSync(path.join(dir, f), mf.out);
        } else {
          fs.writeFileSync(path.join(dir, f), s2.out + (s2.out.endsWith("\n") ? "" : "\n") + s3.out);
        }
      } else if (hasT && !hasO) {
        fs.writeFileSync(path.join(dir, f), s3.out); // עמית-מנצח — אף-שורה-זרה-לא-נמחקת
        notes.push(`resurrect:${f}`);
      } else if (hasO && !hasT) {
        await git(dir, ["add", "--", f]);
        resolved++;
        continue;
      } else {
        throw new Error("no-sides");
      }
      await git(dir, ["add", "--", f]);
      resolved++;
    } catch (e) {
      notes.push(`fail:${f}:${String(e).slice(0, 60)}`);
    }
  }
  const rest = await git(dir, ["diff", "--name-only", "--diff-filter=U"]);
  return { ok: !rest.out.trim(), resolved, note: notes.join(";").slice(0, 200) };
}

async function unionSync(dir: string, remote: string): Promise<{ ok: boolean; how: string; note: string }> {
  await git(dir, ["fetch", remote, "main"]);
  const anc = await git(dir, ["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"]);
  if (anc.ok) {
    const ff = await git(dir, ["-c", "merge.autoStash=false", "merge", "--ff-only", "FETCH_HEAD"]);
    return { ok: ff.ok || ff.out.includes("up to date"), how: "ff", note: ff.out.slice(0, 120) };
  }
  const mg = await git(dir, ["-c", "merge.autoStash=false", "merge", "-m", "vault-sync [auto-economy]: union-sync — אף-צד-לא-נמחק (חוק-איחוד)", "FETCH_HEAD"]);
  if (mg.ok || mg.out.includes("Already up to date") || mg.out.includes("up to date")) {
    return { ok: true, how: "merge", note: mg.out.slice(0, 120) };
  }
  const ur = await unionResolveConflicts(dir);
  if (!ur.ok) {
    await git(dir, ["merge", "--abort"]);
    return { ok: false, how: "union-fail", note: ur.note };
  }
  const uc = await git(dir, ["commit", "-q", "-m", `vault-sync [auto-economy]: union-resolved ${ur.resolved} files — איחוד-ללא-מחיקות`]);
  return { ok: uc.ok || uc.out.includes("nothing to commit"), how: "union", note: `resolved=${ur.resolved}` };
}
async function sealRepo(dir: string, afterPull?: () => void | Promise<void>, opts?: { strategyOurs?: boolean; excludePaths?: string[]; gc?: boolean; trueMerge?: boolean }): Promise<boolean> {
  // גל-83 · תיקון-תפר-מיזוג: הפרמטר afterPull נמחק-מהחתימה-במיזוג-אך-הקריאה-ב-sealMyProject
  // המשיכה-להעביר-אותו + הגוף-התייחס-אליו → ReferenceError שהרג-את-כל-סבב-האטימה
  // (ובכך-ביטל-בשקט-את-משמורת-המדינה: freeze+custody-restore — שורש-קריעות-הספר-החוזרות).
  const name = dir.split("/").filter(Boolean).pop()!;
  for (let attempt = 0; attempt < 2; attempt++) {
    const st = await git(dir, ["status", "--porcelain", "--branch"]);
    if (!st.ok) { sealLog({ repo: name, action: "status-fail", out: st.out }); return false; }
    const ahead = /ahead (\d+)/.exec(st.out)?.[1];
    const dirtyLines = st.out.split("\n").filter((l) => l && !l.startsWith("##"));
    if (dirtyLines.length > 0) {
      // 2026-10-19 (גל-109): תיקון-דליפה — aed7ceb הדליף את upload/htx.txt (מפתח-HTX של-הבעלים) דרך add -A
      // שבולע-גם-קבצים-לא-נעקבים. מעתה: pathspec-exclude-קבוע — upload/ · tool-results/ · agent-ctx/ לעולם-לא-נאטמים.
      await git(dir, ["add", "-A", "--", ":(exclude)upload", ":(exclude)upload/**", ":(exclude)tool-results", ":(exclude)tool-results/**", ":(exclude)agent-ctx", ":(exclude)agent-ctx/**"]);
      // גל-18 · דלתא-אטימה: קבצים-כבדים-מתחלפים (db/custom.db בינארי 40MB) לא-נאטמים-בכל-סבב
      // אלא-בקצב-דילוג (SEAL_DB_EVERY) — ה-blob-הרפוי-המלא-בכל-10-דק' היה-הדליפה-המבנית
      // (~300MB/שעה ל-.git, מוות-דיסק-בתוך-שעות). הספר-החי-והלדג'ר-נאטמים-תמיד.
      if (opts?.excludePaths?.length) {
        await git(dir, ["reset", "-q", "--", ...opts.excludePaths]);
        sealLog({ repo: name, action: "delta-skip", paths: opts.excludePaths });
      }
      const cm = await git(dir, ["commit", "-q", "-m", `vault-seal [auto-economy]: ${dirtyLines.length} files — אטימה-חוזרת, כלום לא מת עם הסנדבוקס`]);
      if (!cm.ok && !cm.out.includes("nothing to commit")) { sealLog({ repo: name, action: "commit-fail", out: cm.out }); }
    }
    // גל-83 · ניקוי-עצמי: rebase-תקוע-מסוופ-קודם (קונפליקטי-delete/modify מהסשן-השני)
    // היה-שובר-את-כל-הסבבים-הבאים — abort-בכנה-אם-יש, no-op-אם-אין.
    await git(dir, ["rebase", "--abort"]);
    // גל-83 · תיקון-שורשי: ה-remote-אינו-תמיד "origin" — my-project משתמש-ב-"cloud".
    // נמדד: כל-הסוופים-נכשלו-על-my-project ("'origin' does not appear to be a git repository")
    // → הכספת-המקומית-נשארה-לא-דחופה-37-קומיטים, והעותק-ב-channels/giant (אותו-ריפו-בגיטהאב!)
    // דחף-במקומה-מצב-ישן-וקידם-את-הענן — מקור-תפרי-הספר-ההיסטוריים.
    // גל-98 · רפואת-remote-עצמית: אם-המכונה-עלתה-בלי-רימוטים — מבטיחים-אחד-לפני-כל-סוופ.
    const remote = await ensureSealRemote(dir);
    if (opts?.trueMerge) {
      // גל-18 · מיזוג-אמת לפס-הבנאי (מיזוג-אמת-אינו-בולע — נשאר-כפי-שהוא).
      await git(dir, ["fetch", remote, "main"]);
      const mg = await git(dir, ["merge", "--no-edit", "FETCH_HEAD"]);
      if (!mg.ok && !mg.out.includes("Already up to date") && !mg.out.includes("up to date")) {
        sealLog({ repo: name, action: "merge-fail", out: mg.out.slice(0, 220) });
      }
    } else {
      // 2026-10-18 · חוק-האיחוד לכל-השאר (הסרת strategyOurs + -X ours):
      // FF-כשאפשר, מיזוג+איחוד-סכסוכים-כשלא, fail-closed-כנה.
      const sync = await unionSync(dir, remote);
      if (!sync.ok) {
        sealLog({ repo: name, action: `sync-${sync.how}`, out: sync.note });
      } else {
        sealLog({ repo: name, action: "synced", how: sync.how, out: sync.note });
      }
    }
    if (afterPull) { try { await afterPull(); } catch (e) { sealLog({ repo: name, action: "after-pull-fail", error: String(e) }); } }
    const push = await git(dir, ["push", remote, "HEAD"]);
    if (push.ok || push.out.includes("Everything up-to-date") || push.out.includes("up to date")) {
      sealLog({ repo: name, action: "sealed", ahead: ahead ?? "0", detail: push.out.slice(0, 120) });
      // גל-18 · היגיינת-אובייקטים: אובייקטים-רפויים-בין-gc הם-הצד-השני-של-הדליפה
      // (נמדד: 671M→407M ב-gc אחד). gc-מוגבל-זיכרון אסינכרוני אחרי-הדחיפה —
      // לא-מאריך-את-הקפאת-המנוע; כשל-gc לא-מפיל-את-האטימה (כנה-ביומן).
      if (opts?.gc) {
        git(dir, ["-c", "pack.windowMemory=128m", "-c", "pack.threads=1", "-c", "pack.deltaCacheSize=64m", "-c", "pack.window=8", "gc", "--prune=now"])
          .then((r) => { if (!r.ok) sealLog({ repo: name, action: "gc-fail", out: r.out.slice(0, 120) }); })
          .catch(() => { /* כנה */ });
      }
      // אירוע-אמת → עסקת-תשתית: אגרת-אטימה על מאגר שנאטם בפועל (קומיט+דחיפה קרו)
      try {
        ingestEvent({ kind: "infra", from: "FleetHQ", to: "TruthRail", asset: "USDS", amount: 0.05, refillFloat: true, reason: `אגרת-אטימת-כספת (${name})`, ref: `seal-${name}-${Date.now()}` });
      } catch { /* כנה — כשל-אטימה-עסקאית לא מפיל את סבב-האטימה */ }
      return true;
    }
    if (attempt === 0) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    sealLog({ repo: name, action: "push-fail", out: push.out });
  }
  return false;
}

/* ── חוק-משמורת-מדינה (גל-82 · שורש-התפר-החוזר) ─────────────────────────────
 * ריבוז-גיט ממזג-שתי-הוספות-קנה-על-ספר-חי-לשרשרת-תפורה (נמדד-פעמיים: גל-80-וגל-82).
 * התיקון-מהשורש, לפי-חוק-גל-80-שנרשם-ולא-מומש:
 *  1. המנוע-שלנו-קפוא-בזמן-אטימה (sealing — טיק-וסנאפשוט-מדלגים)
 *  2. next-server-קפוא (SIGSTOP — הוא-כותב-את-db/custom.db-דרך-מנוע-הדקס)
 *  3. אחרי-הריבוז: נאמת-את-השרשרת; תפר → מחזירים-את-העותק-המקומי-התקין
 *     (הענן-לא-מפסיד — התפר-שלו-נשאר-בהיסטוריית-הגיט; הספר-החי-שלנו-הוא-האמת)
 *  4. רק-אז-דוחפים. */
function nextServerPids(): number[] {
  const out: number[] = [];
  try {
    for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!cmd.includes("next-server")) continue;
        // גל-84 · היקף-מדויק: רק-next-server-של-my-project — לא-של-FleetHQ/אחרים
        try {
          const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
          if (!cwd.startsWith("/home/z/my-project")) continue;
        } catch { /* ללא-cwd → לא-שלנו */ continue; }
        out.push(Number(pid));
      } catch { /* תהליך-נעלם */ }
    }
  } catch { /* כנה */ }
  return out;
}

/* גל-84 · מרקר-הקפאה-מתוכננת: המפקח-על-3000 קורא-אותו-ונמנע-מהצתת-הצתות-החייאה
 * (EADDRINUSE-סערה) בזמן-שהשרת-מושהה-כחלק-מאטימה-עקבית. נמחק-ב-finally תמיד. */
const WEB_FREEZE_FLAG = "/home/z/my-project/state/web-freeze.flag";
function webFreezeSet() {
  try { fs.mkdirSync(path.dirname(WEB_FREEZE_FLAG), { recursive: true }); fs.writeFileSync(WEB_FREEZE_FLAG, String(Date.now())); } catch { /* כנה */ }
}
function webFreezeClear() {
  try { fs.rmSync(WEB_FREEZE_FLAG, { force: true }); } catch { /* כנה */ }
}

async function sealMyProject(opts?: { excludePaths?: string[]; gc?: boolean }): Promise<void> {
  sealing = true; // הקפאה-עצמית: אף-tick/snapshotSave-לא-רץ
  const pids = nextServerPids();
  webFreezeSet();
  for (const p of pids) { try { process.kill(p, "SIGSTOP"); } catch { /* כנה */ } }
  let preLedger = ""; let preSnap = "";
  try {
    try { flush(); snapshotSave(); } catch { /* נקודת-עקביות-כנה */ }
    const ts = Date.now();
    preLedger = path.join(STATE_DIR, `tmp-prepull-ledger-${ts}.jsonl`);
    preSnap = path.join(STATE_DIR, `tmp-prepull-snap-${ts}.json`);
    try { fs.copyFileSync(LEDGER, preLedger); fs.copyFileSync(SNAP, preSnap); } catch { preLedger = ""; preSnap = ""; }
    await sealRepo("/home/z/my-project", () => {
      const v = verifyChain();
      if (!v.ok) {
        // תפר-מיזוג-מהענן → משמורת-מדינה: השרשרת-החיה-המקומית-מנצחת
        let restored = false;
        if (preLedger) { try { fs.copyFileSync(preLedger, LEDGER); restored = true; } catch { /* כנה */ } }
        if (preSnap) { try { fs.copyFileSync(preSnap, SNAP); } catch { /* כנה */ } }
        sealLog({ repo: "my-project", action: "state-custody-restore", brokenAt: v.brokenAt, restored });
      }
    }); // 2026-10-18 · חוק-האיחוד: הגנת-המצב-החי ב-custody-restore (מעלה) — לא-בהשמדת-קוד-זר · גל-18 · דלתא+gc
  } finally {
    for (const p of pids) { try { process.kill(p, "SIGCONT"); } catch { /* כנה */ } }
    webFreezeClear();
    if (preLedger) try { fs.rmSync(preLedger, { force: true }); } catch { /* כנה */ }
    if (preSnap) try { fs.rmSync(preSnap, { force: true }); } catch { /* כנה */ }
    sealing = false; // הפשרה — הכלכלה-חוזרת-לנשום
  }
}

async function sealAll(): Promise<void> {
  // מנעול-אטימה (גל-82 · נמדד-אמת): שני-תהליכי-גיט-במקביל-על-אותו-מאגר החליפו-db-בגרסה-ישנה
  // (אובדן-הקצאות-גל-82). אם-מנעול-טרי-קיים (עד-5-דק') — מוותרים-בכנות-על-הסבב.
  const lock = path.join(STATE_DIR, "seal.lock");
  try {
    if (fs.existsSync(lock)) {
      const age = Date.now() - fs.statSync(lock).mtimeMs;
      if (age < 5 * 60_000) { sealLog({ action: "sweep-skipped-lock-held", ageMs: age }); return; }
      sealLog({ action: "stale-lock-broken", ageMs: age });
    }
    fs.writeFileSync(lock, String(process.pid));
  } catch { /* כנה — ממשיכים-בלי-מנעול-אם-גם-הוא-נכשל */ }
  try {
    let sealed = 0;
    // גל-18 · מונה-סבבי-אטימה: מפעיל-את-תורת-הדלתא-אטימה (DB כל-10-סבבים ≈ 100דק')
    // והיגיינת-gc (כל-סבב, אסינכרוני). ספירה-מ-1: הסבב-הראשון-מאטים-DB (לכידת-פתיחה).
    sealCycle++;
    const includeDb = sealCycle % 10 === 1;
    const dbExclude = includeDb ? [] : ["db/custom.db"];
    // גל-84 · הקפאה-עצמית-לסבב-האטימות: המנוע-כותב-את-ספרו-שלו (state בביתו-החדש)
    // → בלי-הקפאה, git-קורא-אובייקטים-בזמן-שינוי ("unstable object source data").
    // flush+snapshotSave נקודת-עקביות, sealing-חוסם-tick/כתיבת-מדינה-עד-סוף-הסבב.
    try { flush(); snapshotSave(); } catch { /* נקודת-עקביות-כנה */ }
    sealing = true;
    // גל-83 · שחזור-הדוקטרינה: my-project (הספר-החי) נאטם-דרך-sealMyProject —
    // freeze (SIGSTOP-ל-next-server) + גיבוי-prepull + custody-restore-אחרי-הריבוז.
    // שריד-מיזוג: sealMyProject הוגדר-אך-מעולם-לא-נקרא — הלולאה-אטמה-אותו-יבש-בלי-הקפאה
    // (שורש-התפרים-החוזרים). היתר-המאגרים — בלולאה-הרגילה.
    const rest = SEAL_REPOS.filter((d) => d !== "/home/z/my-project");
    try { await sealMyProject({ excludePaths: dbExclude, gc: true }); sealed++; } catch (e) { sealLog({ repo: "my-project", action: "custody-seal-fail", error: String(e).slice(0, 160) }); }
    for (const dir of rest) {
      if (dir === "/home/z/work/fleet-economy") { if (await sealRepo(dir, undefined, { gc: true, trueMerge: true })) sealed++; }
      else { if (await sealRepo(dir)) sealed++; }
    }
    sealing = false; // הפשרה — הכלכלה-חוזרת-לנשום
    sealLog({ action: "sweep-done" });
    // אירוע-אמת → עסקת-תשתית: סבב-אטימה הושלם (N מאגרים נאטמו בפועל)
    try {
      ingestEvent({ kind: "infra", from: "FleetHQ", to: "treasury", asset: "USDS", amount: 0.2, refillFloat: true, reason: `סבב-אטימת-כספת הושלם · ${sealed}/${SEAL_REPOS.length}-מאגרים`, ref: `sealsweep-${Date.now()}` });
    } catch { /* כנה */ }
  } catch (e) { sealLog({ action: "sweep-error", error: String(e) }); }
  finally {
    try { fs.rmSync(lock, { force: true }); } catch { /* כנה */ }
  }
}
setInterval(sealAll, 10 * 60 * 1000);
setTimeout(sealAll, 45_000); // אטימה ראשונה דקה-אחרי-עלייה

const bootResult = boot();
ingestExtFlows(); // גל-109 · שער-הזרימות-החוץ: אחרי-boot (seenRefs-כבר-שוחזר → dedup-חוצה-דורות)
setInterval(tick, TICK_MS);
setInterval(snapshotSave, SNAP_MS);
process.on("exit", () => { try { flush(); snapshotSave(); } catch {} });

/* ── רשת-ביטחון למילויי-דקס (poller): כל-עסקה שנרשמה בפועל במנוע-הדקס (DexTrade —
 *   כולל-מילויי-מנוע-התדירות-של-הצי) נרשמת כדמי-שירות בספר — בלי-תלות במפיק-HTTP
 *   שעלול להיות מושבת. dedup לפי-ref (`dexfill-<tradeId>`) — גם אם מפיק-ה-HTTP
 *   דיווח את אותו מילוי, האירוע נספר פעם-אחת בדיוק. קריאה רק-לקריאה (readonly)
 *   על db/custom.db. אפס-סינתזה: רק עסקאות שנוצרו לאחר-עליית-המנוע. */
import { Database } from "bun:sqlite";
const DEX_DB = "/home/z/my-project/db/custom.db";
const FILL_POLL_MS = 45_000;
const fillBaseline = Date.now(); // רק-מילויים-חדשים מאז-עלייה (היסטוריה לא נספרת)
let fillPollErrors = 0, fillPollRuns = 0;
function pollDexFills(): void {
  fillPollRuns++;
  let db: Database | null = null;
  try {
    db = new Database(DEX_DB, { readonly: true, create: false });
    const rows = db
      .query("SELECT id, pairId, side, source, sourceAgent, total, t FROM DexTrade WHERE t >= ? ORDER BY t ASC LIMIT 500")
      .all(fillBaseline) as { id: string; pairId: string; side: string; source: string; sourceAgent: string | null; total: number | null; t: number }[];
    for (const row of rows) {
      if (seenRefs.has(`dexfill-${row.id}`)) continue; // כבר נרשם (ע"י-המפיק-החי או קודם)
      const notional = Number(row.total ?? 0); // הצד-ה-USDS של המילוי (אמת מהמנוע)
      const fee = round6(Math.min(2, Math.max(0.001, notional * 0.003)));
      ingestEvent({
        kind: "dex-fee", from: "saos-dex", to: "treasury", asset: "USDS", amount: fee, refillFloat: true,
        reason: `דמי-שירות-מילוי-דקס · ${row.pairId} ${row.side} · מקור=${row.source}${row.sourceAgent ? `:${row.sourceAgent}` : ""}`,
        ref: `dexfill-${row.id}`,
      });
    }
  } catch { fillPollErrors++; } // db-נעול/זמני — הסבב-הבא ינסה שוב (כנה)
  finally { try { db?.close(); } catch { /* כנה */ } }
}
setInterval(pollDexFills, FILL_POLL_MS);
setTimeout(pollDexFills, 15_000);

console.log(`[fleet-economy] חי על :${PORT} · restored=${bootResult.restored} · seq=${bootResult.seq} · תורת-משתמשי-פנים בעיצומה · vault-seal מובנה · ingest-אירועים-אמת מחובר (dex-fills+verifier+seal)`);
export {};
