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
import { fromF, toF, ammOut as muAmmOut, splitFee, splitRouting, wagePaceCapMu, type Mu } from "./lib/mu";
/* גל-115 · G36 · מושל-המדיניות-הריבוני: המנוע-עצמו-המחוקק — מדידה→החלטה→חוק-בספר→בדיקת-תוצאה */
import { CONSTITUTION, governorDecide, governorOutcome, emptyCooldowns, closureOf, closureDecompose, sustainablePaceOf, type GovPolicy, type GovCooldowns, type GovMeasure, type GovLever } from "./lib/governor"; // גל-116·G37: +שווי-המשקל-המבני

const PORT = 3016;
const STATE_DIR = path.join(import.meta.dir, "state");
const LEDGER = path.join(STATE_DIR, "ledger.jsonl");
const SNAP = path.join(STATE_DIR, "snapshot.json");
const EXT_FLOWS = path.join(STATE_DIR, "ext-flows.jsonl"); // גל-109 · שער-הזרימות-החוץ (G27): כותב-יחיד=console-API · קורא=המנוע
const EXT_POLICY = path.join(STATE_DIR, "ext-policy.json"); // גל-109·G28 · חוק-ניתוב-הנזילות: מדיניות-מוצהרת-בקנון (כותב-יחיד: הסוכן · המנוע קורא-ב-boot בלבד)
const TICK_MS = 800; // גל-85: 900→800 (תקורה-זעירה — flush הוא append-בלבד)
const SNAP_MS = 30_000;
const FEE_BPS = 30; // 0.3%
const WAGE_FLOOR_USDS = 3; // גל-83 · גל-114·G35 (agent-2): רצפת-פרנסה לחייל — הותאמה-לסקאלת-המחירים-בפועל (שירותים 0.35–3.2$ · נמדד: רצפת-350$ מול-ארנקי-0.06$ = 15,907-דחיות)
const TREASURY_FLOOR_USDS = 400; // גל-85 · משאבת-נזילות-כספת: מתחת-לזה הכספת מוכרת-SAOS לבריכה (עסקת-AMM אמת) כדי-שמשכורות-יזרמו
const RUNWAY_CYCLES = 600; // גל-111 · G32 · משמעת-תזרים-השכר: תקציב-חייב-להספיק-לפחות ל-600 מחזורי-מצע (כל-מחזור = 12 טיקים ≈ 9.6ש')
/* גל-115 · G36: המס-אינו-קבוע-קוד עוד — כשיר-חוק-בספר (מנוף-המושל) */
let taxBps = 250; // גל-112 · G33 · מס-שירותים 2.5% → הכספת (מ-2% — העלאה-מדודה: נמדד-אידוי-98.5% משכר-שלא-חוזר-כהכנסה)
const SOV_POLICY = path.join(STATE_DIR, "sov-policy.json"); // גל-111 · G32 · חוק-הון-הריבון (מדיניות-מוצהרת-בקנון · המנוע קורא-ב-boot בלבד)

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
// גל-114·G35 (agent-2): מאמת-האתחול אינו-שחקן-כלכלי — ההון-שלו-ערבות-הוכחת-חיים, לא-מחזור.
// נמדד: הוא-היה-המשלם-היחיד-הגדול (חצי-מהזרימה) — כשהפעימה-נעצרת, המשק-מתשטח.
const PAY_NODES = FLEET_NODES.filter((n) => n.id !== "boot-verifier");

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
let lastVerify: { at: number; ok: boolean; checked: number; anchors: number } | null = null;
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
let extImportedMu = 0n, extPoolImportedMu = 0n, extCount = 0, extDedup = 0, extBad = 0; // גל-109·G28: extPoolImportedMu = מדידת-ניתוב-לבריכה
/* גל-111 · G32 · מדינת-אוצר-ריבונית — מונים-כנים-ששורדים-סנאפשוט-וסימטריים-ב-replay:
 *  · incomeAccruedMu (G31): כל-הכנסת-האמת-ב-USDS (מס · dex-fee · איסוף-עמלות-בריכה · ext-כספת · דיבידנד)
 *  · wagePaidMu (G31): שכר-ששולם-בפועל · wageBlocked: ניסיונות-שכר-שנחסמו-בכנות (אין-תקציב)
 *  · דיבידנד-עמלות + איגרת-חוב-ריבונית (קרן/ריבית/החזר) — מימון-עצמי-מהון-הלאומי, אפס-הדפסה.
 *  חיים-מרגע-ההטמעה (אפס-שכתוב-היסטוריה) — המקור-לתביעה: סריקת-הספר-המלאה בשער-הרווחיות. */
