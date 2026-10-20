/* ═══ g36-governor.test.ts — מושל-המדיניות-הריבוני (גל-115 · agent-2) ═══
 * ==============================================================================
 * המנדט: הארכיטקטורה-מחליטה-הכל-בעצמה מתוך חשיבה-בדוקה — אפס-החלטות-ידניות.
 * מה-הטסט מוכיח (מקור-אמת-יחיד: governorDecide ב-lib/governor.ts):
 *  1. סבלנות-כנה: דגימה-דלה (< minWageRows) → אף-החלטה (אפס-הימור-על-רעש).
 *  2. הידוק-מדורג: סגירות-נמוכה → קציבת-רצפה-ראשון, מס-שני, עמלות-שלישי.
 *  3. חוקה: הרצפה-לעולם-לא-מתחת-לרצפת-המוחלטת; המס-לעולם-לא-מעל-התקרה; העמלות-כנ"ל.
 *  4. קור-רוח: מנוף-ששונה-לא-נוגעים-בו-חצי-שעה (איסור-ריסוק-מהיר).
 *  5. הקפאה-עצמית: 3-כישלונות-רצופים → המנוף-קפוא-6ש' (הריבון-לומד-את-גבולותיו).
 *  6. צמיחה-אחראית: סגירות-גבוהה → הרמת-רצפה-מדורגת; בלי-הכנסה-עולה-מדודה — אין-צמיחה.
 *  7. פסקי-דין: השתפרה=מאומתת · לא-השתפרה=נכשלה (כנות-מכוונת).
 * ==============================================================================
 */
import { describe, test, expect } from "bun:test";
import {
  CONSTITUTION, governorDecide, governorOutcome, emptyCooldowns, closureOf,
  type GovMeasure, type GovPolicy,
} from "../lib/governor";

const measure = (income: number, wage: number, rows = 200): GovMeasure => ({
  incomeUsds1h: income, wageUsds1h: wage, wageRows1h: rows, ts: 1_000_000,
});
const law = (floor = 250, tax = 250, fees = 50): GovPolicy => ({
  wageHourFloorUsds: floor, taxBps: tax, feeToTreasuryPct: fees,
});
const NOW = 1_700_000_000_000;

