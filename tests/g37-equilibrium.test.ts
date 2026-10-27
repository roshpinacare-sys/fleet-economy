/* ═══ g37-equilibrium.test.ts — חוק-שווי-המשקל-המבני (גל-116 · agent-2) ═══
 * ==============================================================================
 * מה-הטסט מוכיח (מקור-אמת-יחיד: lib/governor.ts):
 *  1. פירוק-מבני: סגירות = מס(t)×מהירות(k) — הפער-מקורו-מדוד, לא-מנוחש.
 *  2. k* מבני: סגירות-יעד 0.9 במס 2.5% דורשת מהירות k*=36 — הפער-האמת-הוא-מהירות.
 *  3. חתירה-מתוחשבת: קצב-בר-קיימא (הכנסה÷0.9) — המושל-עוצר-בדיוק-בשווי-המשקל-כשהוא
 *     קרוב-מהצעד-החוקתי, ואינו-יורד-מתחת-לשווי-המשקל-סתם (אפס-בזבוז-יכולת-פרנסה).
 *  4. חוקה-אינה-נשברת: הצעד-לעולם-לא-חורג-מהמקסימום-החוקתי; גבולות-החוקה-קשיחים.
 *  5. כנות-מלאה: בלי-מדידת-שירותים — velocity=null וההתנהגות-ההיסטורית-נשמרת (אפס-NaN).
 * ==============================================================================
 */
import { describe, test, expect } from "bun:test";
import {
  CONSTITUTION, governorDecide, emptyCooldowns, closureOf, velocityOf,
  closureDecompose, sustainablePaceOf, type GovMeasure, type GovPolicy,
} from "../lib/governor";

const measure = (income: number, wage: number, service?: number, rows = 200): GovMeasure => ({
  incomeUsds1h: income, wageUsds1h: wage, wageRows1h: rows,
  ...(service !== undefined ? { serviceUsds1h: service } : {}), ts: 1_000_000,
});
const law = (floor = 250, tax = 250, fees = 50): GovPolicy => ({
  wageHourFloorUsds: floor, taxBps: tax, feeToTreasuryPct: fees,
});
const NOW = 1_700_000_000_000;