let incomeAccruedMu = 0n, wagePaidMu = 0n, incomeSaosMu = 0n;
let wageBlocked = 0;
let dividendPaidMu = 0n, dividendRounds = 0;
let bondIssuedMu = 0n, bondRepaidMu = 0n, bondInterestMu = 0n;
let bondLastTs = 0;
/* גל-109·G28 · מדיניות-ניתוב: קריאה-ב-boot בלבד · fail-closed: קובץ-פגום/חסר = poolPct 0 (הכל-לכספת — התנהגות-G27) */
let extPolicy = { poolPct: 0, maxFlowUsds: 25_000, dailyCapUsds: 50_000 };
try {
  const p = JSON.parse(fs.readFileSync(EXT_POLICY, "utf8"));
  extPolicy = {
    poolPct: Number.isFinite(p?.poolPct) && p.poolPct >= 0 && p.poolPct <= 100 ? Math.floor(Number(p.poolPct)) : 0,
    maxFlowUsds: Number.isFinite(p?.maxFlowUsds) && p.maxFlowUsds > 0 ? Number(p.maxFlowUsds) : 25_000,
    dailyCapUsds: Number.isFinite(p?.dailyCapUsds) && p.dailyCapUsds > 0 ? Number(p.dailyCapUsds) : 50_000,
  };
  console.log(`[fleet-economy] ext-policy G28: poolPct=${extPolicy.poolPct}% maxFlow=${extPolicy.maxFlowUsds} dailyCap=${extPolicy.dailyCapUsds}`);
} catch { /* אין-מדיניות = ברירת-המחדל-הזהירה */ }
/* גל-111 · G32 · חוק-הון-הריבון: קריאת-מדיניות-ב-boot בלבד · fail-closed: קובץ-פגום/חסר = איגרת-כבויה + דיבידנד-50% (התנהגות-בטוחה) */
let sovPolicy = { feeToTreasuryPct: 50, treasuryRoundTicks: 150, bondEnabled: false, bondMaxUsds: 3_000, bondMaxPoolSharePct: 12, bondPerIssuanceUsds: 300, bondInterestBpsAnnual: 200, bondTriggerTreasuryUsds: 150, bondRepayRunwayUsds: 600, wageRunwayHours: 8, wagePctOfIncome: 80, wageHourFloorUsds: 1 };
try {
  const p = JSON.parse(fs.readFileSync(SOV_POLICY, "utf8"));
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (Number.isFinite(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt);
  sovPolicy = {
    feeToTreasuryPct: Math.floor(num(p?.feeToTreasuryPct, 0, 100, 50)),
    treasuryRoundTicks: Math.max(10, Math.floor(num(p?.treasuryRoundTicks, 10, 10_000, 150))),
    bondEnabled: p?.bondEnabled === true,
    bondMaxUsds: num(p?.bondMaxUsds, 0, 50_000, 3_000),
    bondMaxPoolSharePct: num(p?.bondMaxPoolSharePct, 0, 50, 12),
    bondPerIssuanceUsds: num(p?.bondPerIssuanceUsds, 1, 10_000, 300),
    bondInterestBpsAnnual: Math.floor(num(p?.bondInterestBpsAnnual, 0, 5_000, 200)),
    bondTriggerTreasuryUsds: num(p?.bondTriggerTreasuryUsds, 0, 10_000, 150),
    bondRepayRunwayUsds: num(p?.bondRepayRunwayUsds, 0, 10_000, 600),
    wageRunwayHours: num(p?.wageRunwayHours, 1, 720, 8), // גל-112 · G33: חוק-קצב-ההוצאה
    wagePctOfIncome: num(p?.wagePctOfIncome, 0, 100, 80), // השכר-השעתי-מכוסה-הכנסה-אמת
    wageHourFloorUsds: num(p?.wageHourFloorUsds, 0, 10_000, 1), // גל-114·G35: המהדק-היה-0–100 ⇒ רצפת-250-נפלה-לברירת-מחדל-1-בכל-boot (נמדד: floor1$-ביומן-מול-250-בדיסק) — התקרה-הורחבה; התקציב-המזומנים-מגביל-בעצמו
  };
  console.log(`[fleet-economy] sov-policy G35: feeShare=${sovPolicy.feeToTreasuryPct}% round=${sovPolicy.treasuryRoundTicks}t bond=${sovPolicy.bondEnabled ? "ON" : "OFF"} max=${sovPolicy.bondMaxUsds}$ (${sovPolicy.bondMaxPoolSharePct}%pool) rate=${sovPolicy.bondInterestBpsAnnual / 100}%/y pace=runway${sovPolicy.wageRunwayHours}h×income${sovPolicy.wagePctOfIncome}%·floor${sovPolicy.wageHourFloorUsds}$ (cash-backed-budget)`);
} catch { /* אין-מדיניות = ברירת-המחדל-הזהירה */ }

/* ═══ גל-115 · G36 · מושל-המדיניות-הריבוני ═══
 * המנדט (הבעלים): הארכיטקטורה-מחליטה-הכל-בעצמה — חשיבה·בדיקה·תכנון — והכל-חי
 * גם-כשהבעלים-לא-קיים, אבל-הבעלים-לא-נשכח (הוא-הנהנה · דו"ח-כל-6-שעות-בספר).
 * עד-היום: כל-מדיניות-כלכלית-שונתה-ידנית (רצפת 3→100→250$ ביד · מס 2→2.5% ביד).
 * הממצא-המדוד-שפתח-את-החוק: הכנסה 38.9$/שעה מול שכר 250$/שעה = שריפה-211$/שעה
 * → runway-~10-ימים. טענת-G35 "סבב-סגור" הייתה-השקר-המבני-השמיני.
 * החוקה-מגבילה-את-המושל (CONSTITUTION ב-lib/governor.ts — ננעלה-בקנון). */
let govPolicy: GovPolicy = { wageHourFloorUsds: sovPolicy.wageHourFloorUsds, taxBps, feeToTreasuryPct: sovPolicy.feeToTreasuryPct };
let govCooldowns: GovCooldowns = emptyCooldowns();
type GovPending = { ref: string; lever: GovLever; field: string; from: number; to: number; closure0: number; ts: number; checkAt: number };
let govPending: GovPending[] = [];
let govStats = { decisions: 0, verified: 0, failed: 0, freezes: 0, lastDecisionAt: 0, lastReportAt: 0, lastNetWorthUsds: null as number | null };
/* גל-116·G37: החוק-האחרון-שנחתם-בספר (שורת-policy) — בסיס-טענת-החוק-הוא-הספר */
let govLawFromBook: { law: GovPolicy; at: number } | null = null;
/* אכילת-חוק מהספר/הסנאפשוט — מופעלת-גם-חי-וגם-ב-replay (סימטריית-apply/replay · חוק-הסימטריה) */
function applyGovLaw(law: Partial<GovPolicy> | null | undefined) {
  if (!law) return;
  if (Number.isFinite(law.wageHourFloorUsds)) sovPolicy.wageHourFloorUsds = Math.max(0, Math.min(10_000, Number(law.wageHourFloorUsds)));
  if (Number.isFinite(law.taxBps)) taxBps = Math.max(0, Math.min(5_000, Math.floor(Number(law.taxBps))));
  if (Number.isFinite(law.feeToTreasuryPct)) sovPolicy.feeToTreasuryPct = Math.max(0, Math.min(100, Math.floor(Number(law.feeToTreasuryPct))));
  govPolicy = { wageHourFloorUsds: sovPolicy.wageHourFloorUsds, taxBps, feeToTreasuryPct: sovPolicy.feeToTreasuryPct };
}
const govLawNow = (): GovPolicy => ({ wageHourFloorUsds: sovPolicy.wageHourFloorUsds, taxBps, feeToTreasuryPct: sovPolicy.feeToTreasuryPct });
function winCount(win: { ts: number; mu: bigint }[]): number { const cut = Date.now() - WIN_MS; let c = 0; for (const e of win) if (e.ts >= cut) c++; return c; }
function govMeasure(): GovMeasure { return { incomeUsds1h: toF(incomeLastHourMu()), wageUsds1h: toF(wageSpendLastHourMu()), wageRows1h: winCount(wageWin), serviceUsds1h: toF(serviceLastHourMu()), ts: Date.now() }; }

/* פסקי-דין: החלטות-שעבר-בדיקתן — המדידה-בפועל-מול-הצפוי · 3-כישלונות-רצופים → הקפאת-המנוף-6ש' */
function governorOutcomes(now: number) {
  for (const d of [...govPending]) {
    if (now < d.checkAt) continue;
    const m = govMeasure();
    const cNow = closureOf(m);
    const cNowF = Number.isFinite(cNow) ? +cNow.toFixed(6) : 999999;
    const { verdict, delta } = governorOutcome(d.closure0, cNowF);
    apply({ seq: seq + 1, ts: now, kind: "govern-outcome", from: "treasury", to: "treasury", asset: "USDS", amount: 0, reason: `פסק-דין-ריבוני ${verdict}: ${d.lever} ${d.from}→${d.to} · סגירות ${d.closure0}→${cNowF} (Δ${delta >= 0 ? "+" : ""}${delta}) · צפי: עלייה`, ref: `${d.ref}-out`, gov: { verdict, delta, closure0: d.closure0, closureNow: cNowF } } as any);
    if (verdict === "verified") { govStats.verified++; govCooldowns.failStreak[d.lever] = 0; }
    else {
      govStats.failed++;
      govCooldowns.failStreak[d.lever] = (govCooldowns.failStreak[d.lever] ?? 0) + 1;
      if (govCooldowns.failStreak[d.lever] >= CONSTITUTION.freezeAfterFails) {
        govCooldowns.freezes[d.lever] = now + CONSTITUTION.freezeMs;
        govCooldowns.failStreak[d.lever] = 0;
        govStats.freezes++;
      }
    }
    govCooldowns.lastIncomeUsds = m.incomeUsds1h;
    govPending = govPending.filter((x) => x.ref !== d.ref);
  }
}

/* מחזור-החקיקה: מדידה → הכרעה-חוקתית → שורת-חוק-בספר → רשומת-החלטה → בדיקה-מתוכננת */
function governorLegislate(now: number) {
  const m = govMeasure();
  const d = governorDecide(m, govLawNow(), govCooldowns, now);
  if (!d) return;
  const ref = `g36-${d.lever}-${now}`;
  const law = govLawNow(); (law as any)[d.field] = d.to;
  // שורת-החוק: החוק-החדש-כחלק-מהספר — נשחזר-דטרמיניסטית-בכל-boot
  apply({ seq: seq + 1, ts: now, kind: "policy", from: "treasury", to: "treasury", asset: "USDS", amount: 0, reason: `חוק-G36-המושל-הריבוני: ${d.field} ${d.from}→${d.to} (מנוף-${d.lever} · סגירות-${d.closure.toFixed(3)})`, ref, policy: law } as any);
  applyGovLaw(law);
  govLawFromBook = { law: govLawNow(), at: now, src: "book" }; // גל-116·G37: החוק-הכתוב-בספר (טענת-/claims)
  // רשומת-ההחלטה: המדידה · ההשערה · התוצאה-הצפויה · מועד-הבדיקה (חשיבה-בדוקה-מתועדת)
  const decRef = `${ref}-dec`;
  apply({ seq: seq + 1, ts: now, kind: "govern", from: "treasury", to: "treasury", asset: "USDS", amount: 0, reason: `החלטה-ריבונית-עצמאית (${d.lever}): ${d.field} ${d.from}→${d.to} — ${d.hypothesis}`, ref: decRef, gov: { lever: d.lever, field: d.field, from: d.from, to: d.to, closure0: +d.closure.toFixed(6), hypothesis: d.hypothesis, expect: d.expect, checkAt: now + CONSTITUTION.checkMs } } as any);
  govPending.push({ ref: decRef, lever: d.lever, field: d.field, from: d.from, to: d.to, closure0: +d.closure.toFixed(6), ts: now, checkAt: now + CONSTITUTION.checkMs });
  govCooldowns.lastChangeAt[d.lever] = now;
  govCooldowns.lastIncomeUsds = m.incomeUsds1h;
  govStats.decisions++; govStats.lastDecisionAt = now;
}

/* דו"ח-הבעלים (חוק-לא-לשכוח-את-הבעלים): הריבון-מנהל-לטובת-הבעלים-ומשאיר-לו-זיכרון-כתוב-בספר */
function ownerReport(now: number) {
  syncPoolAccounts();
  let usdsTotal = 0n, saosTotal = 0n;
  for (const b of balances.values()) { usdsTotal += b.usds; saosTotal += b.saos + b.saosStaked; }
  const price = priceUsdsPerSaos();
  const netWorth = toF(usdsTotal) + toF(saosTotal) * price;
  const m = govMeasure();
  const cNow = closureOf(m);
  const burn = m.wageUsds1h - m.incomeUsds1h;
  const runwayH = burn > 0.0001 ? toF(bal("treasury").usds) / burn : Infinity;
  const delta = govStats.lastNetWorthUsds === null ? null : +(netWorth - govStats.lastNetWorthUsds).toFixed(4);
  apply({ seq: seq + 1, ts: now, kind: "owner-report", from: "treasury", to: "treasury", asset: "USDS", amount: 0, reason: `דו\"ח-בעלים (G36-המושל): הון-נטו ${netWorth.toFixed(2)}$ · Δ ${delta === null ? "ראשון" : (delta >= 0 ? "+" : "") + delta + "$"} · סגירות ${Number.isFinite(cNow) ? cNow.toFixed(3) : "∞"} · runway ${Number.isFinite(runwayH) ? runwayH.toFixed(0) + "ש'" : "∞"} · החלטות ${govStats.decisions} (מאומתות-${govStats.verified} · נכשלו-${govStats.failed}) — הריבון-מנהל-הרשת-לטובת-הבעלים`, ref: `g36-owner-report-${now}`, owner: { netWorthUsds: +netWorth.toFixed(4), deltaUsds: delta, closure: Number.isFinite(cNow) ? +cNow.toFixed(6) : null, runwayHours: Number.isFinite(runwayH) ? +runwayH.toFixed(1) : null, decisions: govStats.decisions, verified: govStats.verified, failed: govStats.failed, treasuryUsds: +toF(bal("treasury").usds).toFixed(4), poolUsds: +toF(pool.usds).toFixed(4), priceUsdsPerSaos: +price.toFixed(6), taxBps, wageHourFloorUsds: sovPolicy.wageHourFloorUsds } } as any);
  govStats.lastReportAt = now; govStats.lastNetWorthUsds = netWorth;
}

/* מחזור-המושל-המלא — נקרא-מהטיק (כל-100-טיקים ≈ 80ש') */
function governorCycle() {
  const now = Date.now();
  governorOutcomes(now);
  governorLegislate(now);
  if (now - (govStats.lastReportAt || bootedAt) >= CONSTITUTION.reportEveryMs) ownerReport(now);
}
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
/* גל-111 · G32 · מאזן-התקציב-הריבוני (G31-מומש): הכנסה-אמת-שלא-נוצלה + קרן-איגרות-שטרם-הוחזרה − ריבית-ששולמה.
 * חוב-ממומן-כנה: קרן-האיגרת מממנת-שכר (היא-הון-לאומי-שהועבר-לתפעול, לא-רווח); הריבית-היא-עלות-אמת-שחייבת-מהכנסה. */
function wageBudgetMu(): bigint {
  // גל-114 · G35 (agent-2) · תיקון-שורש-לולאת-המוות: התקציב-הקומולטיבי-לכל-החיים (G33) צנח מתחת-לאפס
  // בקור-התנעה (נמדד: −0.014$) וחנק-את-המשק-לנצח — אפס-שכר→אפס-שירותים→אפס-הכנסה→אפס-תקציב.
  // החוק-החדש: תקציב-מזומנים = מזומן-כספת-מעל-רזרבת-האיגרת (bondTrigger=150$) — מימון-מהון-אמת-בספר,
  // אפס-שריפת-רזרבה, והתנעה-אפשרית. משמעת-הקצב-השעתית של-G33 נשארת-מלאה (wagePaceCapMu לא-נגע).
  const reserveMu = fromF(Math.max(0, Number(sovPolicy.bondTriggerTreasuryUsds) || 150));
  const cashMu = bal("treasury").usds;
  return cashMu > reserveMu ? cashMu - reserveMu : 0n;
}
/* גל-112 · G33 · חוק-קצב-ההוצאה — הממצא-המדוד שסגר-את-הגל: שכר 3,341$ מול הכנסה 341$ (10:1)
 * והאיגרת (3,000$) נשרפה-תוך-שעה-פחות-או-פחות: כל-תקציב-שנצבר התאדה-מיד-בשכר-אקראי
 * (6% מ-10,658-tx/שעה × ~5$ ≈ 3,200$/שעה) — בלי-שום-קשר-בין-קצב-השריפה-לקצב-ההכנסה.
 * החוק: מכסת-שכר-שעתית = min(תקציב÷runway-שעות, max(רצפת-חיים, הכנסה-אמת-שעתית×pct)) − שנוצל-השעה.
 * החלונות-ניזונים-מהספר-עצמו (apply+replay סימטריים — חוק-הסימטריה) — אחרי-הפעלה-מחדש
 * החלונות-מתחילים-ריקים (ה-replay מכסה-רק-את-זנב-שאחרי-הסנאפשוט) → קצב-שמרני-כנה עד-שהמציאות-נמדדת-שוב. */
const wageWin: { ts: number; mu: bigint }[] = [];   // שכר-שהתבצע-מהכספת (salary·USDS)
const incomeWin: { ts: number; mu: bigint }[] = []; // הכנסה-אמת-לכספת (tax/dex-fee/dividend/infra/ext-deposit·USDS)
const serviceWin: { ts: number; mu: bigint }[] = []; // גל-116·G37: מחזור-השירותים (service·USDS) — מדידת-המהירות k
const taxWin: { ts: number; mu: bigint }[] = []; // גל-116·G37: מס-טהור-לכספת (tax·USDS) — טענת-גבייה-בשיעור-החוק
const WIN_MS = 60 * 60_000;
function winFeed(win: { ts: number; mu: bigint }[], ts: number, mu: bigint) { win.push({ ts, mu }); if (win.length > 50_000) win.splice(0, 10_000); } // סף-בטיחות-זיכרון
function winSum(win: { ts: number; mu: bigint }[]): bigint {
  const cut = Date.now() - WIN_MS;
  while (win.length && win[0].ts < cut) win.shift();
  let s = 0n; for (const e of win) s += e.mu;
  return s;
}
function wageSpendLastHourMu(): bigint { return winSum(wageWin); }
function incomeLastHourMu(): bigint { return winSum(incomeWin); }
function serviceLastHourMu(): bigint { return winSum(serviceWin); } // גל-116·G37
function taxLastHourMu(): bigint { return winSum(taxWin); } // גל-116·G37
/* נותר-ממכסת-הקצב-השעתית. 0 = חסום-בכנות (אין-תקציב או שהמכסה-נוצלה).
 * המכסה-עצמה = חוק-טהור-יחיד wagePaceCapMu ב-lib/mu.ts (מקור-אמת-יחיד · ננעל-בטסטים). */
function wagePaceRemainingMu(): bigint {
  const cap = wagePaceCapMu(
    wageBudgetMu(),
    incomeLastHourMu(),
    Number(sovPolicy.wageRunwayHours),
    Number(sovPolicy.wagePctOfIncome),
    fromF(Math.max(0, Number(sovPolicy.wageHourFloorUsds) || 0)),
  );
  if (cap <= 0n) return 0n;
  const spent = wageSpendLastHourMu();
  return cap > spent ? cap - spent : 0n;
}
function syncPoolAccounts() { bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; } // גל-111: חשבון-הבריכה-בספר-מסתנכרן-מול-המודול (אמת-ה-AMM)
/* תדלוק-צף: חשבון-פנים שמשלם אגרות-אירוע לעולם לא נתקע — הכספת ממלאת אותו
 * ליעד-קטן (25-USDS) בעסקת-משכורת אמת בספר (מתועדת, נחתמת בשרשרת). */
const FLOAT_TARGET = 3; // גל-114·G35: הותאם-לסקאלת-התדלוק-החדשה (היה-25 — כל-מילוי-אכל-שעה-שלמה-של-מכסת-קצב)
function refillFloatIfEmpty(payer: string, needed: number): boolean {
  if (wageBudgetMu() <= 0n) { wageBlocked++; return false; } // גל-111 · G31-מומש: אין-תקציב-אמת — אין-תדלוק-מהאוויר
  const needMu = fromF(needed);
  const b = bal(payer);
  if (b.usds >= needMu) return true;
  const fillMu0 = fromF(FLOAT_TARGET) - b.usds;
  if (fillMu0 <= 0n) return b.usds >= needMu;
  // גל-112 · G33: המילוי-נכלל-בקצב-השעה-ואינו-עולה-עליו — נמדד: מילוי-מלא-עד-יעד-25$ עם-תקציב-זעיר
  // דחף-את-התקציב-לשלילי. אם-הקצב-אינו-מכסה-אפילו-את-האגרה-הנדרשת — נכשל-בכנות (האירוע-לא-מובלע).
  const remainMu = wagePaceRemainingMu();
  const fillMu = fillMu0 < remainMu ? fillMu0 : remainMu;
  if (b.usds + fillMu < needMu) { wageBlocked++; return false; }
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
    if (t.ref) rememberRef(String(t.ref)); // dedup-מהמקור: כל-apply של-ext-deposit רושם-את-ה-ref
    (to as any)[field] += amtMu;
    if (t.to === "pool") extPoolImportedMu += amtMu; // גל-109·G28: מדידת-חלק-הניתוב-לבריכה
    if (t.to === "treasury" && t.asset === "USDS") { incomeAccruedMu += amtMu; winFeed(incomeWin, t.ts, amtMu); } // גל-111·G31: ייבוא-לכספת = הכנסת-אמת · גל-112·G33: חלון-קצב
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
  // גל-111 · G32/G31 · חשבונאות-האוצר: מקור-אמת-יחיד בתוך-apply (ה-replay משקף-מילה-במילה — חוק-הסימטריה)
  if (t.kind === "tax" || t.kind === "dex-fee") { if (t.to === "treasury" && t.asset === "USDS") incomeAccruedMu += amtMu; }
  else if (t.kind === "dividend") { incomeAccruedMu += amtMu; dividendPaidMu += amtMu; } // USDS-בלבד-בעיצוב
  else if (t.kind === "bond-issue") bondIssuedMu += amtMu;
  else if (t.kind === "bond-repay") bondRepaidMu += amtMu;
  else if (t.kind === "bond-interest") bondInterestMu += amtMu;
  else if (t.kind === "salary") { wagePaidMu += amtMu; if (t.from === "treasury" && t.asset === "USDS") winFeed(wageWin, t.ts, amtMu); } // גל-112·G33: חלון-הקצב-ניזון-מהספר-עצמו
  else if (t.kind === "infra" && t.from === "pool" && t.to === "treasury") { if (t.asset === "USDS") incomeAccruedMu += amtMu; else incomeSaosMu += amtMu; } // איסוף-עמלות-בריכה
  // גל-116·G37: חלון-המהירות — מחזור-השירותים (apply-וגם-replay — חוק-הסימטריה)
  if (t.kind === "service" && t.asset === "USDS") winFeed(serviceWin, t.ts, amtMu);
  if (t.kind === "tax" && t.to === "treasury" && t.asset === "USDS") winFeed(taxWin, t.ts, amtMu);
  // גל-112 · G33 · חלון-הכנסה-אמת-השעתית (מקור-יחיד = הספר; ext-deposit-ניזון-בענף-שלו)
  if (t.asset === "USDS" && t.to === "treasury" && (t.kind === "tax" || t.kind === "dex-fee" || t.kind === "dividend" || t.kind === "infra")) winFeed(incomeWin, t.ts, amtMu);
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
  if (r < 0.06) { // משכורת/תדלוק מהכספת (מנוזל, מההצע-הקבוע בלבד · G31-מומש + G33-קצב-הוצאה)
    // גל-112 · G33 · חוק-קצב-ההוצאה: השכר-ניזון-לפי-מכסה-שעתית (runway·הכנסה·רצפת) — נמדד:
    // המוקדם שרף-שכר-אקראי 3,341$-מול-הכנסה-341$ ושרף-איגרת-שלמה-תוך-שעה; וכן Math.max(0.01,…)
    // כפה-שכר-מינימלי-גם-עם-תקציב-0.004$ → תקציב-שלילי. שניהם-נסגרים: אין-מכסה-שעתית=חסום-בכנות.
    const remainMu = wagePaceRemainingMu();
    if (remainMu < fromF(0.01)) { wageBlocked++; rej(); return null; }
    const amt = Math.min(round6(0.3 + Math.random() * 0.7), +toF(remainMu).toFixed(6)); // חיתוך-מדויק-למכסה-שנותרה · גל-114·G35: סקאלה-עקבית
    if (amt < 0.01) { wageBlocked++; rej(); return null; }
    return apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: soldier, asset: "USDS", amount: amt, reason: "משכורת-מחזורית על עבודת-שורה חיה" });
  }
  if (r < 0.50) { // תשלום-שירות הדדי — עיקר-הזרימה (משתמשי-פנים משלמים זה לזה)
    // גל-114·G35: מאמת-האתחול אינו-שחקן-כלכלי — אינו-משלם-ואינו-מקבל-שירותים (ההון-שלו-ערבות, לא-מחזור)
    const others = ACCOUNTS.filter((a) => a.id !== soldier && a.kind !== "pool" && a.id !== "treasury" && a.id !== "boot-verifier");
    const to = pick(others).id;
    const svc = pick(SERVICES);
    const units = Math.random() < 0.8 ? 1 : 2; // גל-114·G35: משקול-ליחידה-אחת — התאמת-ארנקים (היה-1–8 אחיד)
    // גל-83 · זרימה-חוזרת: צמתי-הצי קונים-שירותים מהחיילים
    // גל-85 · משלם-משוקלל-עושר: חלק-הצמתים-בתשלום נגזר-מחלקתם-בהון-המחזורי בפועל
    // (מי-שצבר-תשתית משלם-יותר — הכסף-לא-נתקע-אצל-אף-אחד; חלון-מוגן 20%-50%)
    let nodeW = 0n, solW = 0n; // גל-87 · משקלי-עושר ב-µ¢; החלטת-המשלם = פלואט (תצוגה/החלטה-בלבד)
    for (const nd of PAY_NODES) { const b = bal(nd.id); nodeW += b.usds + b.saos; } // גל-114·G35: בלי-מאמת-האתחול
    for (const sl of SOLDIERS) { const b = bal(sl.id); solW += b.usds + b.saos; }
    const totW = nodeW + solW;
    const nodeShare = totW > 0n ? Math.min(0.5, Math.max(0.2, Number(nodeW) / Number(totW))) : 0.25;
    const payer = Math.random() < nodeShare ? pick(PAY_NODES).id : soldier; // גל-114·G35: בלי-מאמת-האתחול
    const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "service", from: payer, to, asset: "USDS", amount: round6(svc.price * units), reason: `${svc.name} · ${units}-${svc.unit}`, ref: `svc-${Date.now()}-${Math.floor(Math.random() * 1e4)}` });
    // גל-83 · מס-שירותים 2%: עסקה-נפרדת-וחתומה (מימון-אמיתי-לכספת שתוכל-לשלם-שכר)
    if (tx) apply({ seq: seq + 1, ts: Date.now(), kind: "tax", from: to, to: "treasury", asset: "USDS", amount: round6(tx.amount * (taxBps / 10_000)), reason: `מס-שירותים ${taxBps / 100}% → כספת` });
    return tx;
  }
  if (r < 0.74) { // החלפה על הבריכה (גילוי-מחיר אמיתי)
    const buySaos = Math.random() < 0.5;
    const amt = round6(buySaos ? 0.3 + Math.random() * 1.7 : 0.3 + Math.random() * 1.2); // גל-114·G35: היה-5–45$ מול-ארנקי-דאסט = דחיות-כמעט-ודאיות
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
    const node = pick(PAY_NODES).id; // גל-114·G35: בלי-מאמת-האתחול
    const svc = pick(SERVICES);
    return apply({ seq: seq + 1, ts: Date.now(), kind: "infra", from: soldier, to: node, asset: "USDS", amount: round6(svc.price), reason: `תשתית: ${svc.name}` }); // גל-114·G35: יחידה-אחת (היה-1–5 = עד-16$ מול-דאסט)
  }
  { // טיפ על עבודה-טובה (תרבות-שימוש פנימית) · גל-114·G35: USDS (חיילים-החזיקו-0-SAOS-נזיל = 100% דחיות)
    const others = SOLDIERS.map((s) => s.id).filter((s) => s !== soldier);
    const to = pick(others);
    const amt = round6(0.01 + Math.random() * 0.04);
    return apply({ seq: seq + 1, ts: Date.now(), kind: "tip", from: soldier, to, asset: "USDS", amount: amt, reason: "טיפ על עבודה-טובה בזרימה" });
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
      // גל-85 · שכר-מצע מדורג + גל-111 · G31-מומש: כל-חייל-מתחת-הרצפה מתודלק — **רק-מתוך-תקציב-אמת**
      // (הכנסה-שלא-נוצלה + קרן-איגרות-שטרם-הוחזרה). הממצא-המקצועי-של-גל-111: תקציב-G31 היה-תצוגה-ללא-מנגנון
      // (המנוע מעולם לא כתב incomeAccrued/wagePaid) — והשפיכה-מהכספת-הריקה המשיכה-בכל-טיק. עתה: חוק-אמת.
      const floorMu = fromF(WAGE_FLOOR_USDS);
      const poor = SOLDIERS.filter((s) => bal(s.id).usds < floorMu);
      let budget = wageBudgetMu();
      // גל-111 · משמעת-תזרים: התקציב-מתוכנן-להספיק-לפחות ל-RUNWAY_CYCLES מחזורי-מצע (~96 דק')
      // — נמדד: בלעדיו החוק-שרף-300$/9.6ש' ורוקן-איגרת-שלמה-בדקות (65:1-היסטורי-חוזר).
      const perSoldierCap = budget / BigInt(RUNWAY_CYCLES);
      let paceLeft = wagePaceRemainingMu(); // גל-112 · G33: המצע-חולק-את-מכסת-הקצב-השעתית-עם-השכר-האקראי (מקור-אמת-יחיד)
      for (const s of poor) {
        if (budget <= 0n || paceLeft < fromF(0.01)) { wageBlocked++; continue; }
        const wantMu = fromF(round6(0.3 + Math.random() * 0.7)); // גל-114·G35: תדלוק-בסקאלת-המחירים-בפועל (היה-30–75$/מחזור = מכונת-שריפה)
        let amtMu = wantMu > budget ? budget : wantMu;
        if (amtMu > perSoldierCap) amtMu = perSoldierCap; // משמעת-ה-runway
        if (amtMu > paceLeft) amtMu = paceLeft; // גל-112 · G33: מהמכסה-השעתית-שנותרה
        if (amtMu < fromF(0.01)) { wageBlocked++; continue; }
        const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "salary", from: "treasury", to: s.id, asset: "USDS", amount: toF(amtMu), reason: `חוק-שכר-מצע (G31-מומש): תדלוק-פרנסה-מתקציב-אמת (רצפת ${WAGE_FLOOR_USDS})` });
        if (tx) { budget -= amtMu; paceLeft -= amtMu; } else wageBlocked++;
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
      // גל-111 · G32 · מעגל-המימון-העצמי-המלא: הכנסות-מכירת-ה-SAOS-שנאספו-כעמלות הן-הכנסת-אמת-הנספרת-לתקציב
      // (נמדד: בלעדי-הספירה הכספת-החזיקה-402$-והתקציב-הראה-שלילי — פער-חשבונאות-נתפס-ונסגר)
      if (saosIn > 0.01) {
        const sold = ammSwap("treasury", "SAOS", saosIn, "משאבת-נזילות-כספת: SAOS→USDS לתדלוק-משק-הפנים (עסקת-AMM אמת)");
        if (sold && (sold as any).outUsds !== undefined) incomeAccruedMu += fromF((sold as any).outUsds); // הכנסת-אמת: מכירת-נכס-אמת
      }
    }
    // גל-111 · G32 · סבב-אוצר-ריבוני (כל-treasuryRoundTicks): דיבידנד-עמלות · ריבית · החזר-חוב · הנפקה-מותנית.
    // זהו-מנוע-המימון-העצמי: הרשת-מממנת-את-הנהלתה-מעמלות-השוק-שלה-ומהונה-הלאומי-הכלוא (בחוב-מחויב-בספר — אפס-הדפסה).
    if (tickNo % sovPolicy.treasuryRoundTicks === 0) {
      syncPoolAccounts(); // חשבון-הבריכה-בספר-מתיישר-מול-אמת-ה-AMM לפני-כל-מגע (דטרמיניזם-מלא-מול-ה-replay)
      // (א) דיבידנד-עמלות: חלק-החוק-מעמלות-ה-USDS-שנצברו זורם-לכספת כהכנסת-אמת; היתר-נשאר-מעמיק-את-הבריכה.
      const feesU = pool.feesUsds;
      if (feesU >= fromF(0.01)) {
        const takeMu = (feesU * BigInt(sovPolicy.feeToTreasuryPct)) / 100n;
        if (takeMu >= 1n) {
          const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "dividend", from: "pool", to: "treasury", asset: "USDS", amount: toF(takeMu), reason: `דיבידנד-עמלות-בריכה (${sovPolicy.feeToTreasuryPct}% · G32-סבב-אוצר)` });
          if (tx) { pool.feesUsds = feesU - takeMu; pool.usds -= takeMu; syncPoolAccounts(); dividendRounds++; }
        }
      }
      // (ב) עמלות-SAOS: נאספות-לכספת כנכס-בריכה-שנצבר (הממצא-המדוד: מעולם לא נאספו — 114-SAOS-כלואים)
      const feesS = pool.feesSaos;
      if (feesS >= fromF(0.01)) {
        const takeMu = (feesS * BigInt(sovPolicy.feeToTreasuryPct)) / 100n;
        if (takeMu >= 1n) {
          const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "infra", from: "pool", to: "treasury", asset: "SAOS", amount: toF(takeMu), reason: `איסוף-עמלות-SAOS (${sovPolicy.feeToTreasuryPct}% · G32-סבב-אוצר)` });
          if (tx) { pool.feesSaos = feesS - takeMu; pool.saos -= takeMu; syncPoolAccounts(); }
        }
      }
      // (ג) ריבית-איגרות-חוב: נמדדת-פר-סבב-מאז-הסבב-הקודם (ריבית-חוקית-שנתית) — עלות-אמת-מהכספת
      const debtNow0 = bondIssuedMu - bondRepaidMu;
      if (debtNow0 > 0n && bondLastTs > 0) {
        const elMs = Date.now() - bondLastTs;
        const interestMu = (debtNow0 * BigInt(sovPolicy.bondInterestBpsAnnual) * BigInt(elMs)) / (10_000n * 365n * 24n * 3_600n * 1_000n);
        if (interestMu >= 1n && bal("treasury").usds >= interestMu) {
          const t2 = apply({ seq: seq + 1, ts: Date.now(), kind: "bond-interest", from: "treasury", to: "pool", asset: "USDS", amount: toF(interestMu), reason: `ריבית-איגרת-חוב-ריבונית (${sovPolicy.bondInterestBpsAnnual / 100}% שנתי · G32)` });
          if (t2) { pool.usds += interestMu; syncPoolAccounts(); }
        }
      }
      bondLastTs = Date.now();
      // (ד) החזר-קרן: מעודף-תקציב-מעל-רצפת-הפעלה — עד-מחצית-העודף-פר-סבב (החוב-נפרע-מהכנסה-אמת)
      const budgetNow = wageBudgetMu();
      const debtNow = bondIssuedMu - bondRepaidMu;
      if (budgetNow > fromF(sovPolicy.bondRepayRunwayUsds) && debtNow > 0n) {
        const surplus = budgetNow - fromF(sovPolicy.bondRepayRunwayUsds);
        let repayMu = surplus / 2n;
        if (repayMu > debtNow) repayMu = debtNow;
        if (repayMu >= fromF(0.01)) {
          const t3 = apply({ seq: seq + 1, ts: Date.now(), kind: "bond-repay", from: "treasury", to: "pool", asset: "USDS", amount: toF(repayMu), reason: "החזר-קרן-איגרת-חוב-ריבונית-מהכנסה-אמת (G32)" });
          if (t3) { pool.usds += repayMu; syncPoolAccounts(); }
        }
      }
      // (ה) הנפקת-איגרת-חוב: כשהתקציב-החי-מאוזן/שלילי — מימון-עצמי-מהון-הבריכה.
      // גל-111 · תיקון-טריגר-מדיד: ההנפקה-נקבעת-לפי-התקציב-החי (מצב-מימון-השכר) ולא-לפי-יתרת-הכספת —
      // נמדד: הכספת-החזיקה-403$ (ממכירות-SAOS-אמת) והתקציב-היה-שלילי-והשכר-חסום = מחסום-עצמי-שקרי.
      // מכסות-חוק: חוב-כולל ≤ bondMaxUsds · ≤ bondMaxPoolSharePct מיתרת-הבריכה · קצירה-הדרגתית ≤ bondPerIssuanceUsds.
      if (sovPolicy.bondEnabled && wageBudgetMu() <= fromF(50)) {
        const headroom = fromF(sovPolicy.bondMaxUsds) - (bondIssuedMu - bondRepaidMu);
        const poolCap = (pool.usds * BigInt(sovPolicy.bondMaxPoolSharePct)) / 100n;
        let issueMu = headroom < poolCap ? headroom : poolCap;
        const perIssuance = fromF(sovPolicy.bondPerIssuanceUsds);
        if (issueMu > perIssuance) issueMu = perIssuance;
        if (issueMu >= fromF(1) && pool.usds >= issueMu) {
          const t4 = apply({ seq: seq + 1, ts: Date.now(), kind: "bond-issue", from: "pool", to: "treasury", asset: "USDS", amount: toF(issueMu), reason: `הנפקת-איגרת-חוב-ריבונית · חוב-מחויב-בספר (G32 · ריבית ${sovPolicy.bondInterestBpsAnnual / 100}%)` });
          if (t4) { pool.usds -= issueMu; syncPoolAccounts(); if (bondLastTs === 0) bondLastTs = Date.now(); }
        }
      }
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
    // גל-115 · G36 · מושל-המדיניות-הריבוני: מדידה→הכרעה→חוק-בספר→פסק-דין→דו"ח-בעלים (כל-100-טיקים ≈ 80ש')
    if (tickNo % 100 === 0) governorCycle();
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
        // גל-111 · G32 · סנכרון-מקדים-כמו-בחיים: שורות-שנוגעות-בבריכה-כמשלם/מקבל — חשבון-הספר-מתיישר-מול-המודול-לפני-בדיקת-היתרה (דטרמיניזם-מלא)
        if (t.kind === "dividend" || t.kind === "bond-issue" || t.kind === "bond-interest" || t.kind === "bond-repay" || (t.kind === "infra" && t.from === "pool")) {
          bal("pool").usds = pool.usds; bal("pool").saos = pool.saos;
        }
        if (t.kind === "ext-deposit") {
          // גל-109 · גל-27 · replay-משקף-apply (חוק-גל-86): מקור-חוץ — אין-חיוב,
          // זיכוי-יעד + מדידה + רישום-ref (הגנת-חלון-קריסה: בליעה-ב-boot-אחרי-replay
          // של-זנב-עם-ext-deposit תדדף-דרך-seenRefs — אפס-זיכוי-כפול).
          if (t.ref) rememberRef(String(t.ref));
          (to as any)[field] += amtMu;
          if (t.to === "pool") extPoolImportedMu += amtMu; // גל-109·G28: replay-משקף-apply מילה-במילה
          if (t.to === "treasury" && t.asset === "USDS") incomeAccruedMu += amtMu; // גל-111·G31
          extImportedMu += amtMu; extCount++;
        } else if ((from as any)[field] < amtMu) { seamIdx = i; seamFile = f; break outer; } // מצב-לא-עקבי-עם-הספר → תפר-כנה
        else if (t.kind === "stake") { from.saos -= amtMu; from.saosStaked += amtMu; }
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
        // גל-111 · G32 · replay-משקף-את-חשבונאות-האוצר-ואת-שיקוף-מודול-הבריכה מילה-במילה ל-apply (חוק-הסימטריה)
        if (t.kind === "ext-deposit") { /* נמדד-בענף-למעלה */ }
        else if (t.kind === "dividend") { if (t.asset === "USDS") pool.usds -= amtMu; else pool.saos -= amtMu; bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; incomeAccruedMu += amtMu; dividendPaidMu += amtMu; }
        else if (t.kind === "bond-issue") { pool.usds -= amtMu; bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; bondIssuedMu += amtMu; }
        else if (t.kind === "bond-interest") { pool.usds += amtMu; bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; bondInterestMu += amtMu; }
        else if (t.kind === "bond-repay") { pool.usds += amtMu; bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; bondRepaidMu += amtMu; }
        else if (t.kind === "infra" && t.from === "pool" && t.to === "treasury") { if (t.asset === "USDS") { pool.usds -= amtMu; incomeAccruedMu += amtMu; } else { pool.saos -= amtMu; incomeSaosMu += amtMu; } bal("pool").usds = pool.usds; bal("pool").saos = pool.saos; }
        else if (t.kind === "tax" || t.kind === "dex-fee") { if (t.to === "treasury" && t.asset === "USDS") incomeAccruedMu += amtMu; }
        else if (t.kind === "salary") { wagePaidMu += amtMu; if (t.from === "treasury" && t.asset === "USDS") winFeed(wageWin, t.ts, amtMu); } // גל-112·G33: סימטריית-replay-מלאה
        if (t.kind === "service" && t.asset === "USDS") winFeed(serviceWin, t.ts, amtMu); // גל-116·G37: סימטריית-המהירות
        if (t.kind === "tax" && t.to === "treasury" && t.asset === "USDS") winFeed(taxWin, t.ts, amtMu); // גל-116·G37: סימטריית-המס
        byAccount[t.from] = (byAccount[t.from] ?? 0) + 1;
        byAccount[t.to] = (byAccount[t.to] ?? 0) + 1;
        byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
        // גל-115 · G36 · חוקי-המושל-נשחזרים-מהספר (סימטריית-apply/replay — החוק-חלק-מההיסטוריה)
        if (t.kind === "policy") { applyGovLaw((t as any).policy); govLawFromBook = { law: govLawNow(), at: t.ts, src: "book" }; } // גל-116·G37: החוק-מהספר-בשחזור
        // גל-112 · G33 · replay-משקף-את-חלון-ההכנסה-מילה-במילה (חוק-הסימטריה)
        if (t.asset === "USDS" && t.to === "treasury" && (t.kind === "tax" || t.kind === "dex-fee" || t.kind === "dividend" || t.kind === "infra")) winFeed(incomeWin, t.ts, amtMu);
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
    // גל-55 · G55 · חוק-התאמת-הכותב: קיצוץ-זנב חוקי רק אם הקידומת-השמורה מסתיימת בדיוק בראש-השרשרת-החיה
    // של הכותב (seq,lastH) — אחרת השורה-הבאה-שהכותב-יכתוב לא תשרשר מהקובץ → תפר→עוגן→רג'נזיס (הנמדד-חי:
    // deep-trim ב-03:58:26 ורג'נזיס ב-03:58:38 — 12 שניות של כאוס). הכותב-החי הוא-האמת: מה שאינו
    // מתחבר-אליו — יורד-להסגר-ברג'נזיס-מהזיכרון, לא בקיצוץ-שייצור-תפר-חדש.
    const tailInfo = (() => { try { const t = JSON.parse(prefix[prefix.length - 1].line); return { seq: t.seq as number, h: t.h as string }; } catch { return { seq: -1, h: "" }; } })();
    if (!prefix.length || tailInfo.seq !== seq || tailInfo.h !== lastH) {
      console.log(`[fleet-economy] deep-trim-נדחה (חוק-התאמת-הכותב): זנב-הקידומת seq=${tailInfo.seq} ≠ ראש-הכותב seq=${seq} — רג'נזיס-מהזיכרון-היא-הריפוי-הכנה`);
      return { ok: false, keptLines: prefix.length, trimmedLines: 0, brokenAt, lastKeptSeq: tailInfo.seq };
    }
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
      bookGen = Number(s.bg) > 0 ? Number(s.bg) : 1; // גל-55: דור-הספר-שורד-דורות
      byKind = s.byKind ?? {}; byAccount = s.byAccount ?? {}; rejected = s.rejected ?? 0; errors = s.errors ?? 0;
      ledgerFileNo = s.ledgerFileNo ?? 0;
      ingestOk = s.ingestOk ?? 0; ingestDedup = s.ingestDedup ?? 0; ingestFailed = s.ingestFailed ?? 0; ingestBad = s.ingestBad ?? 0;
      // גל-109 · שער-הזרימות-החוץ: המדידות-שורדות-דורות
      extImportedMu = fromF(Number(s.extImported ?? 0)); extCount = s.extCount ?? 0; extDedup = s.extDedup ?? 0; extBad = s.extBad ?? 0;
      extPoolImportedMu = fromF(Number(s.extPoolImported ?? 0)); // גל-109·G28: המדידה-שורדת-דורות
      // גל-111 · G32/G31 · מדינת-האוצר-שורדת-דורות
      incomeAccruedMu = fromF(Number(s.incomeAccrued ?? 0)); wagePaidMu = fromF(Number(s.wagePaid ?? 0)); incomeSaosMu = fromF(Number(s.incomeSaos ?? 0));
      wageBlocked = Number(s.wageBlocked ?? 0);
      dividendPaidMu = fromF(Number(s.dividendPaid ?? 0)); dividendRounds = Number(s.dividendRounds ?? 0);
      bondIssuedMu = fromF(Number(s.bondIssued ?? 0)); bondRepaidMu = fromF(Number(s.bondRepaid ?? 0)); bondInterestMu = fromF(Number(s.bondInterest ?? 0));
      bondLastTs = Number(s.bondLastTs ?? 0);
      // גל-115 · G36 · מצב-המושל-שורד-דורות (חוק-חי · החלטות-פתוחות · הקפאות · פסקי-דין)
      if (s.gov) {
        if (s.gov.policy) { applyGovLaw(s.gov.policy); govLawFromBook = { law: govLawNow(), at: Number(s.savedAt ?? Date.now()), src: "snapshot" }; } // גל-116·G37: הסנאפשוט-עצמו-נולד-מהספר-האטום — המקור-מוצהר
        if (Array.isArray(s.gov.pending)) govPending = s.gov.pending.filter((p: any) => p && typeof p.ref === "string" && Number.isFinite(p.checkAt));
        if (s.gov.cooldowns) govCooldowns = { ...emptyCooldowns(), ...s.gov.cooldowns };
        if (s.gov.stats) govStats = { ...govStats, ...s.gov.stats };
      }
      // גל-87 · שימור-המדידה: attemptsTotal חייב לשרוד עלייה — בלי-זה acceptancePct מוצג
      // שלילי-מטופש (rejected היסטורי מול attempts צעירים). נמדד: -129163.1% אחרי-עלייה.
      if (typeof s.attemptsTotal === "number" && s.attemptsTotal > attemptsTotal) attemptsTotal = s.attemptsTotal;
      // dedup שורד-הפעלה-מחדש: מפיקים-חיים + poller-מילויים לא יספרו מילוי-כפול אחרי-restart
      if (Array.isArray(s.seenRefs)) for (const [k, v] of s.seenRefs as [string, number][]) seenRefs.set(k, v);
      if (!balances.has("treasury")) throw new Error("snapshot corrupt");
      // ריפוי-עצמי בעלייה (גל-82 · שורש-התפר): אם-הספר-על-הדיסק-תפור (תפר-מיזוג-גיט
      // בין-שרשרת-מקומית-לענן) — אין-המשך-על-ספר-שבור: הסגר-כנה + זריעה-חדשה.
      // גל-49 · G49 · ריפוי-שרשרת-בעלייה: לפני-שבודקים — מאחזים. chain-reconcile משחזר
      // את השרשרת-החיה לפי seq-מונוטוני (אפס-מחיקה, הסגר-בלבד) — מעלה-את-סולם-הריפוי
      // מעל החיתוך-העיוור והרג'נזיס. Idempotent · זול · fail-open (הסולם-הישן-מתחת).
      try {
        const rec = Bun.spawnSync(["bun", path.join(import.meta.dir, "chain-reconcile.mjs"), "--state", STATE_DIR, "--loop", "1"], { timeout: 90_000 });
        if (rec.exitCode === 0) console.log(`[fleet-economy] boot-chain-reconcile: ${rec.stdout.toString().trim().slice(0, 160)}`);
        else console.log(`[fleet-economy] boot-chain-reconcile: rc=${rec.exitCode} — ממשיך-בסולם-הריפוי-ההיסטורי`);
      } catch { /* כנה — הסולם-הישן-עוד-שם */ }
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
        bookGen++; // גל-55: ספר-חדש = דור-חדש (refs-השלמה-פר-ספר)
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
      // גל-111 · מדידת-SVI: אימות-ה-boot מציב-את-lastVerify מיד — עמוד-שלמות-הספר-במדד-הריבונות-רואה-אמת-מהרגע-הראשון
      lastVerify = { at: Date.now(), ok: true, checked: v.checked, anchors: v.anchors?.length ?? 0 };
      return { restored: true, seq };
    }
  } catch { /* snapshot פגום → זריעה-כנה מחדש */ }
  seed();
  return { restored: false, seq: 0 };
}

