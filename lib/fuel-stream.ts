/* ═══ fuel-stream.ts — מפעל-התדלוק הריבוני · חוק-הטפטוף הדטרמיניסטי ═══
 * ===========================================================================
 * G77-b (מנדט-בעלים §1.3 · trace 1a178c595ee6edd5): זרימת-דלק אוטומטית-רציפה
 * מהכספת-הריבונית אל חיילי-הגריד (כולל saos-0004) — המסילה-הפנימית (credits)
 * של הכלכלה; מסילת-המימון-החוץ (STEEM/SBD) נכנסת דרך שער-הזרימות (ext-flows,
 * provenance venue+txid) — כאן נזרקת-רק-כספת-אמת, אפס-הדפסה, אפס-יתרות-מפוברקות.
 *
 * חוזה טהור (אפס-I/O · אפס-שעון-קיר · אפס-רשת — השעון מוזרק כ-nowMs):
 *  (a) FLOOR   — חייל-מתחת-לרצפה מתודלק בדיוק min(רצפה−יתרה, maxDrip).
 *  (b) CEILING — חייל-מעל-הרצפה לא מקבל כלום; אף-טפטוף לא דוחף מעל-הרצפה.
 *  (c) RESERVE — הכספת-שומרת-לפחות reserveMu; התקציב-החוקי = מזומן−רזרבה.
 *                מחסור ⇒ ok:false + קבלת-חסימה כנה (fuel-blocked-<planId>) —
 *                אפס-טפטוף, אפס-שקר: treasuryAfter === treasuryBefore.
 *  (d) CAP     — סך-המחזור ≤ cycleCap; ניצול-בסדר-הרשומה; הנותרים חסומים-כנים.
 *  (e) IDEMPOTENCE — planId = sha256(ליבה-קנונית: roster+יתרות+מדיניות+מחזור)[:16]
 *                השעון-נשלל-מה-id; ref-טפטוף = fuel-<planId>-<חייל> — dedup-המנוע
 *                (seenRefs) הופך כל-הוצאה-חוזרת של אותו-מחזור לאידמפוטנטית.
 *  (f) FAIL-CLOSED — רשומה-ריקה/מדיניות-פסולה ⇒ תוכנית-חסומה-מנומקת (אף-המצאה).
 *
 * אריתמטיקה: BigInt µ¢ בלבד (חוק-כסף-שלם · lib/mu) — ערכי-פלואט נכנסים רק
 * דרך fromF בשכבת-הקריאה. סדר-הרשומה קובע (דטרמיניזם-מלא לקבלות-השרשרת).
 * צורת-התוכנית משקפת את חוקי-planner של rc-rebalance (המש-מצפה planId
 * דטרמיניסטי-נשלל-שעון + blocked-מנומקים) — אינטגרציית-מש בצריכה-בלבד,
 * אפס-נגיעה ב-control-center.
 */
import { createHash } from "crypto";
import type { Mu } from "./mu";

export type FuelPolicy = {
  cycleMs: number; // פרק-המחזור (לוח-הזמנים הדטרמיניסטי)
  floorMu: Mu; // רצפת-ארנק — מתחתיה נזרק דלק (עד-כאן)
  ceilingMu: Mu; // תקרת-ארנק — מעליה לעולם לא נזרק (מידע-חוקתי; floor ≤ ceiling)
  reserveMu: Mu; // רזרבת-כספת — מתחתיה הזרם-כולו נחסם בכנות
  maxDripMu: Mu; // תקרת-מנה-לטפטוף
  cycleCapMu: Mu; // תקרת-סך-למחזור
};

export type FuelDrip = { to: string; amountMu: Mu; ref: string; reason: string };
export type FuelBlocked = { subject: string; reason: string; ref?: string };
export type FuelReason =
  | "dripped"
  | "all-above-floor"
  | "blocked-insufficient-treasury"
  | "blocked-empty-roster"
  | "blocked-invalid-policy";

export type FuelPlan = {
  ok: boolean;
  reason: FuelReason;
  cycle: number;
  planId: string;
  nowMs: number;
  drips: FuelDrip[];
  blocked: FuelBlocked[];
  treasuryBeforeMu: Mu;
  treasuryAfterMu: Mu;
  totalMu: Mu;
};

