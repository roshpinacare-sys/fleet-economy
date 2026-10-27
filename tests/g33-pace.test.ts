/* ═══ g33-pace.test.ts — חוק-קצב-ההוצאה (גל-112 · agent-2) ═══
 * ============================================================
 * הממצא-המדוד שסגר-את-החוק: שכר 3,341$ מול הכנסה 341$ (10:1) והאיגרת (3,000$)
 * נשרפה-תוך-שעה — כל-תקציב-שנצבר התאדה-מיד-בשכר-אקראי ללא-קשר-לקצב-ההכנסה.
 * מה-הטסט הזה מוכיח (מקור-אמת-יחיד: wagePaceCapMu ב-lib/mu.ts):
 *  1. fail-closed: תקציב ≤ 0 → מכסה 0 (אין-תדלוק-מהאוויר).
 *  2. runway: המכסה-השעתית ≤ ⌊תקציב÷runway⌋ — התקציב-מחזיק-מעמד-לפחות-runway-שעות.
 *  3. הכנסה: המכסה-לא-עולה-על pct מההכנסה-השעתית-האמת (עם-רצפת-חיים-מינימלית).
 *  4. clamp: pct-שגוי (שלילי/עודף/NaN) מתכווץ-בבטחה; runway-שגוי ≥ 1.
 *  5. אי-שלילה: סימולציית 100K-תשלומי-שכר-בחיתוך-מדויק-למכסה (בדיוק-כמו-spawnTx/refill/מצע)
 *     — התקציב-לעולם-לא-נהיה-שלילי (הבאג-המדוד: Math.max(0.01,…)-כפה-שכר-מעל-תקציב-זעיר).
 *  6. שימור-המכסה: remaining = cap − spent תמיד ∈ [0, cap].
 */
import { describe, test, expect } from "bun:test";
import { wagePaceCapMu } from "../lib/mu";

const F = (x: number) => BigInt(Math.round(x * 1e6)); // $ → µ¢

describe("G33 · חוק-קצב-ההוצאה — fail-closed ומתמטיקה-מדויקת", () => {
  test("תקציב ≤ 0 → מכסה 0 (אין-תדלוק-מהאוויר)", () => {
    expect(wagePaceCapMu(0n, F(500), 8, 80, F(1))).toBe(0n);
    expect(wagePaceCapMu(-1n, F(500), 8, 80, F(1))).toBe(0n);
    expect(wagePaceCapMu(-F(1234.5), F(500), 8, 80, F(1))).toBe(0n);
  });

  test("runway: מכסה-שעתית ≤ ⌊תקציב÷runway⌋ — התקציב-מחזיק-לפחות-runway-שעות", () => {
    for (let i = 0; i < 50_000; i++) {
      const budget = BigInt(Math.floor(Math.random() * 5e12)); // עד 5M$ ב-µ¢
      const income = BigInt(Math.floor(Math.random() * 1e12));
      const runway = 1 + Math.floor(Math.random() * 720);
      const cap = wagePaceCapMu(budget, income, runway, 80, F(1));
      expect(cap <= budget / BigInt(runway)).toBe(true);
      expect(cap).toBeGreaterThanOrEqual(0n);
    }
  });

  test("הכנסה: כשההכנסה-קובעת — cap = max(רצפת, ⌊הכנסה×pct⌋) ולא-עולה-על-runway", () => {
    // הכנסה 100$/שעה · 80% → 80$/שעה; תקציב-גדול → runway-לא-חוסם
    expect(wagePaceCapMu(F(100_000), F(100), 8, 80, F(1))).toBe(F(80));
    // רצפת-חיים: הכנסה-אפס → 1$/שעה (נצנוץ-פעילות)
    expect(wagePaceCapMu(F(100_000), 0n, 8, 80, F(1))).toBe(F(1));
    // runway-חוסם: תקציב 8$ ÷ 8ש' = 1$/שעה < רצפת-הכנסה
    expect(wagePaceCapMu(F(8), F(100), 8, 80, F(1))).toBe(F(1));
  });

  test("clamp: pct/runway שגויים מתכוצים-בבטחה (fail-closed)", () => {
    // pct-עודף → 100 · pct-שלילי → 0 (הכל-רצפת/runway)
    expect(wagePaceCapMu(F(100_000), F(100), 8, 150, F(1))).toBe(F(100));
    expect(wagePaceCapMu(F(100_000), F(100), 8, -5, F(1))).toBe(F(1));
    expect(wagePaceCapMu(F(100_000), F(100), 8, Number.NaN, F(1))).toBe(F(1));
    // runway-שגוי → ≥ 1 (לעולם-לא-חלוקה-באפס): runway=0 → ברירת-מחדל 8 → ⌊100,000÷8⌋=12,500$,
    // הכנסה-אפס → רצפת-1$ קובעת → cap = 1$ (החוק-המדויק, נמדד)
    expect(wagePaceCapMu(F(100_000), 0n, 0, 80, F(1))).toBe(F(1));
    expect(wagePaceCapMu(F(100_000), 0n, Number.NaN, 80, F(1))).toBe(F(1));
  });
});

describe("G33 · אי-שלילת-התקציב — סימולציית-100K-תשלומי-שכר-בחיתוך-מדויק", () => {
  test("התקציב-לעולם-לא-נהיה-שלילי · remaining ∈ [0, cap] · שריפה-שעתית ≤ cap", () => {
    for (let sim = 0; sim < 100; sim++) {
      // עולם-אקראי: תקציב-התחלתי (כולל-איגרת) + הכנסה-שעתית
      const runway = 1 + Math.floor(Math.random() * 24);
      const pct = Math.floor(Math.random() * 101);
      const floor = Math.random() < 0.5 ? F(1) : F(Math.random() * 5);
      const income1h = BigInt(Math.floor(Math.random() * 2e11));
      const cap = wagePaceCapMu(F(3000), income1h, runway, pct, floor);
      let budgetMu = F(3000);
      let spentThisHour = 0n;
      for (let i = 0; i < 1_000; i++) {
        const remaining = cap > spentThisHour ? cap - spentThisHour : 0n;
        expect(remaining <= cap).toBe(true);
        expect(remaining).toBeGreaterThanOrEqual(0n);
        // בקשת-שכר-אקראית (2-8$ כמו-spawnTx · 30-75$ כמו-מצע · מילוי-צף עד-25$) — חיתוך-מדויק
        const want = BigInt(Math.floor(Math.random() * 7.5e7));
        const amt = want > remaining ? remaining : want; // בדיוק-החיתוך-החדש-במנוע (בלי-כיפוי-מינימלי)
        if (amt >= F(0.01)) {
          budgetMu -= amt; // התשלום-יורד-מהתקציב
          spentThisHour += amt;
        }
        expect(budgetMu >= 0n).toBe(true); // החוק-הקריטי: אפס-שלילה (הבאג-ההיסטורי-ננעל)
        if (i % 100 === 0) budgetMu += income1h / 1000n; // טפטוף-הכנסה
      }
    }
  });
});
