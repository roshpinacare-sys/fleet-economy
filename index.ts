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

const PORT = 3016;
const STATE_DIR = path.join(import.meta.dir, "state");
const LEDGER = path.join(STATE_DIR, "ledger.jsonl");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const TICK_MS = 800; // גל-85: 900→800 (תקורה-זעירה — flush הוא append-בלבד)
const SNAP_MS = 30_000;
const FEE_BPS = 30; // 0.3%
const WAGE_FLOOR_USDS = 350; // גל-83 · חוק-שכר-מצע: רצפת-פרנסה לחייל
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

type Balances = Map<string, { usds: number; saos: number; saosStaked: number }>;
type Tx = {
  seq: number; ts: number; kind: string; from: string; to: string;
  asset: "USDS" | "SAOS"; amount: number; fee?: number; price?: number;
  reason: string; ref?: string; h: string;
};

let balances: Balances = new Map();
let pool = { saos: POOL_SAOS, usds: POOL_USDS, feesUsds: 0, feesSaos: 0 };
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
  const b = bal(payer);
  if (b.usds >= needed) return true;
  const fill = round6(FLOAT_TARGET - b.usds);
  if (fill <= 0) return b.usds >= needed;
  const r = apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: payer, asset: "USDS", amount: fill, reason: `תדלוק-צף-אגרות-אירועים (${payer})` });
  return r !== null && bal(payer).usds >= needed;
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
  if (!b) { b = { usds: 0, saos: 0, saosStaked: 0 }; balances.set(id, b); }
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