export const FUEL_LAW =
  "G77-b-חוק-הטפטוף: רצפה/תקרה/רזרבה/תקרת-מחזור · planId-אידמפוטנטי · fail-closed-על-מחסור · אפס-הדפסה";

export const FUEL_REF_PREFIX = "fuel";
export const FUEL_BLOCKED_PREFIX = "fuel-blocked";

/** מדיניות-הייצור (µ¢ — סקאלה-עקבית-עם-המשק-הפנימי: שירותים 0.35–3.2$ · רצפת-משרד 3$) */
export const FUEL_POLICY_DEFAULT: FuelPolicy = {
  cycleMs: 120_000, // מחזור-טפטוף 2 דק'
  floorMu: 2_000_000n, // רצפת-ארנק 2 USDS
  ceilingMu: 25_000_000n, // תקרה 25 — מעליה החייל-עשיר-בכנה
  reserveMu: 150_000_000n, // רזרבת-כספת 150 (כחוק-bondTrigger)
  maxDripMu: 2_000_000n, // מנה-מקסימלית 2 USDS
  cycleCapMu: 10_000_000n, // תקרת-מחזור 10 USDS
};

/** מדיניות-פסולה? — כל-הפרה ⇒ fail-closed בכנות (לא-תיקון-שקט). */
export function fuelPolicyInvalid(p: FuelPolicy): string | null {
  if (!Number.isFinite(p.cycleMs) || p.cycleMs <= 0) return "cycleMs-לא-חיובי";
  if (p.floorMu < 0n) return "רצפה-שלילית";
  if (p.ceilingMu < p.floorMu) return "תקרה-מתחת-לרצפה";
  if (p.reserveMu < 0n) return "רזרבה-שלילית";
  if (p.maxDripMu <= 0n) return "מנה-לא-חיובית";
  if (p.cycleCapMu <= 0n) return "תקרת-מחזור-לא-חיובית";
  return null;
}

/** מחזור-דטרמיניסטי: ⌊now/cycleMs⌋ — אותו-זמן ⇒ אותו-מחזור, תמיד. */
export function fuelCycleIndex(nowMs: number, cycleMs: number): number {
  return Math.floor(nowMs / cycleMs);
}

const canonical = (o: unknown): string => JSON.stringify(o);

/** planId = sha256(ליבה-קנונית)[:16] — הליבה: roster+יתרות-ממוינות+מדיניות+מחזור.
 * השעון-נשלל: אותם-קלטות-כלכליות באותו-מחזור ⇒ אותו-id (חוק-האידמפוטנטיות). */
