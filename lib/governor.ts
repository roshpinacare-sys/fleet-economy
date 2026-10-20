/* ═══ G36 · גל-115 (agent-2) · מושל-המדיניות-הריבוני ═══
 * ==============================================================================
 * המנדט (הבעלים, גל-115): "אני רוצה שהארכיטקטורה תתפקד כבעלים ממש — מחליטה
 * על הכל ולא מחכה לתשובות שלי. שאסמוך עליה שתבחר נכון עבורי מתוך ראייה,
 * אינטליגנציה חכמה ובדוקה, ותקבל החלטות בעלות ערך רב אחרי חשיבה ובדיקה
 * ותכנון. שהכל יפעל וינוהל גם כשאני לא קיים — אבל שאני לא אשכח."
 *
 * הממצא-המדוד שהצית את החוק (מדידה-כנה מהספר-החי, גל-115):
 *   הכנסה-USDS-אמת 38.90$/שעה · שכר 250$/שעה · שריפה-נטו 211$/שעה
 *   → runway ≈ 10 ימים. טענת-G35 "סבב-סגור-אפס-שריפה" הייתה השקר-המבני-השמיני
 *   (המס-בפועל גובה 15% ממה-שנטען). עד-היום כל-תיקון-מדיניות היה ידני
 *   (רצפת 3→100→250$ ביד · מס 2→2.5% ביד · הצבת-הון ביד) — הריבון לא חוקק.
 *
 * החוק: המנוע עצמו הוא המחוקק. כל-החלטה:
 *   (1) נמדדת מהספר-החי בלבד (חלונות-שעה · אפס-סיפורים)
 *   (2) נכתבת כשורת-חוק בספר (kind:"policy") — החוק-החדש חלק-מהספר,
 *       נשחזר-דטרמיניסטית בכל-boot (סימטריית-apply/replay מלאה)
 *   (3) מתועדת כרשומת-החלטה (kind:"govern"): מדידה → השערה → פעולה →
 *       תוצאה-צפויה → מועד-בדיקה
 *   (4) נבדקת (kind:"govern-outcome"): המדידה-בפועל מול הצפוי → פסק-דין
 *       אמת. 3-כישלונות-רצופים במנוף → המנוף-קפוא 6 שעות (הגבלה-עצמית
 *       מבוססת-ראיות — הריבון לומד את גבולות-כוחו)
 *   (5) מדווחת לבעלים (kind:"owner-report") כל 6 שעות: הון-נטו, Δ,
 *       סגירות, runway, החלטות — **הבעלים-לא-נשכח**: הוא הנהנה, והריבון
 *       משאיר-לו-זיכרון-כתוב-גם-כשהוא-נוכח-וגם-כשלא.
 *
 * החוקה (CONSTITUTION) — גבולות-קשיחים בקוד. המושל אינו יכול לחרוג:
 *   שינוי-גבולות דורש קומיט-קנון חדש (אדם/עמית) — כמו תיקון-חוקה.
 *   זו-הפרדת-הרשויות: המושל חוקק בתוך-החוקה; הקנון משנה-את-החוקה.
 * ============================================================================== */

/** החוקה-הריבונית — גבולות-קשיחים (ננעלו בקנון גל-115 · G36) */
export const CONSTITUTION = {
  floorMinUsds: 30, // מתחת-זה: שוק-מת (נמדד-גל-114: רצפת-30 מקיימת-סקאלת-שוק)
  floorMaxUsds: 250, // מעל-זה: שריפת-קרן בלי-הכנסה-תואמת (נמדד-גל-115)
  taxMinBps: 250, // 2.5% — המס-ההיסטורי (רצפת-גבייה)
  taxMaxBps: 500, // 5% — תקרת-הגבייה-החוקתית (מעל-זה: דיכוי-מהירות)
  feeShareMinPct: 50, // חלק-הבריכה-מעמלות-היא-מינימום-העמקת-שוק
  feeShareMaxPct: 90, // תקרת-הקציר-מהבריכה
  floorCutPct: 20, // צעד-ירידה-מקסימלי-למחזור-החלטה
  floorRaisePct: 15, // צעד-עלייה-מקסימלי (צמיחה-זהירה-בלבד)
  taxStepBps: 25, // צעד-מס ±0.25%
  feeShareStepPct: 10, // צעד-חלק-עמלות ±10%
  minWageRows: 40, // סבלנות-כנה: בלי-דגימה-מספקת — אין-החלטה (אפס-הימור-על-רעש)
  closureLow: 0.9, // מתחת: המשק-שורף-קרן → הידוק
  closureHigh: 0.95, // מעל: המשק-מממן-את-עצמו → צמיחה-מותרת
  growthIncomeFactor: 1.05, // צמיחה דורשת הכנסה-עולה-מדודה (לא-ספייק-רעש)
  cooldownMs: 30 * 60_000, // מנוף-שונה-לא-נוגעים-בו-חצי-שעה (איסור-ריסוק-מהיר)
  checkMs: 45 * 60_000, // חלון-בדיקת-התוצאה
  freezeAfterFails: 3, // 3-כישלונות-רצופים
  freezeMs: 6 * 3_600_000, // הקפאה-של-6-שעות
  reportEveryMs: 6 * 3_600_000, // דו"ח-בעלים-כל-6-שעות
} as const;