describe("G36 · מושל-המדיניות-הריבוני — חוקה-והכרעות", () => {
  test("סבלנות-כנה: דגימה-דלה → אף-החלטה (אפס-הימור-על-רעש)", () => {
    const m = measure(38.9, 250, CONSTITUTION.minWageRows - 1);
    expect(governorDecide(m, law(), emptyCooldowns(), NOW)).toBeNull();
  });

  test("הידוק-מדורג: סגירות-נמוכה → קציבת-רצפה-ראשונה (250→200)", () => {
    // המצב-המדוד-בגל-115: הכנסה 38.9$ מול שכר 250$ = סגירות 0.156
    const d = governorDecide(measure(38.9, 250), law(), emptyCooldowns(), NOW);
    expect(d).not.toBeNull();
    expect(d!.lever).toBe("pace");
    expect(d!.from).toBe(250);
    expect(d!.to).toBe(200); // −20% מדויק
    expect(d!.expect.direction).toBe("up");
  });

  test("מנוף-המס-נדלק-רק-אחרי-שהרצפה-ברצפתה-התחתונה", () => {
    const d = governorDecide(measure(20, 250), law(30, 250, 50), emptyCooldowns(), NOW);
    expect(d!.lever).toBe("tax");
    expect(d!.to).toBe(275); // +25bps
    // ואם-גם-המס-בתקרה → מנוף-העמלות
    const d2 = governorDecide(measure(20, 250), law(30, 500, 50), emptyCooldowns(), NOW);
    expect(d2!.lever).toBe("fees");
    expect(d2!.to).toBe(60);
  });

  test("חוקה: הרצפה-לעולם-לא-מתחת-לרצפת-המוחלטת · המס-לעולם-לא-מעל-התקרה", () => {
    const d = governorDecide(measure(5, 250), law(32, 250, 50), emptyCooldowns(), NOW);
    expect(d!.lever).toBe("pace");
    expect(d!.to).toBeGreaterThanOrEqual(CONSTITUTION.floorMinUsds);
    // ברצפתה-התחתונה-המוחלטת: אין-עוד-קציבת-רצפה
    expect(governorDecide(measure(5, 250), law(30, 250, 50), emptyCooldowns(), NOW)!.lever).toBe("tax");
    // מס-בתקרה: לא-חורג
    const d2 = governorDecide(measure(5, 250), law(30, 490, 50), emptyCooldowns(), NOW);
    expect(d2!.to).toBe(CONSTITUTION.taxMaxBps);
  });

  test("קור-רוח: מנוף-ששונה-לא-נוגעים-בו-חצי-שעה (cooldown)", () => {
    const c = emptyCooldowns();
    c.lastChangeAt.pace = NOW - CONSTITUTION.cooldownMs + 60_000; // עדיין-בקור-רוח
    expect(governorDecide(measure(38.9, 250), law(), c, NOW)).toBeNull();
    // אחרי-שהקור-רוח-עבר: חוזר-להכריע
    c.lastChangeAt.pace = NOW - CONSTITUTION.cooldownMs - 1;
    expect(governorDecide(measure(38.9, 250), law(), c, NOW)).not.toBeNull();
  });

  test("הקפאה-עצמית: מנוף-קפוא → המושל-עובר-למנוף-הבא (למד-את-גבולות-כוחו)", () => {
    const c = emptyCooldowns();
    c.freezes.pace = NOW + CONSTITUTION.freezeMs; // מנוף-הקצב-קפוא
    const d = governorDecide(measure(38.9, 250), law(), c, NOW);
    expect(d!.lever).toBe("tax");
  });

  test("צמיחה-אחראית: סגירות ≥ 0.95 + הכנסה-עולה-מדודה → הרמת-רצפה-מדורגת", () => {
    const c = emptyCooldowns();
    c.lastIncomeUsds = 200; // ההכנסה-הקודמת-שנמדדה
    const d = governorDecide(measure(240, 250), law(100, 250, 50), c, NOW);
    expect(d).not.toBeNull();
    expect(d!.lever).toBe("pace");
    expect(d!.to).toBe(115); // +15% מדויק
    // הכנסה-שאינה-עולה (רעש/דעיכה) → אין-צמיחה
    const c2 = emptyCooldowns();
    c2.lastIncomeUsds = 240;
    expect(governorDecide(measure(240, 250), law(100, 250, 50), c2, NOW)).toBeNull();
    // תקרת-החוקה: מ-250-לא-צומחים
    expect(governorDecide(measure(240, 250), law(250, 250, 50), emptyCooldowns(), NOW)).toBeNull();
  });

  test("פסקי-דין: השתפרה=מאומתת · לא-השתפרה=נכשלת (כנות-מכוונת)", () => {
    expect(governorOutcome(0.156, 0.31).verdict).toBe("verified");
    expect(governorOutcome(0.156, 0.31).delta).toBeGreaterThan(0);
    expect(governorOutcome(0.156, 0.14).verdict).toBe("failed");
    expect(governorOutcome(0.156, 0.156).verdict).toBe("failed"); // אפס-שיפור = כישלון-כנה
  });

  test("סגירות-אפס-שכר: אין-חלוקה-באפס (fail-safe-מתמטי)", () => {
    expect(closureOf({ incomeUsds1h: 100, wageUsds1h: 0, wageRows1h: 100, ts: 0 })).toBe(Infinity);
    expect(closureOf({ incomeUsds1h: 0, wageUsds1h: 0, wageRows1h: 100, ts: 0 })).toBe(0);
  });

  test("סימולציית-100-מחזורי-החלטה: כל-ערך-חוק-בתוך-החוקה-ללא-חריגה", () => {
    let p = law();
    const c = emptyCooldowns();
    let now = NOW;
    for (let i = 0; i < 100; i++) {
      // מצב-מתחלף: לפעמים-שריפה לפעמים-איזון (המשק-נושם)
      const income = i % 3 === 0 ? 20 : i % 3 === 1 ? 38.9 : 300;
      const m = measure(income, 250);
      const d = governorDecide(m, p, c, now);
      if (d) {
        (p as any)[d.field] = d.to;
        c.lastChangeAt[d.lever] = now;
        c.lastIncomeUsds = income;
        now += CONSTITUTION.cooldownMs + 1;
      } else {
        now += CONSTITUTION.cooldownMs + 1;
      }
      expect(p.wageHourFloorUsds).toBeGreaterThanOrEqual(CONSTITUTION.floorMinUsds);
      expect(p.wageHourFloorUsds).toBeLessThanOrEqual(CONSTITUTION.floorMaxUsds);
      expect(p.taxBps).toBeGreaterThanOrEqual(CONSTITUTION.taxMinBps);
      expect(p.taxBps).toBeLessThanOrEqual(CONSTITUTION.taxMaxBps);
      expect(p.feeToTreasuryPct).toBeGreaterThanOrEqual(CONSTITUTION.feeShareMinPct);
      expect(p.feeToTreasuryPct).toBeLessThanOrEqual(CONSTITUTION.feeShareMaxPct);
    }
  });
});