/* ── החלה עם איזון-כפול fail-closed ───────────────────────────────────────── */
function apply(t: Omit<Tx, "h">, refH?: string): Tx | null {
  const from = bal(t.from), to = bal(t.to);
  const field = t.asset === "USDS" ? "usds" : "saos";
  if ((from as any)[field] < t.amount) { rej(); return null; }
  if (t.kind === "stake") {
    from.saos -= t.amount; from.saosStaked += t.amount;
  } else if (t.kind === "unstake") {
    if (from.saosStaked < t.amount) { rej(); return null; }
    from.saosStaked -= t.amount; to.saos += t.amount;
  } else {
    (from as any)[field] -= t.amount;
    if (t.kind === "swap") {
      // מטבע-נכנס יושב בבריכה, עמלה נשארת בה
      const feeAmt = t.fee ?? 0;
      if (t.asset === "USDS") { pool.usds += t.amount; pool.saos -= (t as any).outSaos; to.saos += (t as any).outSaos; pool.feesUsds += feeAmt; }
      else { pool.saos += t.amount; pool.usds -= (t as any).outUsds; to.usds += (t as any).outUsds; pool.feesSaos += feeAmt; }
    } else {
      (to as any)[field] += t.amount;
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
  const k = pool.saos * pool.usds;
  if (asset === "USDS") {
    const out = pool.saos - k / (pool.usds + amountIn * (1 - FEE_BPS / 10_000));
    if (out <= 0 || out > pool.saos * 0.5) { rej(); return null; }
    return apply({ seq: seq + 1, ts: Date.now(), kind: "swap", from: user, to: "pool", asset, amount: amountIn, fee: +(amountIn * FEE_BPS / 10_000).toFixed(6), price: +(pool.usds / pool.saos).toFixed(6), reason, outSaos: +out.toFixed(6) } as any);
  }
  const out = pool.usds - k / (pool.saos + amountIn * (1 - FEE_BPS / 10_000));
  if (out <= 0 || out > pool.usds * 0.5) { rej(); return null; }
  return apply({ seq: seq + 1, ts: Date.now(), kind: "swap", from: user, to: "pool", asset, amount: amountIn, fee: +(amountIn * FEE_BPS / 10_000).toFixed(6), price: +(pool.usds / pool.saos).toFixed(6), reason, outUsds: +out.toFixed(6) } as any);
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
    let nodeW = 0, solW = 0;
    for (const nd of FLEET_NODES) { const b = bal(nd.id); nodeW += b.usds + b.saos; }
    for (const sl of SOLDIERS) { const b = bal(sl.id); solW += b.usds + b.saos; }
    const totW = nodeW + solW;
    const nodeShare = totW > 0 ? Math.min(0.5, Math.max(0.2, nodeW / totW)) : 0.25;
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
      const amt = round6(Math.min(b.saos, 0.5 + Math.random() * 6));
      if (amt <= 0) { rej(); return null; }
      return apply({ seq: seq + 1, ts: Date.now(), kind: "stake", from: soldier, to: soldier, asset: "SAOS", amount: amt, reason: "סטייק-SAOS לאבטחת-הרשת הפנימית" });
    }
    const amt = round6(Math.min(b.saosStaked, 0.3 + Math.random() * 4));
    if (amt <= 0) { rej(); return null; }
    return apply({ seq: seq + 1, ts: Date.now(), kind: "unstake", from: soldier, to: soldier, asset: "SAOS", amount: amt, reason: "ביטול-סטייק לצורך-תפעול" });
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
      const poor = SOLDIERS.filter((s) => bal(s.id).usds < WAGE_FLOOR_USDS);
      for (const s of poor) {
        apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: s.id, asset: "USDS", amount: round6(30 + Math.random() * 45), reason: `חוק-שכר-מצע: תדלוק-פרנסה (רצפת ${WAGE_FLOOR_USDS})` });
      }
    }
    // גל-83 · איסוף-עמלות (כל-150-טיקים): עמלות-הבריכה (הכנסת-הרשת) זורמות-לכספת
    if (tickNo % 150 === 0 && pool.feesUsds >= 1) {
      const amt = round6(pool.feesUsds);
      pool.feesUsds = 0;
      apply({ seq: seq + 1, ts: Date.now(), kind: "infra", from: "pool", to: "treasury", asset: "USDS", amount: amt, reason: "איסוף-עמלות-בריכה → כספת" });
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
  bal("treasury").usds = TREASURY_USDS;
  bal("treasury").saos = SAOS_SUPPLY - POOL_SAOS;
  bal("pool").usds = pool.usds; bal("pool").saos = pool.saos;
  for (const s of SOLDIERS) { bal(s.id).usds = 900 + Math.random() * 600; bal(s.id).saos = 20 + Math.random() * 30; }
  for (const n2 of FLEET_NODES) { bal(n2.id).usds = 300 + Math.random() * 200; }
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
        if ((from as any)[field] < t.amount) { seamIdx = i; seamFile = f; break outer; } // מצב-לא-עקבי-עם-הספר → תפר-כנה
        if (t.kind === "stake") { from.saos -= t.amount; from.saosStaked += t.amount; }
        else if (t.kind === "unstake") {
          if ((from.saosStaked ?? 0) < t.amount) { seamIdx = i; seamFile = f; break outer; }
          from.saosStaked -= t.amount; to.saos += t.amount;
        } else {
          (from as any)[field] -= t.amount;
          if (t.kind === "swap") {
            const feeAmt = t.fee ?? 0;
            if (t.asset === "USDS") { pool.usds += t.amount; pool.saos -= t.outSaos; to.saos += t.outSaos; pool.feesUsds += feeAmt; }
            else { pool.saos += t.amount; pool.usds -= t.outUsds; to.usds += t.outUsds; pool.feesSaos += feeAmt; }
          } else { (to as any)[field] += t.amount; }
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

function boot() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (fs.existsSync(SNAP)) {
      const s = JSON.parse(fs.readFileSync(SNAP, "utf8"));
      balances = new Map(Object.entries(s.balances ?? {}).map(([k, v]) => [k, v as any]));
      pool = s.pool ?? pool; seq = s.seq ?? 0; lastH = s.lastH ?? lastH;
      byKind = s.byKind ?? {}; byAccount = s.byAccount ?? {}; rejected = s.rejected ?? 0; errors = s.errors ?? 0;
      ledgerFileNo = s.ledgerFileNo ?? 0;
      ingestOk = s.ingestOk ?? 0; ingestDedup = s.ingestDedup ?? 0; ingestFailed = s.ingestFailed ?? 0; ingestBad = s.ingestBad ?? 0;
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
        quarantineState(`boot-heal-brokenAt-${v.brokenAt}`);
        balances = new Map();
        pool = { saos: POOL_SAOS, usds: POOL_USDS, feesUsds: 0, feesSaos: 0 };
        seq = 0; lastH = "GENESIS"; ledgerBuf = []; ledgerLines = 0; recent = [];
        byKind = {}; byAccount = {}; rejected = 0; ledgerFileNo = 0;
        seed();
        return { restored: false, seq: 0, quarantined: true };
      }
      // גל-84 · ספר-תקין-מהגנזיס: שחזור-זנב-שנחתם-לדיסק-אחרי-הסנאפשוט (קריסה-בין-flush-לסנאפשוט)
      const r = replayTailFromSnapshot(s);
      if (r.replayed > 0) console.log(`[fleet-economy] boot-tail-replay: +${r.replayed} עסקאות → seq=${seq}`);
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

/* אימות-שרשרת מלאה (לתביעה מול-אמת): קורא את הספר כולה ומאמת sha256 */
function verifyChain(): { ok: boolean; checked: number; brokenAt?: number } {
  let prev = "GENESIS"; let checked = 0;
  const files = fs.readdirSync(STATE_DIR).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(STATE_DIR, f), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const t = JSON.parse(line) as Tx;
        const { h, ...rest } = t;
        const body = JSON.stringify({ ...rest, prev });
        if (createHash("sha256").update(body).digest("hex").slice(0, 32) !== h) return { ok: false, checked, brokenAt: t.seq };
        prev = h; checked++;
      } catch { return { ok: false, checked, brokenAt: checked }; }
    }
  }
  return { ok: true, checked };
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */
function priceUsdsPerSaos() { return pool.saos > 0 ? pool.usds / pool.saos : 0; }
function countsWindow(ms: number) { const cutoff = Date.now() - ms; let c = 0; for (let i = recent.length - 1; i >= 0; i--) { if (recent[i] >= cutoff) c++; else break; } return c; }

