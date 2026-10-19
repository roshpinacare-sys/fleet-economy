/* ═══ mu.ts — כסף-שלם (BigInt µ¢) · החוק-החשבונאי של הכלכלה-הפנימית ═══
 * =====================================================================
 * גל-86 · blueprint A2 (agent-2 · 2026-10-17): אפס-פלואט בחשבון-כסף.
 *
 * µ¢ = מיקרו-יחידה = 1e-6 של יחידת-מטבע (USDS או SAOS כאחד — שניהם
 * נסחרים בספר בדיוק 6-ספרות). כל-סכום-כסף בזיכרון = BigInt שלם של µ¢.
 * לעולם אין חילוק-פלואט, אין דיוק-כפול, אין דרישה-מצטברת.
 *
 * חוקי-עיגול (מפורשים, לא-מקריים):
 *  · חלוקה = רצפה (floor) לטובת-הבריכה/הכספת — נגד-חילוץ-אבק (dust-extraction).
 *  · עמלה = כמות-הקלט פחות הקלט-שנכנס-לבריכה → שימור-מדויק בבנייה
 *    (fee = amountIn − inAfterFee; לעולם לא מחושבת בנפרד).
 *  · סידור: מה-µ¢ חוזרים למחרוזת-עשרונית מדויקת; `toFixed` מותר
 *    לתצוגה-בלבד ולעולם לא לחישוב.
 *
 * גשר-היסטורי: הספר החי (82K+ רשומות) כתוב במספרים 6-ספרתיים.
 * fromF(x) = Math.round(x*1e6) משחזר בדיוק את כוונת-6-הספרות לכל
 * ערך-שנוצר מ-round6/toFixed(6) (טכניקת-העיגול-הכפול; טווח-הביטחון
 * |x| < 9e9 — היתרות שלנו באלפים). toF(m) = Number(m)/1e6 — הקרוב-ביותר
 * לערך-העשרוני, JSON.stringify מחזיר את אותן הבייטים. הספר אינו-משתנה:
 * אפס-שכתוב-היסטוריה, רציפות-hash נשמרת.
 */

export type Mu = bigint; // µ¢ (1e-6)

export const MU_SCALE = 1_000_000n;

/** מספר-פלואט 6-ספרתי (מהספר/הסנאפשוט) → µ¢ מדויק. רק ערכים סופיים. */
export function fromF(x: number): Mu {
  if (!Number.isFinite(x)) throw new Error(`mu.fromF: non-finite ${x}`);
  return BigInt(Math.round(x * 1e6));
}

/** µ¢ → מספר (הקרוב-ביותר לערך-העשרוני המדויק; לסידור/תצוגה בלבד). */
export function toF(m: Mu): number {
  return Number(m) / 1e6;
}

/** מחרוזת-עשרונית מדויקת (לא-דרך-פלואט) — לתצוגה/לוג בלבד. */
export function muToStr(m: Mu): string {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const whole = a / MU_SCALE;
  const frac = a % MU_SCALE;
  const frac6 = frac.toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac6}`;
}

export function muAdd(a: Mu, b: Mu): Mu { return a + b; }
export function muSub(a: Mu, b: Mu): Mu { return a - b; }

/** a × (bps/10000) מדויק — רצפה לטובת-המקבל-המוסדי. */
export function muMulBps(a: Mu, bps: number): Mu {
  return (a * BigInt(bps)) / 10_000n;
}

/** מחלקת-רצפה לשלמים-לא-שליליים (חלוקת-BigInt כבר רצפה). */
export function muMulDiv(a: Mu, b: Mu, den: Mu): Mu {
  if (den <= 0n) throw new Error("mu.mulDiv: den<=0");
  return (a * b) / den;
}

/** פיצול-קלט: מה-נכנס-לבריכה אחרי-עמלת-bps · מה-העמלה. שימור-מדויק:
 *  inAfterFee + fee === amountIn, תמיד. */
export function splitFee(amountIn: Mu, bps: number): { inAfterFee: Mu; fee: Mu } {
  const inAfterFee = muMulBps(amountIn, 10_000 - bps);
  return { inAfterFee, fee: amountIn - inAfterFee };
}

/** תוצר-AMM מדויק (קבוע-מכפלה) ב-µ¢:
 *  q = ceil((inR·outR)/(inR + inAfterFee)) · out = outR − q.
 *  למה-ceil: floor היה מעניק לסוחר עד-1µ¢ יותר-מהמדויק (הבריכה מפסידה).
 *  ceil מבטיח (inR+inAfterFee)(outR−out) ≥ inR·outR — הבריכה לעולם לא
 *  מפסידה מעיגול (העמקת-נזילות בלבד). חוזה: 0 ≤ out ≤ outR. */
export function ammOut(inR: Mu, outR: Mu, amountIn: Mu, feeBps: number): Mu {
  if (inR <= 0n || outR <= 0n || amountIn <= 0n) return 0n;
  const { inAfterFee } = splitFee(amountIn, feeBps);
  if (inAfterFee <= 0n) return 0n;
  const N = inR * outR;
  const D = inR + inAfterFee;
  const q = (N + D - 1n) / D; // ceil-חלוקה לשלמים-חיוביים
  const out = outR - q;
  if (out < 0n) return 0n;
  if (out > outR) return outR;
  return out;
}

/** G28 · גל-109 · פיצול-ניתוב-נזילות (חוק-ניתוב-הנזילות):
 *  totalMu → { poolMu, treMu } כאשר poolMu = ⌊totalMu × pct / 100⌋.
 *  שימור-מדויק-מוחלט: poolMu + treMu === totalMu (האבק-נשאר-בכספת).
 *  fail-closed: pct שאינו-מספר-בטווח [0,100] = 0 (הכל-לכספת — אף-הפתעה-לא). */
export function splitRouting(totalMu: Mu, pct: number): { poolMu: Mu; treMu: Mu } {
  const p = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.floor(pct) : 0;
  const poolMu = p > 0 ? (totalMu * BigInt(p)) / 100n : 0n;
  return { poolMu, treMu: totalMu - poolMu };
}