export type GovLever = "pace" | "tax" | "fees";
export type GovPolicy = { wageHourFloorUsds: number; taxBps: number; feeToTreasuryPct: number };

/** מדידה-חיה מהספר (המנוע מזין-מהחלונות — אפס-סיפורים) */
export interface GovMeasure {
  incomeUsds1h: number;
  wageUsds1h: number;
  wageRows1h: number;
  ts: number;
}

export interface GovDecision {
  lever: GovLever;
  field: "wageHourFloorUsds" | "taxBps" | "feeToTreasuryPct";
  from: number;
  to: number;
  closure: number;
  hypothesis: string;
  expect: { metric: "closure"; direction: "up" };
}

export interface GovCooldowns {
  lastChangeAt: Record<GovLever, number>; // 0 = מעולם-לא
  freezes: Record<GovLever, number>; // untilTs · 0 = חופשי
  failStreak: Record<GovLever, number>;
}

export const emptyCooldowns = (): GovCooldowns => ({
  lastChangeAt: { pace: 0, tax: 0, fees: 0 },
  freezes: { pace: 0, tax: 0, fees: 0 },
  failStreak: { pace: 0, tax: 0, fees: 0 },
});

/** סגירות-המשק: כמה-הכנסה-חוזרת-מכל-דולר-שכר (1.0 = לולאה-סגורה-מלאה) */
export function closureOf(m: GovMeasure): number {
  if (m.wageUsds1h <= 0) return m.incomeUsds1h > 0 ? Infinity : 0;
  return m.incomeUsds1h / m.wageUsds1h;
}

const leverFree = (c: GovCooldowns, lever: GovLever, now: number): boolean =>
  (c.freezes[lever] ?? 0) <= now;

const leverCool = (c: GovCooldowns, lever: GovLever, now: number): boolean =>
  now - (c.lastChangeAt[lever] ?? 0) < CONSTITUTION.cooldownMs;