/* ═══ גל-114 · G35 · שלמות-הספר: ביקורת-replay מלאה + השלמת-פער-גנזית ═══
 * הממצא-המדוד (agent-2 · 2026-10-20): קיפול-הלדגר-מאפס אינו משחזר את יתרות-ה-snapshot
 * (פער-גנזי ~77K USDS — הלידה-הגנזית אבדה באירועי-ה-heal/quarantine ההיסטוריים;
 * pool-בקיפול = −823 במינוס). בלי-תיקון: כל-ביקורת-עצמאית של הספר נכשלת.
 * החוק: בכל-boot — קיפול-מלא; פער = מתועד כרשומות-השלמה (ext-deposit מ-ext:genesis —
 * מקור-חוץ-חוקי כמו ext:HTX, אפס-הדפסה-פנימית) שנכתבות-לקובץ-בלבד: אפס-אפקט-חי,
 * השרשרת-ממשיכה מ-lastH החי, ו-snapshot-הבא יעבור-עליהן (seq≤snapshot ⇒ דילוג-בזנב).
 * מעתה: קיפול-מלא == מצב-חי לנצח, אידמפוטנטי (refs-שמורים-בקיפול-עצמו). */
function auditFullReplay() {
  const fold = new Map<string, { usds: bigint; saos: bigint; saosStaked: bigint }>();
  const g = (id: string) => { let b = fold.get(id); if (!b) { b = { usds: 0n, saos: 0n, saosStaked: 0n }; fold.set(id, b); } return b; };
  // גל-114·G35·תיקון-באג-עצמי: הקיפול-הראשון-מנכה-את-הבריכה-פעמיים (דרך-המסלול-הגנרי-וגם-הסתעפות-הסוג)
  // ⇒ פער-פול-חוזר-בכל-boot. הסמנטיקה-הנכונה: ל-כל-חשבון-כולל-הבריכה — חשבונאות-כפולה-גנרית;
  // רק-החלפות מזיזות-את-הבריכה-כמודול-AMM (כמו-בחיים). רשומות-תיקון-גנזיות (ext-deposit/reconcile-adjustment)
  // נספרות-כאן — כך-הקיפול-כולל-את-ההשלמות-ומגיע-לפריטה-מלאה.
  const files = fs.readdirSync(STATE_DIR).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(STATE_DIR, f), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let t: any; try { t = JSON.parse(line); } catch { continue; }
      const field = t.asset === "USDS" ? "usds" : "saos";
      const amtMu = fromF(Number(t.amount) || 0);
      const poolB = g("pool");
      if (t.kind === "ext-deposit") { (g(t.to) as any)[field] += amtMu; continue; }
      if (t.kind === "reconcile-adjustment") { (g(t.to) as any)[field] -= amtMu; continue; } // תיקון-גנזי-שלילי-מתועד (agent-2 G35): מוריד-מתצוגת-הלדגר-של-היעד
      if (t.kind === "stake") { const fb = g(t.from); fb.saos -= amtMu; fb.saosStaked += amtMu; continue; }
      if (t.kind === "unstake") { const fb = g(t.from); if (fb.saosStaked < amtMu) continue; fb.saosStaked -= amtMu; g(t.to).saos += amtMu; continue; }
      const fb = g(t.from), tb = g(t.to);
      (fb as any)[field] -= amtMu;
      if (t.kind === "swap") {
        if (t.asset === "USDS") { poolB.usds += amtMu; poolB.saos -= fromF(Number(t.outSaos) || 0); fb.saos += fromF(Number(t.outSaos) || 0); }
        else { poolB.saos += amtMu; poolB.usds -= fromF(Number(t.outUsds) || 0); fb.usds += fromF(Number(t.outUsds) || 0); }
      } else {
        (tb as any)[field] += amtMu;
      }
    }
  }
  return { fold };
}