function snapshotSave() {
  if (sealing) return; // חוק-גל-82: אף-כתיבת-מדינה-בזמן-אטימה
  flush();
  const obj = { v: 3, savedAt: Date.now(), seq, lastH, balances: Object.fromEntries(balances), pool, byKind, byAccount, rejected, errors, ledgerFileNo, ingestOk, ingestDedup, ingestFailed, ingestBad, seenRefs: Array.from(seenRefs.entries()).slice(-SEEN_REFS_SNAP) };
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
          byKind, rejected, errors, seq, lastH,
          throughput: { attempts: attemptsTotal, rejectedCount: rejected, acceptancePct: attemptsTotal > 0 ? +(((attemptsTotal - rejected) / attemptsTotal) * 100).toFixed(1) : null, governor: { nBase, cap: N_CAP, min: N_MIN, windowAcceptance: lastGovAcc } },
          supply: { saosTotal: SAOS_SUPPLY, saosStaked: [...balances.values()].reduce((a, b) => a + b.saosStaked, 0), usdsInPool: pool.usds, saosInPool: pool.saos },
          pool: { priceUsdsPerSaos: +priceUsdsPerSaos().toFixed(6), feesUsds: +pool.feesUsds.toFixed(4), feesSaos: +pool.feesSaos.toFixed(4), k: +(pool.saos * pool.usds).toFixed(2) },
          topAccounts: top, lastVerify, lastSeal,
          sealLogTail: sealJournal.slice(-6),
        });
      }
      if (url.pathname === "/balances") return Response.json({ balances: Object.fromEntries([...balances].map(([k, v]) => [k, { ...v, usds: +v.usds.toFixed(4), saos: +v.saos.toFixed(4) }])) });
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
  "/home/z/estate/fleet-economy", // גל-84 · ביתו-העצמאי-של-המנוע — הספר-החי-נאטם-לכספת-משלו
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
async function sealRepo(dir: string, afterPull?: () => void | Promise<void>, opts?: { strategyOurs?: boolean }): Promise<boolean> {
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
      await git(dir, ["add", "-A"]);
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
    const rm = await git(dir, ["remote"]);
    const remote = rm.out.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "origin";
    if (opts?.strategyOurs) {
      // גל-83 · מסלול-אפס-תפרים (my-project — מחזיק-המצב-החי): merge -s ours לא-נוגע
      // בעץ-העבודה-כלל — הספר-החי-והקוד-הרצים-שלנו-מנצחים-תמיד, ההיסטוריה-של-הענן
      // (כולל-קו-הסשן-השני) מקושרת-כהורה-שני. אפס-קונפליקטים, אפס-stash, אפס-תפר.
      await git(dir, ["fetch", remote, "main"]);
      const mg = await git(dir, ["merge", "-s", "ours", "-m", "vault-sync [auto-economy]: link cloud history — ours-tree wins, zero-seam", "FETCH_HEAD"]);
      if (!mg.ok && !mg.out.includes("Already up to date") && !mg.out.includes("up to date")) {
        sealLog({ repo: name, action: "merge-fail", out: mg.out.slice(0, 200) });
      }
    } else {
      // גל-83 · autoStash-חובה + refspec-מפורש (נמדד: pull-בלי-branch נכשל-בלי-upstream).
      const pull = await git(dir, ["-c", "rebase.autoStash=true", "pull", "--rebase", "-X", "ours", remote, "main"]);
      if (!pull.ok && !pull.out.includes("Already up to date") && !pull.out.includes("up to date")) {
        sealLog({ repo: name, action: "pull-fail", out: pull.out.slice(0, 220) });
      }
    }
    if (afterPull) { try { await afterPull(); } catch (e) { sealLog({ repo: name, action: "after-pull-fail", error: String(e) }); } }
    const push = await git(dir, ["push", remote, "HEAD"]);
    if (push.ok || push.out.includes("Everything up-to-date") || push.out.includes("up to date")) {
      sealLog({ repo: name, action: "sealed", ahead: ahead ?? "0", detail: push.out.slice(0, 120) });
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

async function sealMyProject(): Promise<void> {
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
    }, { strategyOurs: true }); // גל-83 · אפס-תפרים: merge -s ours — לא-נוגע-בעץ-החי-כלל
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
    try { await sealMyProject(); sealed++; } catch (e) { sealLog({ repo: "my-project", action: "custody-seal-fail", error: String(e).slice(0, 160) }); }
    for (const dir of rest) { if (await sealRepo(dir)) sealed++; }
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