/** ההכרעה-הטהורה: מדידה + חוקה + מצב-מנופים → החלטה-אחת | null (סבלנות-כנה) */
export function governorDecide(
  m: GovMeasure,
  p: GovPolicy,
  c: GovCooldowns,
  now: number,
): GovDecision | null {
  // סבלנות: אין-דגימה-מספקת → אף-החלטה (הכנות-קודמת לתזוזה)
  if (m.wageRows1h < CONSTITUTION.minWageRows) return null;
  const closure = closureOf(m);
  if (!Number.isFinite(closure) || closure <= 0) {
    // אפס-הכנסה-מול-שכר-חי = משק-שורף — מתנהג-כמו-סגירות-נמוכה
  }

  // ── מסלול-ההידוק: סגירות-נמוכה = שריפת-קרן ──
  if (Number.isFinite(closure) && closure < CONSTITUTION.closureLow) {
    // מנוף-1 · קצב: הורדת-רצפת-השכר (הפחתת-השריפה-במקור)
    if (p.wageHourFloorUsds > CONSTITUTION.floorMinUsds && leverFree(c, "pace", now) && !leverCool(c, "pace", now)) {
      let to = p.wageHourFloorUsds * (1 - CONSTITUTION.floorCutPct / 100);
      to = Math.max(CONSTITUTION.floorMinUsds, Math.round(to * 10) / 10);
      if (to < p.wageHourFloorUsds) {
        return {
          lever: "pace", field: "wageHourFloorUsds", from: p.wageHourFloorUsds, to, closure,
          hypothesis: `סגירות ${closure.toFixed(3)} < 0.9 (הכנסה ${m.incomeUsds1h.toFixed(2)}$ מול שכר ${m.wageUsds1h.toFixed(2)}$/שעה) — הרצפת-הקודשת-קרן-כספת-בקצב-בלתי-נתמך. הורדת-הרצפת ${p.wageHourFloorUsds}→${to}$ מאטה-שריפה-ושומרת-התנעה (הגנת-לולאת-המוות: רצפת-מוחלטת ${CONSTITUTION.floorMinUsds}$)`,
          expect: { metric: "closure", direction: "up" },
        };
      }
    }
    // מנוף-2 · מס: קציר-יעיל-יותר-מהמחזור-הקיים (בלי-לגעת-בשכר)
    if (p.taxBps < CONSTITUTION.taxMaxBps && leverFree(c, "tax", now) && !leverCool(c, "tax", now)) {
      const to = Math.min(CONSTITUTION.taxMaxBps, p.taxBps + CONSTITUTION.taxStepBps);
      return {
        lever: "tax", field: "taxBps", from: p.taxBps, to, closure,
        hypothesis: `סגירות ${closure.toFixed(3)} < 0.9 והרצפת-ברצפתה-התחתונה (${p.wageHourFloorUsds}$) — הקציר-מהמחזור-הקיים-הוא-המנוף-היחיד-שלא-מכה-במהירות. המס ${p.taxBps / 100}%→${to / 100}% (+${CONSTITUTION.taxStepBps / 100}%)`,
        expect: { metric: "closure", direction: "up" },
      };
    }
    // מנוף-3 · עמלות: קציר-גדול-יותר-מעמלות-הבריכה-לכספת
    if (p.feeToTreasuryPct < CONSTITUTION.feeShareMaxPct && leverFree(c, "fees", now) && !leverCool(c, "fees", now)) {
      const to = Math.min(CONSTITUTION.feeShareMaxPct, p.feeToTreasuryPct + CONSTITUTION.feeShareStepPct);
      return {
        lever: "fees", field: "feeToTreasuryPct", from: p.feeToTreasuryPct, to, closure,
        hypothesis: `סגירות ${closure.toFixed(3)} < 0.9 בכל-המנופים-הראשיים — קציר-עמלות-הבריכה-לכספת ${p.feeToTreasuryPct}%→${to}% (היתר-ממשיך-מעמיק-את-השוק)`,
        expect: { metric: "closure", direction: "up" },
      };
    }
    return null; // כל-המנופים-קפואים/בקצה — הכנה-כנה: אין-החלטה-חוקתית-פנויה
  }

  // ── מסלול-הצמיחה: סגירות-גבוהה + הכנסה-עולה-מדודה → הרמת-רצפה-זהירה ──
  if (closure >= CONSTITUTION.closureHigh && p.wageHourFloorUsds < CONSTITUTION.floorMaxUsds) {
    if (!leverFree(c, "pace", now) || leverCool(c, "pace", now)) return null;
    // צמיחה-חוקתית: דורשת-הכנסה-עולה-מדודה (הצומח-בתנאי-צמיחה-אמת, לא-רעש)
    const growthOk = (c as GovCooldowns & { lastIncomeUsds?: number }).lastIncomeUsds === undefined
      ? true // אין-בסיס-השוואה-טרי — ההכרעה-נשענת-על-סגירות-בלבד
      : m.incomeUsds1h >= (c as GovCooldowns & { lastIncomeUsds?: number }).lastIncomeUsds! * CONSTITUTION.growthIncomeFactor;
    if (!growthOk) return null;
    let to = p.wageHourFloorUsds * (1 + CONSTITUTION.floorRaisePct / 100);
    to = Math.min(CONSTITUTION.floorMaxUsds, Math.round(to * 10) / 10);
    if (to > p.wageHourFloorUsds) {
      return {
        lever: "pace", field: "wageHourFloorUsds", from: p.wageHourFloorUsds, to, closure,
        hypothesis: `סגירות ${closure.toFixed(3)} ≥ 0.95 — המשק-מממן-את-עצמו-ועודף-יכולת-פרנסה. הרמת-רצפה ${p.wageHourFloorUsds}→${to}$ מזרימה-הון-עובד-למהירות (כל-דולר-שכר=מחזור ×~6-מדוד) בתוך-החוקה`,
        expect: { metric: "closure", direction: "up" },
      };
    }
  }
  return null;
}

/** פסק-דין-תוצאה: האם-הסגירות-השתפרה-כנגד-ההשערה */
export function governorOutcome(closureAtDecision: number, closureNow: number): { verdict: "verified" | "failed"; delta: number } {
  const delta = closureNow - closureAtDecision;
  return { verdict: delta > 0 ? "verified" : "failed", delta: +delta.toFixed(6) };
}