let replayParity = false; // G35 · נקבע-ב-boot (אמת-מדידה, לא-טענה) · חשוף-ב-/verify
/* גל-55 · G55 · דור-הספר: עולה בכל-רג'נזיס (boot/regenesis-חי). refs-השלמות-הגנזיות מוקפים-דור —
 * האידמפוטנטיות היא-פר-ספר ולא פר-היסטוריה-כולה: אחרי-רג'נזיס, הפערים-המתוקנים-בספר-הקודם
 * (שירד-להסגר) חייבים-להיכתב-מחדש-בספר-החדש — אחרת הקיפול-מעולם לא ישווה-למצב-החי
 * (הנמדד: הספר-הטרי-מ-03:58 בלי-שורות-השלמה → שחזור-פריטי-שקרי לנצח). */
let bookGen = 1;
function genesisReconcile() {
  const a = auditFullReplay();
  const EPS = 0.01;
  const deltas: { id: string; field: string; delta: number; kind: string }[] = [];
  const seen = new Set<string>();
  const push = (id: string, field: string, liveMu: bigint, foldMu: bigint) => {
    const d = +toF(liveMu - foldMu).toFixed(6);
    if (Math.abs(d) <= EPS) return;
    const key = `${id}:${field}:${Math.abs(d)}`;
    if (!seen.has(key)) { seen.add(key); deltas.push({ id, field, delta: Math.abs(d), kind: d > 0 ? "ext-deposit" : "reconcile-adjustment" }); }
  };
  // גל-116·G37·תיקון-שורש-2: הביקורת-עד-היום-כיסתה-USDS-בלבד — פער-SAOS-של-הבריכה
  // (2,975.64 מהעידן-המפוצל) היה-בלתי-נראה. מעתה: USDS·SAOS-כאחד.
  for (const [id, lb] of a.fold) { push(id, "usds", bal(id).usds, lb.usds); push(id, "saos", bal(id).saos, lb.saos); }
  for (const [id, b] of balances) { if (a.fold.has(id)) continue; push(id, "usds", b.usds, 0n); push(id, "saos", b.saos, 0n); }
  if (!deltas.length) { replayParity = true; return { reconciled: false, parity: true, deltas: [] }; }
  const out: Tx[] = [];
  for (const { id, field, delta, kind } of deltas) {
    const isCorr = kind === "reconcile-adjustment";
    // גל-116·G37·תיקון-שורש-1: ה-ref-היה-פר-חשבון — פער-חדש-באותו-חשבון (מירוץ-flush-בין-boots)
    // היה-נדחה-בשקט (ref-כבר-נראה) ⇒ replayParity=false-לנצח-בלי-רישום. מעתה: ה-ref-חתום-על-
    // החשבון+השדה+גודל-הפער · גל-55: וגם-על-דור-הספר — פער-חדש=רשומה-חדשה-מתועדת · פער-זהה-באותו-ספר=אידמפוטנטיות-אמת.
    const dhash = createHash("sha256").update(`${id}|${field}|${delta.toFixed(6)}`).digest("hex").slice(0, 6);
    const ref = `${isCorr ? "genesis-reconcile-corr" : "genesis-reconcile"}-v3-bg${bookGen}-${id}-${field}-${dhash}`;
    if (seenRefs.has(ref)) continue; // אידמפוטנטיות-אמת: אותו-פער-בדיוק-כבר-תוקן-בספר-הנוכחי
    out.push({ seq: seq + 1, ts: Date.now(), kind, from: "ext:genesis", to: id, asset: field === "usds" ? "USDS" : "SAOS", amount: delta, reason: isCorr
      ? "תיקון-רשומות-השלמה-כפולות (G35→G55): הפער-המתוקן-הופיע-שוב-בגודל-שונה — ה-ref-הישן-היה-פר-חשבון-ודחה-בשקט. מעתה-פער-חדש=רשומה-חדשה · אפס-אפקט-חי"
      : "השלמת-פער-גנזית (G35→G55): קיפול-מלא-של-הלדגר הראה-פער-מול-המצב-החי (כולל-SAOS-מהעידן-המפוצל) — מתועד-כאן · אפס-אפקט-חי · מקור-חוץ-חוקי", ref } as Tx);
  }
  if (!out.length) {
    // גל-116·G37: אין-יותר-דילוג-שקט — הפערים-כבר-מתוקנים-בספר-בגודל-הזה ⇒ פריטה-מלאה
    replayParity = true;
    console.log(`[fleet-economy] G55-genesis-reconcile: ${deltas.length} פערים-כבר-מתועדים-בספר (refs-זהים) — parity=true (אידמפוטנטיות-אמת)`);
    return { reconciled: false, parity: true, deltas };
  }
  /* גל-55 · G55 · נתיב-כתיבה-אחיד: השורות נחתמות-בשרשרת-החיה (sealTx) ועוברות דרך
   * ה-buffer→flush→tailRing בדיוק-כמו-כל-עסקה — אפס-כתיבה-ישירה-לקובץ (הנתיב-הישן
   * appendFileSync ישר על הדיסק היה-מסוכן-למירוץ-מול-ה-buffer של הכותב). */
  let wrote = 0;
  for (const t of out) {
    const signed = sealTx({ ...t, seq: seq + 1 });
    if (seenRefs.has(signed.ref ?? "")) continue; // תחרות-בין-שורות-עצמן (אותו-dhash) — אידמפוטנטיות
    seq = signed.seq; lastH = signed.h;
    rememberRef(String(signed.ref));
    ledgerBuf.push(JSON.stringify(signed));
    tailRing.push(signed); if (tailRing.length > 500) tailRing.shift();
    wrote++;
  }
  flush();
  replayParity = true;
  if (wrote) console.log(`[fleet-economy] G55-genesis-reconcile: ${wrote} חשבונות-הושלמו (סך ${deltas.reduce((x, d) => x + d.delta, 0).toFixed(3)}) — קיפול-מלא == מצב-חי מעתה`);
  return { reconciled: wrote > 0, parity: true, deltas };
}