export function fuelPlanId(input: {
  roster: readonly string[];
  balances: readonly { id: string; usds: Mu }[];
  policy: FuelPolicy;
  cycle: number;
}): string {
  const balancesSorted = [...input.balances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const core = {
    roster: [...input.roster],
    balances: balancesSorted.map((b) => ({ id: b.id, usds: b.usds.toString() })),
    policy: {
      cycleMs: input.policy.cycleMs,
      floorMu: input.policy.floorMu.toString(),
      ceilingMu: input.policy.ceilingMu.toString(),
      reserveMu: input.policy.reserveMu.toString(),
      maxDripMu: input.policy.maxDripMu.toString(),
      cycleCapMu: input.policy.cycleCapMu.toString(),
    },
    cycle: input.cycle,
  };
  return createHash("sha256").update(canonical(core), "utf8").digest("hex").slice(0, 16);
}

/** מפעל-התדלוק — טהור לחלוטין. המנוע מבצע (apply) לפי התוכנית; כאן אפס-ביצוע. */
export function planFuelStream(
  nowMs: number,
  roster: readonly string[],
  balances: ReadonlyMap<string, Mu>,
  treasuryMu: Mu,
  policy: FuelPolicy,
): FuelPlan {
  const base = { nowMs, treasuryBeforeMu: treasuryMu, treasuryAfterMu: treasuryMu, totalMu: 0n };
  const invalid = fuelPolicyInvalid(policy);
  if (invalid) {
    return { ...base, ok: false, reason: "blocked-invalid-policy", cycle: fuelCycleIndex(nowMs, Math.max(1, policy.cycleMs || 1)), planId: fuelPlanId({ roster, balances: [...balances].map(([id, usds]) => ({ id, usds })), policy, cycle: fuelCycleIndex(nowMs, Math.max(1, policy.cycleMs || 1)) }), drips: [], blocked: [{ subject: "policy", reason: `מדיניות-פסולה (fail-closed): ${invalid}` }] };
  }
  if (!roster.length) {
    const cycle = fuelCycleIndex(nowMs, policy.cycleMs);
    return { ...base, ok: false, reason: "blocked-empty-roster", cycle, planId: fuelPlanId({ roster, balances: [...balances].map(([id, usds]) => ({ id, usds })), policy, cycle }), drips: [], blocked: [{ subject: "roster", reason: "רשומת-הגריד-ריקה — אין-למי-לזרוק (fail-closed, אפס-המצאה)" }] };
  }
  const cycle = fuelCycleIndex(nowMs, policy.cycleMs);
  const planId = fuelPlanId({ roster, balances: [...balances].map(([id, usds]) => ({ id, usds })), policy, cycle });
  // מועמדים — בסדר-הרשומה בלבד (דטרמיניזם): מתחת-לרצפה = צריך-דלק
  const wants: { id: string; wantMu: Mu }[] = [];
  for (const id of roster) {
    const usds = balances.get(id) ?? 0n;
    if (usds < policy.floorMu) wants.push({ id, wantMu: policy.floorMu - usds });
  }
  if (!wants.length) {
    return { ...base, ok: true, reason: "all-above-floor", cycle, planId, drips: [], blocked: [] };
  }
  const budgetMu = treasuryMu - policy.reserveMu;
  if (budgetMu <= 0n) {
    return {
      ...base, ok: false, reason: "blocked-insufficient-treasury", cycle, planId, drips: [],
      blocked: [{
        subject: "treasury",
        reason: `מחסור-כספת (fail-honest): מזומן ${toStr(treasuryMu)} מתחת-לרזרבה-החוקית ${toStr(policy.reserveMu)} — אפס-טפטוף, אפס-יתרות-מפוברקות · נדרש-ל-${wants.length} חיילים`,
        ref: `${FUEL_BLOCKED_PREFIX}-${planId}`,
      }],
    };
  }
  let capLeft = budgetMu < policy.cycleCapMu ? budgetMu : policy.cycleCapMu;
  // המגבלה-הכובלת-של-המחזור — נקראת-בשמה בקבלות-החסימה (כנות-מלאה):
  const bindingReason = budgetMu < policy.cycleCapMu ? "treasury-reserve-guard" : "cycle-cap-exhausted";
  const drips: FuelDrip[] = [];
  const blocked: FuelBlocked[] = [];
  let total = 0n;
  for (const w of wants) {
    if (capLeft <= 0n) { blocked.push({ subject: w.id, reason: bindingReason }); continue; }
    const byReserve = capLeft; // הרזרבה-כבר-נגרעה-מהתקציב
    const drip = minMu(minMu(w.wantMu, policy.maxDripMu), byReserve);
    if (drip <= 0n) { blocked.push({ subject: w.id, reason: "treasury-reserve-guard" }); continue; }
    drips.push({ to: w.id, amountMu: drip, ref: `${FUEL_REF_PREFIX}-${planId}-${w.id}`, reason: `תדלוק-צי-גריד (G77-b): מנה-עד-רצפה · מחזור ${cycle} · planId ${planId}` });
    total += drip; capLeft -= drip;
  }
  // מי-שנשאר-עם-חוסר-שלא-מומש (cap/רזרבה-אזלו) — חסימה-כנה-מנומקת
  const dripped = new Set(drips.map((d) => d.to));
  for (const w of wants) {
    if (dripped.has(w.id)) continue;
    if (!blocked.some((b) => b.subject === w.id)) blocked.push({ subject: w.id, reason: bindingReason });
  }
  return {
    ok: true, reason: "dripped", cycle, planId, nowMs,
    drips, blocked,
    treasuryBeforeMu: treasuryMu,
    treasuryAfterMu: treasuryMu - total,
    totalMu: total,
  };
}

const minMu = (a: Mu, b: Mu): Mu => (a < b ? a : b);
const toStr = (m: Mu): string => (m < 0n ? `-${(-m).toString()}` : m.toString());