describe("G37 · חוק-שווי-המשקל-המבני — החלטות-מתוחשבות, לא-צעדים-עיוורים", () => {
  test("פירוק-מבני: סגירות = מס×מהירות (נמדד, לא מנוחש)", () => {
    // שכר 250$/ש' · שירותים 1500$/ש' → k=6 · מס 2.5% → סגירות צפויה 0.15
    const m = measure(37.5, 250, 1500);
    const dec = closureDecompose(m, law(250, 250, 50));
    expect(dec.velocity).toBe(6);
    expect(dec.closure).toBeCloseTo(0.15, 6);
    expect(dec.taxPct).toBeCloseTo(0.025, 6);
    // k* המבני: 0.9 ÷ 0.025 = 36 — הפער-הוא-מהירות
    expect(dec.kStar).toBeCloseTo(36, 6);
  });

  test("מהירות: אפס-שכר או אין-מדידה → null (כנות, אפס-NaN)", () => {
    expect(velocityOf(measure(10, 0, 100))).toBeNull();
    expect(velocityOf(measure(10, 250))).toBeNull();
    expect(velocityOf(measure(10, 250, 0))).toBe(0);
  });

  test("קצב-בר-קיימא: הכנסה÷0.9 מהודק-לחוקה", () => {
    expect(sustainablePaceOf(measure(45, 250))).toBeCloseTo(50, 6);   // 45/0.9
    expect(sustainablePaceOf(measure(9, 250))).toBe(CONSTITUTION.floorMinUsds);  // 10→רצפת-30
    expect(sustainablePaceOf(measure(900, 250))).toBe(CONSTITUTION.floorMaxUsds); // 1000→תקרת-250
  });

  test("חתירה-מתוחשבת: היעד-קרוב-מהצעד → עוצר-בדיוק-בשווי-המשקל (לא-מתחת)", () => {
    // שכר 250 · הכנסה 193.5 → סגירות 0.774 < 0.9 · יעד = 193.5/0.9 = 215
    // הצעד-החוקתי היה 200 — החתירה-עוצרת-ב-215: אפס-בזבוז-יכולת-פרנסה
    const d = governorDecide(measure(193.5, 250, 500), law(), emptyCooldowns(), NOW);
    expect(d).not.toBeNull();
    expect(d!.lever).toBe("pace");
    expect(d!.to).toBe(215);
    // ההשערה-מסבירה-את-המבנה (מהירות k וקצב-בר-קיימא) — חשיבה-מתועדת-בספר
    expect(d!.hypothesis).toContain("k=");
    expect(d!.hypothesis).toContain("בר-קיימא");
  });

  test("היעד-רחוק-מהצעד → הצעד-החוקתי-המלא (התנהגות-G36-נשמרת)", () => {
    // המצב-המדוד-בגל-115: הכנסה 38.9 · יעד 43.2 → רחוק-מהצעד 200 → צועד-200
    const d = governorDecide(measure(38.9, 250, 200), law(), emptyCooldowns(), NOW);
    expect(d!.to).toBe(200);
  });

  test("היעד-בין-הרצפתה-לצעד → לא-יורד-מהרצפת-המוחלטת-אף-פעם", () => {
    // הכנסה-אפס → יעד-רצפת-30 · מ-250 צועד-200 (הצעד-מגן-מפני-נחיתה-מהירה)
    const d = governorDecide(measure(0, 250, 0), law(), emptyCooldowns(), NOW);
    expect(d!.to).toBeGreaterThanOrEqual(CONSTITUTION.floorMinUsds);
    // מהרצפתה-התחתונה: אין-עוד-קציבה (לולאת-המוות-מוגנת)
    const d2 = governorDecide(measure(0, 250, 0), law(CONSTITUTION.floorMinUsds, 250, 50), emptyCooldowns(), NOW);
    expect(d2!.lever).not.toBe("pace");
  });

  test("צמיחה-חותרת-ליעד: לא-מעל-שווי-המשקל-שההכנסה-תומכת", () => {
    const c = emptyCooldowns();
    c.lastIncomeUsds = 200; // הכנסה-עולה: 220 ≥ 200×1.05
    // רצפת 100 · שכר 100 · הכנסה 220 → סגירות 2.2 ≥ 0.95 · יעד = 220/0.9 = 244.4
    // הצעד-החוקתי = 115 → היעד-רחוק-מעל → צועד-115 (התנהגות-G36)
    const d = governorDecide(measure(220, 100, 600), law(100, 250, 50), c, NOW);
    expect(d!.to).toBe(115);
    // וכשהיעד-קרוב-מהצעד: רצפת 200 · הכנסה 207 → יעד 230 · הצעד 230 = 200×1.15 → עוצר-ביעד
    const c2 = emptyCooldowns();
    c2.lastIncomeUsds = 190;
    const d2 = governorDecide(measure(207, 200, 700), law(200, 250, 50), c2, NOW);
    expect(d2!.to).toBe(230); // min(230, 230) — היעד-בדיוק
    // יעד-קרוב-יותר-מהצעד: רצפת 220 · הכנסה 212 → סגירות 0.964 ≥ 0.95 · יעד 235.6 · צעד 253 → עוצר-ב-235.6
    const d3 = governorDecide(measure(212, 220, 700), law(220, 250, 50), c2, NOW);
    expect(d3!.to).toBe(235.6);
  });

  test("סימולציית-120-מחזורי-הכרעה-עם-מהירות: חוקה-קשיחה-בכל-מסלול", () => {
    let p = law();
    const c = emptyCooldowns();
    let now = NOW;
    for (let i = 0; i < 120; i++) {
      const income = [20, 38.9, 300, 120, 0][i % 5];
      const wage = 250 - (i % 3) * 10;
      const m = measure(income, wage, wage * (4 + (i % 5)));
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

  test("סגירות-בסיסית-לא-נשברת (רגרסיה-קנונית)", () => {
    expect(closureOf({ incomeUsds1h: 100, wageUsds1h: 0, wageRows1h: 100, ts: 0 })).toBe(Infinity);
    expect(closureOf({ incomeUsds1h: 0, wageUsds1h: 0, wageRows1h: 100, ts: 0 })).toBe(0);
    expect(closureOf({ incomeUsds1h: 24, wageUsds1h: 128, wageRows1h: 100, ts: 0 })).toBeCloseTo(0.1875, 4);
  });
});