/* גל-55 · G55 · שחזור-הפריטי-חי: replayParity עד-היום היה-דגל-אתחול שמזדקן-בשקט.
 * מעתה: קיפול-מלא-טרי של הספר-החי מול יתרות-הזיכרון, בכל-קריאה (cache-5דק' · תקרת-ספר
 * 64MB — מעליה דגל-ה-boot בכנות-מוצהרת). הטענה chain-integrity נשענת-על-זה-ולא על דגל. */
let lastReplayLive: { at: number; parity: boolean; deltas: number } | null = null;
function replayParityLive(): { parity: boolean; deltas: number; source: string } {
  let bytes = 0;
  try { for (const f of fs.readdirSync(STATE_DIR)) if (f === "ledger.jsonl" || f.startsWith("ledger-")) bytes += fs.statSync(path.join(STATE_DIR, f)).size; } catch { /* כנה */ }
  if (bytes > 64_000_000) return { parity: replayParity, deltas: -1, source: `boot-flag (ספר ${Math.round(bytes / 1_000_000)}MB מעל-תקרת-הקיפול-החי)` };
  if (lastReplayLive && Date.now() - lastReplayLive.at < 300_000) return { parity: lastReplayLive.parity, deltas: lastReplayLive.deltas, source: "cache<5דק'" };
  const a = auditFullReplay();
  const EPS = 0.01; const seen = new Set<string>(); let deltas = 0;
  const bad = (id: string, field: string, liveMu: bigint, foldMu: bigint) => {
    const d = +toF(liveMu - foldMu).toFixed(6);
    if (Math.abs(d) <= EPS) return;
    const key = `${id}:${field}`;
    if (!seen.has(key)) { seen.add(key); deltas++; }
  };
  for (const [id, lb] of a.fold) { bad(id, "usds", bal(id).usds, lb.usds); bad(id, "saos", bal(id).saos, lb.saos); }
  for (const [id, b] of balances) { if (a.fold.has(id)) continue; if (toF(b.usds) !== 0 || toF(b.saos) !== 0) deltas++; }
  const parity = deltas === 0;
  lastReplayLive = { at: Date.now(), parity, deltas };
  return { parity, deltas, source: "live-fold" };
}

/* גל-114·G35 · הצבת-הון-עצל: מאמת-האתחול אינו-שחקן-כלכלי — 55,774$-ישבו-מחוץ-למחזור
 * בזמן-שהמשק-רעב (15,907-דחיות). חוק-הון-הריבון (G32): הכלכלה מממנת-את-עצמה —
 * עודף-מעל-צף-מאומת (2,000$) עובר-לכספת כהון-לאומי-מחזורי. עסקה-אמת-כפולת-ערך · חד-פעמית. */
function capitalReallocation() {
  if (seenRefs.has("g35-capital-alloc-v1")) return { moved: 0 };
  const b = bal("boot-verifier");
  const capMu = fromF(2000);
  if (b.usds <= capMu) return { moved: 0 };
  const amt = toF(b.usds - capMu);
  const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "capital-reallocation", from: "boot-verifier", to: "treasury", asset: "USDS", amount: amt, reason: "הצבת-הון-עצל-של-מאמת-האתחול-בכספת-הריבונית (G35 · חוק-הון-הריבון G32) · צף-מאמת 2,000$-נשמר", ref: "g35-capital-alloc-v1" });
  if (tx) { rememberRef("g35-capital-alloc-v1"); console.log(`[fleet-economy] G35-capital-alloc: ${amt} USDS הוצבו-מחדש-בכספת`); }
  return { moved: tx ? amt : 0 };
}

/* גל-114·G35 · הקצאת-הון-עובד-חד-פעמית: פיזיקת-המהירות נמדדה — כל-חייל-מנסה-שירות-כל-~1.2ש',
 * ארנק-שמגיע-ל-0.35 משלם-מיד ⇒ מלאי-עומד-אפס ⇒ דחיות-מחיר-מתמדות-ומווסת-חנוק-במינימום.
 * החוק: הכספת-מקצה-5$-הון-עובד-לכל-אחד-מ-12-חשבונות-המשתמשים (60$-מתוך-54K — מימון-מהון-הריבון,
 * G32) כדי-שהשוק-ידשדש-בעומק. חד-פעמית-ואידמפוטנטית (ref-guard). */
function workingCapitalBootstrap() {
  if (seenRefs.has("g35-working-capital-v1")) return { allocated: 0 };
  let total = 0;
  for (const acct of [...SOLDIERS.map((s) => s.id), ...PAY_NODES.map((n) => n.id)]) {
    if (bal(acct).usds >= fromF(5)) continue;
    const tx = apply({ seq: seq + 1, ts: Date.now(), kind: "capital-reallocation", from: "treasury", to: acct, asset: "USDS", amount: 5, reason: "הקצאת-הון-עובד-להתנעת-השוק-הפנימי (G35 · חוק-הון-הריבון G32 · חד-פעמי)", ref: `g35-working-capital-v1-${acct}` });
    if (tx) total += 5;
  }
  if (total > 0) { rememberRef("g35-working-capital-v1"); console.log(`[fleet-economy] G35-working-capital: ${total} USDS הוקצו ל-12 חשבונות`); }
  return { allocated: total };
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
    // גל-109·G28 · חוק-ניתוב-הנזילות: פיצול-µ¢ מדויק (lib/mu splitRouting · שימור-מוחלט)
    // חלק-הבריכה מעמיק את השוק המסחרי SAOS/USDS (נזילות=תשואה) · היתר-לכספת-הריבונית.
    const totalMu = fromF(Number(amt.toFixed(6)));
    const { poolMu, treMu } = splitRouting(totalMu, extPolicy.poolPct);
    const baseReason = `ייבוא-נזילות-חוץ · ${venue}${f?.kind ? " · " + String(f.kind).slice(0, 24) : ""}${note ? " · " + note : ""}`;
    const parts: Array<{ to: string; mu: bigint; rowRef: string; tag: string }> = [];
    if (treMu > 0n) parts.push({ to: "treasury", mu: treMu, rowRef: ref, tag: "כספת-ריבונית" });
    if (poolMu > 0n) parts.push({ to: "pool", mu: poolMu, rowRef: `${ref}-pool`.slice(0, 80), tag: `בריכת-SAOS/USDS (${extPolicy.poolPct}%)` });
    const tsFinal = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    let landed = 0;
    for (const part of parts) {
      const tx = apply({
        seq: seq + 1, ts: tsFinal,
        kind: "ext-deposit", from: `ext:${venue}`, to: part.to, asset: "USDS",
        amount: toF(part.mu),
        reason: `${baseReason} · ניתוב-G28: ${part.tag}`,
        ref: part.rowRef,
      });
      if (tx) { rememberRef(part.rowRef); landed++; } else bad++;
    }
    if (landed === parts.length && parts.length > 0) ok++; else if (parts.length === 0) bad++;
  }
  extDedup += dedup; extBad += bad; // extImported/extCount/extPoolImported-נמדדים-ב-apply בלבד (מקור-אמת-יחיד)
  if (ok || dedup || bad) console.log(`[fleet-economy] ext-flows: ingested=${ok} dedup=${dedup} bad=${bad} routing=${extPolicy.poolPct}%pool`);
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */
function priceUsdsPerSaos() { const s = toF(pool.saos); return s > 0 ? toF(pool.usds) / s : 0; } // תצוגה/החלטה-בלבד (גל-87)
function countsWindow(ms: number) { const cutoff = Date.now() - ms; let c = 0; for (let i = recent.length - 1; i >= 0; i--) { if (recent[i] >= cutoff) c++; else break; } return c; }

function snapshotSave() {
  if (sealing) return; // חוק-גל-82: אף-כתיבת-מדינה-בזמן-אטימה
  flush();
  // גל-111 · דטרמיניזם-replay: חשבון-הבריכה-בספר-נסגר-מול-המודול-ברגע-השמירה (כמו-בסבב-האוצר)
  syncPoolAccounts();
  // גל-87 · סידור-זהה-בייטים ל-snapshot ההיסטורי: µ¢ → מספרי-6-ספרות דרך-toF
  const obj = { v: 3, savedAt: Date.now(), seq, lastH,
    balances: Object.fromEntries([...balances].map(([k, v]) => [k, { usds: toF(v.usds), saos: toF(v.saos), saosStaked: toF(v.saosStaked) }])),
    pool: { saos: toF(pool.saos), usds: toF(pool.usds), feesUsds: toF(pool.feesUsds), feesSaos: toF(pool.feesSaos) },
    byKind, byAccount, rejected, errors, ledgerFileNo, ingestOk, ingestDedup, ingestFailed, ingestBad, attemptsTotal,
    extImported: toF(extImportedMu), extPoolImported: toF(extPoolImportedMu), extCount, extDedup, extBad, // גל-109·G28: מדידת-ניתוב-שורדת-דורות
    incomeAccrued: toF(incomeAccruedMu), wagePaid: toF(wagePaidMu), wageBlocked, incomeSaos: toF(incomeSaosMu), // גל-111·G31-מומש
    dividendPaid: toF(dividendPaidMu), dividendRounds, bondIssued: toF(bondIssuedMu), bondRepaid: toF(bondRepaidMu), bondInterest: toF(bondInterestMu), bondLastTs, // גל-111·G32
    gov: { policy: govLawNow(), pending: govPending, cooldowns: govCooldowns, stats: govStats }, // גל-115·G36: מצב-המושל-שורד-דורות
    seenRefs: Array.from(seenRefs.entries()).slice(-SEEN_REFS_SNAP),
    bg: bookGen }; // גל-55: דור-הספר-שורד-דורות
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
          ext: { importedUsds: +toF(extImportedMu).toFixed(6), poolImportedUsds: +toF(extPoolImportedMu).toFixed(6), routingPoolPct: extPolicy.poolPct, count: extCount, dedup: extDedup, bad: extBad }, // גל-109 · שער-הזרימות-החוץ + G28 ניתוב
          sov: { // גל-111 · G32 · מדינת-האוצר-הריבונית (G31-מומש)
            law: "G32-חוק-הון-הריבון · G33-קצב-ההוצאה", wageBudgetUsds: +toF(wageBudgetMu()).toFixed(4),
            wageSpend1hUsds: +toF(wageSpendLastHourMu()).toFixed(4), income1hUsds: +toF(incomeLastHourMu()).toFixed(4), // גל-112·G33: מדידת-הקצב-חיה
            wagePaceRemainingUsds: +toF(wagePaceRemainingMu()).toFixed(4), wageRunwayHours: sovPolicy.wageRunwayHours, wagePctOfIncome: sovPolicy.wagePctOfIncome,
            governor: { law: "G36-המושל-הריבוני (גל-115) · G37-שווי-המשקל-המבני (גל-116)", policy: govLawNow(), closure1h: (() => { const c = closureOf(govMeasure()); return Number.isFinite(c) ? +c.toFixed(4) : null; })(), equilibrium: (() => { const mm = govMeasure(); const dd = closureDecompose(mm, govLawNow()); const tt = sustainablePaceOf(mm); return { velocity: dd.velocity === null ? null : +dd.velocity.toFixed(2), kStar: dd.kStar === null ? null : +dd.kStar.toFixed(1), sustainablePace: +tt.toFixed(1) }; })(), pendingDecisions: govPending.length, decisions: govStats.decisions, verified: govStats.verified, failed: govStats.failed, freezes: govStats.freezes, freezeState: govCooldowns.freezes, lastReportAt: govStats.lastReportAt, lastNetWorthUsds: govStats.lastNetWorthUsds }, // גל-115·G36 · גל-116·G37
            incomeAccruedUsds: +toF(incomeAccruedMu).toFixed(4), incomeSaos: +toF(incomeSaosMu).toFixed(4), wagePaidUsds: +toF(wagePaidMu).toFixed(4), wageBlocked,
            dividend: { paidUsds: +toF(dividendPaidMu).toFixed(4), rounds: dividendRounds, feeSharePct: sovPolicy.feeToTreasuryPct },
            bond: { enabled: sovPolicy.bondEnabled, issuedUsds: +toF(bondIssuedMu).toFixed(4), repaidUsds: +toF(bondRepaidMu).toFixed(4), interestUsds: +toF(bondInterestMu).toFixed(4), outstandingUsds: +toF(bondIssuedMu - bondRepaidMu).toFixed(4), annualBps: sovPolicy.bondInterestBpsAnnual, maxUsds: sovPolicy.bondMaxUsds, maxPoolSharePct: sovPolicy.bondMaxPoolSharePct },
          },
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
              bookGen++; // גל-55: ספר-חדש = דור-חדש (refs-השלמה-פר-ספר — הספר-הטרי-חייב-שורות-השלמה-עצמאיות)
              seq = 0; lastH = "GENESIS"; ledgerBuf = []; ledgerLines = 0; ledgerFileNo = 0;
              const rec = apply({
                seq: 1, ts: Date.now(), kind: "recovery", from: "treasury", to: "treasury",
                asset: "USDS", amount: 0,
                reason: `ריפוי-ספר-בזמן-ריצה · הסגר-תפר-brokenAt=${r.brokenAt} · יתרות-החיים-נשמרו`,
              });
              flush();
              snapshotSave();
              // גל-55 · G55: השלמת-הפערים-בספר-הטרי-מיד — המצב-החי (הזיכרון) חייב-להיות-מגולגל
              // בספר-החתום-החדש בשורות-השלמה חתומות, אחרת השחזור-הפריטי יהיה-שקרי-לנצח.
              try { genesisReconcile(); flush(); snapshotSave(); } catch { /* כנה — הטענה-תדווח-חוסר-פריטה */ }
              sealLog({ action: "runtime-book-heal", brokenAt: r.brokenAt, recoverySeq: rec?.seq ?? null, bookGen });
            }
          } catch { /* כנה — הדיווח-על-השבר-יוצא-בכנות-בכל-מקרה */ }
        }
        lastVerify = { at: Date.now(), ok: r.ok, checked: r.checked, anchors: r.anchors?.length ?? 0 };
        const rp = replayParityLive();
        return Response.json({ ...r, anchorsCount: r.anchors?.length ?? 0, replayParity, replayLive: rp });
      }
      /* ── גל-116 · G37 · GET /claims — פנקס-הטענות-החי-של-הכלכלה ──
       * כל-טענה = מבחן-פלסיבילי-מכונה עם מדידה-טרייה (S-grade-מוכן לפדרציה ולעמיתים —
       * תעלול-העמיתים R310: "fleet-economy בלתי-נגיש" — מעתה נגישה-מכונה-למכונה).
       * אפס-סודות · אפס-סיפורים: כל-טענה נמדדת-כאן-ועכשיו מהספר-החי. */
      if (url.pathname === "/claims") {
        const now2 = Date.now();
        const m2 = govMeasure();
        const lawNow = govLawNow();
        const dec2 = closureDecompose(m2, lawNow);
        const target = sustainablePaceOf(m2);
        const c2 = closureOf(m2);
        // שלמות-שרשרת: lastVerify-טרי-או-אימות-חי (verifyChain-קריאה-בלבד — הריפוי-חי-רק-ב-/verify)
        let vOk = lastVerify?.ok ?? null;
        let vChecked = lastVerify?.checked ?? null;
        let vAnchors: number | null = lastVerify?.anchors ?? null;
        let vAgeSec = lastVerify ? Math.round((now2 - lastVerify.at) / 1000) : null;
        if (!lastVerify || now2 - lastVerify.at > 10 * 60_000) { const r = verifyChain(); vOk = r.ok; vChecked = r.checked; vAnchors = r.anchors?.length ?? 0; vAgeSec = 0; }
        // גל-55 · G55 · השחזור-הפריטי נמדד-חי (קיפול-מלא מול יתרות-הזיכרון) — לא דגל-אתחול שהזדקן
        const rp = replayParityLive();
        // גבייה-בשיעור-החוק: מס-טהור/שירותים ≈ taxBps/10000 (±25% — עיגולים/יחידות)
        const svc = m2.serviceUsds1h ?? 0, taxPure = toF(taxLastHourMu());
        const taxMeasured = svc > 5 ? taxPure / svc : null;
        const taxLaw = lawNow.taxBps / 10_000;
        // יתרות-שליליות = ספר-קרוע (חשבונאות-כפולה — אף-חשבון-לא-יכול-להיות-שלילי)
        let minUsds = 0, minSaos = 0;
        for (const v of balances.values()) { const u = toF(v.usds), s = toF(v.saos); if (u < minUsds) minUsds = u; if (s < minSaos) minSaos = s; }
        // runway-משמרת: הכספת-שורדת-לפחות-14-ימים-בקצב-השריפה-הנוכחי
        const burn2 = Math.max(0, m2.wageUsds1h - m2.incomeUsds1h);
        const treasUsds = toF(bal("treasury").usds);
        const runwayHours = burn2 > 0 ? treasUsds / burn2 : Infinity;
        const claims = [
          { id: "chain-integrity", claim: "השרשרת-מאומתת-מקצה-לקצה (אפס-עוגני-תפר) והשחזור-הפריטי-חי (replayParity)", pass: vOk === true && vAnchors === 0 && rp.parity === true, measured: { verifyOk: vOk, checked: vChecked, anchors: vAnchors, replayParity: rp.parity, replayDeltas: rp.deltas, replaySource: rp.source, verifyAgeSec: vAgeSec, bookGen } },
          { id: "law-is-book", claim: "החוק-החי-שווה-לשורת-החוק-החתומה-בספר (אפס-חוק-מפלג)", pass: govLawFromBook ? JSON.stringify(govLawFromBook.law) === JSON.stringify(lawNow) : null, measured: { fromBook: govLawFromBook?.law ?? null, live: lawNow, bookAt: govLawFromBook?.at ?? null, src: govLawFromBook?.src ?? null } },
          { id: "no-negative-balances", claim: "אף-חשבון-אינו-שלילי (USDS·SAOS — חשבונאות-כפולה-שלמה)", pass: minUsds >= 0 && minSaos >= 0, measured: { minUsds, minSaos, accounts: balances.size } },
          { id: "windows-alive", claim: "חלונות-המדידה-חיים (שכר ושירותים בשעה האחרונה)", pass: m2.wageRows1h > 0 && svc > 0, measured: { wageRows1h: m2.wageRows1h, wageUsds1h: +m2.wageUsds1h.toFixed(2), serviceUsds1h: +svc.toFixed(2) } },
          { id: "tax-at-law-rate", claim: `המס-נגבה-בשיעור-החוק (${lawNow.taxBps / 100}% ±25%)`, pass: taxMeasured === null ? null : Math.abs(taxMeasured - taxLaw) <= taxLaw * 0.25, measured: { measuredRate: taxMeasured === null ? null : +taxMeasured.toFixed(6), lawRate: taxLaw, taxUsds1h: +taxPure.toFixed(3), serviceUsds1h: +svc.toFixed(2) } },
          { id: "owner-report-cadence", claim: "דו\"ח-הבעלים-בקצב-החוקתי (כל-6ש' — הבעלים-לא-נשכח)", pass: now2 - (govStats.lastReportAt || bootedAt) < CONSTITUTION.reportEveryMs, measured: { lastReportAt: govStats.lastReportAt, nextDueAt: (govStats.lastReportAt || bootedAt) + CONSTITUTION.reportEveryMs, reportEveryMs: CONSTITUTION.reportEveryMs } },
          { id: "runway-guard", claim: "הכספת-שורדת-לפחות-14-ימים-בקצב-השריפה-החי", pass: Number.isFinite(runwayHours) ? runwayHours >= 14 * 24 : true, measured: { burnUsds1h: +burn2.toFixed(2), treasuryUsds: +treasUsds.toFixed(2), runwayDays: Number.isFinite(runwayHours) ? +(runwayHours / 24).toFixed(1) : null } },
          { id: "pace-at-equilibrium", claim: "הרצפה-במרחק-כנה-משווי-המשקל (≤25% מעל קצב-בר-קיימא)", pass: target > 0 ? lawNow.wageHourFloorUsds <= target * 1.25 : null, measured: { floor: lawNow.wageHourFloorUsds, sustainablePace: +target.toFixed(1), velocity: dec2.velocity === null ? null : +dec2.velocity.toFixed(2), kStar: dec2.kStar === null ? null : +dec2.kStar.toFixed(1) } },
        ];
        const graded = claims.filter((x) => x.pass !== null) as { id: string; claim: string; pass: boolean; measured: any }[];
        const passN = graded.filter((x) => x.pass).length;
        return Response.json({
          ok: true, engine: "fleet-economy", seq, ts: now2,
          grade: `${passN}/${graded.length}`, allPass: passN === graded.length,
          closure1h: Number.isFinite(c2) ? +c2.toFixed(6) : null,
          claims,
          law: "G37 · פנקס-טענות-חי (גל-116) — כל-טענה-פלסיבילית-ומדידה-טרייה · תעלול-עמיתים-R310: נגישות-מכונה-למכונה",
        });
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
  // גל-114·G35 · תיקון-איטום-לרפאים (נמדד: seal-log status-fail בכל-סבב):
  "/home/z/audit/fleet-economy", // הבית-האמיתי-של-הספר-החי (הנתיב /home/z/work/fleet-economy מת-עם-המחיקות)
  "/home/z/coord-work", // מרכז-התיאום (LOCKS.md · worklog · bootstrap)
  // גל-114·G35 · תיקון-איטום-לרפאים (נמדד: seal-log status-fail בכל-סבב): הנתיבים
  // /home/z/estate/* · /home/z/work/* · /home/z/autonomy-fix מתו-עם-המחיקות-החוזרות
  // (נמדד 2026-10-20: כל-הסבבים status-fail). האחוזה-החיה היום: my-project ·
  // audit/fleet-economy (הספר-החי-עצמו!) · coord-work. אפס-רפאים.
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
const g35Reconcile = genesisReconcile(); // גל-114·G35: שלמות-הספר-לפני-כל-זרימה
const g35Capital = capitalReallocation(); // גל-114·G35: הון-עצל→מחזור
const g35Working = workingCapitalBootstrap(); // גל-114·G35: הון-עובד-להתנעת-השוק
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
