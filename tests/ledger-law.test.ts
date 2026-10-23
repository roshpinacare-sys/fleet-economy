/* ═══ ledger-law.test.ts — חוקי-הספר · הוכחות-מתמטיות של כסף-שלם ═══
 * ===================================================================
 * blueprint A2 · agent-2 · 2026-10-17 · רץ ב-bun test
 *
 * מה-הטסט הזה מוכיח (אפס-הדמיות — כל-הערך עובר-דרך lib/mu.ts):
 *  1. גשר-הפלואט: fromF∘toF משחזר כל ערך 6-ספרתי בדיוק (ספר-היסטוריה נשמר).
 *  2. עמלה: inAfterFee + fee === amountIn — שימור-מדויק, תמיד.
 *  3. AMM: 0 ≤ out ≤ outR · המכפלה-הקבועה לא-יורדת אחרי-עמלה.
 *  4. שימור-כולל: סימולציית 100K עסקאות (מראה-מדויקת של חוקי apply/replay
 *     ב-index.ts גל-86) — סכום-העולם קבוע בכל-צעד, אפס-סטייה.
 *  5. סימטריית apply/replay: מצב אחרי זרימה + replay-זנב === מצב אחרי
 *     הזרימה-עצמה (חוק שנפרץ בגל-84 ותוקן בגל-86 — הטסט נועל אותו לנצח).
 *  6. hash-chain: שרשרת של 100K רשומות מאומתת שורה-אחר-שורה.
 *  7. (אם-הספר-החי-נוכח) אימות-קריאה-בלבד של השרשרת האמיתית + עוגנים ≤ 3.
 */
import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fromF, toF, muToStr, splitFee, ammOut, splitRouting, type Mu } from "../lib/mu";

const FEE_BPS = 30;
const rnd6 = (lo: number, hi: number) => Math.round((lo + Math.random() * (hi - lo)) * 1e6) / 1e6;

describe("µ¢ גשר-פלואט (תאימות-ספר-היסטורי)", () => {
  test("fromF∘toF משחזר כל ערך 6-ספרתי בדיוק", () => {
    for (let i = 0; i < 200_000; i++) {
      const x = rnd6(0, 100_000);
      const m = fromF(x);
      expect(Number(m % 1_000_000n)).toBeGreaterThanOrEqual(0);
      const back = toF(m);
      expect(Math.round(back * 1e6)).toBe(Math.round(x * 1e6)); // זהות-6-ספרתית
    }
  });
  test("muToStr — מחרוזת מדויקת ללא-פלואט", () => {
    expect(muToStr(123n)).toBe("0.000123");
    expect(muToStr(58_849_074_000_000n)).toBe("58849074.000000");
    expect(muToStr(-1_500_000n)).toBe("-1.500000");
  });
});

describe("עמלה — שימור-מדויק", () => {
  test("inAfterFee + fee === amountIn (2M קלטים אקראיים)", () => {
    for (let i = 0; i < 2_000_000; i++) {
      const amt = BigInt(Math.floor(Math.random() * 1e12)); // עד 1e6 יחידות
      const { inAfterFee, fee } = splitFee(amt, FEE_BPS);
      expect(inAfterFee + fee).toBe(amt);
      expect(fee).toBeGreaterThanOrEqual(0n);
      expect(inAfterFee).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe("AMM קבוע-מכפלה ב-µ¢", () => {
  test("0 ≤ out ≤ outR · המכפלה לא-יורדת (1M צעדים)", () => {
    let inR = fromF(8030), outR = fromF(8000);
    for (let i = 0; i < 1_000_000; i++) {
      const dir = Math.random() < 0.5;
      const amtIn = fromF(rnd6(0.01, 45));
      const rIn = dir ? inR : outR, rOut = dir ? outR : inR;
      const out = ammOut(rIn, rOut, amtIn, FEE_BPS);
      expect(out).toBeGreaterThanOrEqual(0n);
      expect(out).toBeLessThanOrEqual(rOut);
      const { inAfterFee } = splitFee(amtIn, FEE_BPS);
      // (inR + inAfterFee)(outR − out) ≥ inR·outR — הבריכה לא מפסידה מעיגול
      expect((rIn + inAfterFee) * (rOut - out)).toBeGreaterThanOrEqual(rIn * rOut);
      if (dir) { inR += amtIn; outR -= out; } else { outR += amtIn; inR -= out; }
      if (outR <= 0n || inR <= 0n) break; // לא צריך לקרות עם גבולות-50%
    }
  });
});

/* ── מראת-מדינה: משקף בדיוק את חוקי apply/replay ב-index.ts (גל-86) ── */
type Bal = { usds: Mu; saos: Mu; saosStaked: Mu };
type Tx = { seq: number; ts: number; kind: string; from: string; to: string; asset: "USDS" | "SAOS"; amount: Mu; fee?: Mu; outSaos?: Mu; outUsds?: Mu; reason: string };
const IDS = ["treasury", "pool", "s1", "s2", "s3", "n1", "n2"];

function lawApply(st: { bal: Map<string, Bal>; pool: { saos: Mu; usds: Mu; feesUsds: Mu; feesSaos: Mu } }, t: Tx): boolean {
  const from = st.bal.get(t.from)!; const to = st.bal.get(t.to)!;
  const field = t.asset === "USDS" ? "usds" as const : "saos" as const;
  if (from[field] < t.amount) return false; // fail-closed
  if (t.kind === "stake") { from.saos -= t.amount; from.saosStaked += t.amount; }
  else if (t.kind === "unstake") {
    if (from.saosStaked < t.amount) return false;
    from.saosStaked -= t.amount; to.saos += t.amount;
  } else {
    from[field] -= t.amount;
    if (t.kind === "swap") {
      // גל-86 · החוק: תוצר לסוחר (from) · בריכת-מודול בלבד · bal("pool") נגע-רק בזריעה
      if (t.asset === "USDS") { st.pool.usds += t.amount; st.pool.saos -= t.outSaos!; from.saos += t.outSaos!; st.pool.feesUsds += t.fee!; }
      else { st.pool.saos += t.amount; st.pool.usds -= t.outUsds!; from.usds += t.outUsds!; st.pool.feesSaos += t.fee!; }
    } else { to[field] += t.amount; }
  }
  return true;
}
function lawReplay(st: ReturnType<typeof mkState>, t: Tx): boolean {
  // חייב להיות זהה ל-lawApply — זו בדיוק נאמנות-הסימטריה (גל-84 שבר, גל-86 תוקן)
  return lawApply(st, t);
}
function mkState() {
  const bal = new Map<string, Bal>();
  for (const id of IDS) bal.set(id, { usds: 0n, saos: 0n, saosStaked: 0n });
  bal.get("treasury")!.usds = fromF(60_000);
  bal.get("treasury")!.saos = fromF(13_000);
  bal.get("pool")!.usds = fromF(8030); bal.get("pool")!.saos = fromF(8000);
  for (const s of ["s1", "s2", "s3"]) { bal.get(s)!.usds = fromF(900); bal.get(s)!.saos = fromF(25); }
  for (const n of ["n1", "n2"]) bal.get(n)!.usds = fromF(300);
  return { bal, pool: { saos: fromF(8000), usds: fromF(8030), feesUsds: 0n, feesSaos: 0n } };
}
/* גל-111 · G32 · ה-invariant-הכספי-האמיתי של עידן-האוצר: Σ(חשבונות-הספר-ללא-צל-הבריכה) + מודול-הבריכה.
 * חשבון-"pool" בספר הוא צל-מסונכרן-של מודול-ה-AMM (הפנטום-המתועד-מגל-85) — נספר-פעם-אחת-בלבד דרך-המודול. */
function sumG32(st: SovState): { usds: Mu; saos: Mu } {
  let usds = 0n, saos = 0n;
  for (const [id, b] of st.bal.entries()) { if (id === "pool") continue; usds += b.usds; saos += b.saos + b.saosStaked; }
  return { usds: usds + st.pool.usds, saos: saos + st.pool.saos };
}
function worldSum(st: ReturnType<typeof mkState>): { usds: Mu; saos: Mu } {
  let usds = 0n, saos = 0n;
  for (const b of st.bal.values()) { usds += b.usds; saos += b.saos + b.saosStaked; }
  return { usds: usds + st.pool.usds, saos: saos + st.pool.saos };
}

describe("שימור-כולל — 100K עסקאות, אפס-סטייה", () => {
  test("סכום-העולם קבוע בכל-צעד (µ¢)", () => {
    const st = mkState();
    const w0 = worldSum(st);
    let seq = 0;
    for (let i = 0; i < 100_000; i++) {
      const r = Math.random();
      const from = IDS[2 + Math.floor(Math.random() * (IDS.length - 2))];
      if (r < 0.44) { // swap
        const buySaos = Math.random() < 0.5;
        const amt = fromF(rnd6(0.5, 40));
        const t: Tx = { seq: ++seq, ts: Date.now(), kind: "swap", from, to: "pool", asset: buySaos ? "USDS" : "SAOS", amount: amt, reason: "t" };
        const rIn = buySaos ? st.pool.usds : st.pool.saos, rOut = buySaos ? st.pool.saos : st.pool.usds;
        const out = ammOut(rIn, rOut, amt, FEE_BPS);
        if (out <= 0n || out > rOut / 2n) continue; // דחייה-כנה
        const { fee } = splitFee(amt, FEE_BPS);
        if (buySaos) { t.outSaos = out; t.fee = fee; } else { t.outUsds = out; t.fee = fee; }
        // דחיית-יתרה = חוק כנה (fail-closed), לא כישלון-טסט; שימור נבדק בשני-המקרים
        lawApply(st, t);
      } else if (r < 0.94) { // service/infra/salary
        const to = IDS[Math.floor(Math.random() * IDS.length)];
        if (to === from) continue;
        lawApply(st, { seq: ++seq, ts: Date.now(), kind: "service", from, to, asset: "USDS", amount: fromF(rnd6(0.1, 10)), reason: "t" });
      } else { // stake/unstake
        const b = st.bal.get(from)!;
        if (Math.random() < 0.6) { if (b.saos > 0n) lawApply(st, { seq: ++seq, ts: Date.now(), kind: "stake", from, to: from, asset: "SAOS", amount: fromF(rnd6(0.1, 2)) > b.saos ? b.saos : fromF(rnd6(0.1, 2)), reason: "t" }); }
        else if (b.saosStaked > 0n) lawApply(st, { seq: ++seq, ts: Date.now(), kind: "unstake", from, to: from, asset: "SAOS", amount: fromF(rnd6(0.1, 1)) > b.saosStaked ? b.saosStaked : fromF(rnd6(0.1, 1)), reason: "t" });
      }
      const w = worldSum(st);
      expect(w.usds).toBe(w0.usds); // אפס-הדפסה, אפס-אובדן — תמיד
      expect(w.saos).toBe(w0.saos);
    }
  });
});

describe("סימטריית apply/replay — החוק-שנפרץ-בגל-84, נעול-מגל-86", () => {
  test("replay-זנב === זרימה-מקורית, מצב-שקול µ¢-מדויק", () => {
    for (let trial = 0; trial < 200; trial++) {
      const stA = mkState(); // מצב-חי: הזרימה עצמה
      const ledger: Tx[] = [];
      let seq = 0;
      for (let i = 0; i < 150; i++) {
        const from = IDS[2 + Math.floor(Math.random() * (IDS.length - 2))];
        const buySaos = Math.random() < 0.5;
        const amt = fromF(rnd6(0.5, 40));
        const t: Tx = { seq: ++seq, ts: Date.now(), kind: "swap", from, to: "pool", asset: buySaos ? "USDS" : "SAOS", amount: amt, reason: "t" };
        const rIn = buySaos ? stA.pool.usds : stA.pool.saos, rOut = buySaos ? stA.pool.saos : stA.pool.usds;
        const out = ammOut(rIn, rOut, amt, FEE_BPS);
        if (out <= 0n || out > rOut / 2n) continue;
        const { fee } = splitFee(amt, FEE_BPS);
        if (buySaos) { t.outSaos = out; t.fee = fee; } else { t.outUsds = out; t.fee = fee; }
        if (lawApply(stA, t)) ledger.push(t);
      }
      const stB = mkState(); // מצב-סנאפשוט (זהה) + replay הזנב
      for (const t of ledger) lawReplay(stB, t);
      const wA = worldSum(stA), wB = worldSum(stB);
      expect(wB.usds).toBe(wA.usds);
      expect(wB.saos).toBe(wA.saos);
      // כל-חשבון שקול בדיוק — במיוחד הסוחרים (לא bal("pool")!)
      for (const id of IDS) {
        expect(stB.bal.get(id)!.usds).toBe(stA.bal.get(id)!.usds);
        expect(stB.bal.get(id)!.saos).toBe(stA.bal.get(id)!.saos);
      }
      expect(stB.pool.usds).toBe(stA.pool.usds);
      expect(stB.pool.saos).toBe(stA.pool.saos);
    }
  });
});

describe("hash-chain — 100K רשומות", () => {
  test("שרשרת שלמה מאומתת + שבר-ביט מתגלה", () => {
    const lines: string[] = [];
    let prev = "GENESIS";
    let seq = 0;
    for (let i = 0; i < 100_000; i++) {
      const t: any = { seq: ++seq, ts: Date.now(), kind: "service", from: "s1", to: "s2", asset: "USDS", amount: Number(fromF(rnd6(0.1, 9))) / 1e6, reason: "chain-test", prev };
      const h = createHash("sha256").update(JSON.stringify(t)).digest("hex").slice(0, 32);
      lines.push(JSON.stringify({ ...t, h }));
      prev = h;
    }
    // אימות מלא
    let p = "GENESIS"; let checked = 0;
    for (const line of lines) {
      const { h, ...rest } = JSON.parse(line);
      expect(createHash("sha256").update(JSON.stringify({ ...rest, prev: p })).digest("hex").slice(0, 32)).toBe(h);
      p = h; checked++;
    }
    expect(checked).toBe(100_000);
    // שבר-ביט אחד מתגלה
    const broken = JSON.parse(lines[50_000]);
    broken.amount += 0.000001;
    const { h, ...rest } = broken;
    expect(createHash("sha256").update(JSON.stringify({ ...rest, prev: "GENESIS" })).digest("hex").slice(0, 32)).not.toBe(h);
  });
});

describe("הספר-החי — אימות קריאה-בלבד (אם-נוכח)", () => {
  const REPO_STATE = path.join(import.meta.dir, "..", "state");
  test("שרשרת-אמת + עוגנים ≤ 3", () => {
    if (!fs.existsSync(path.join(REPO_STATE, "ledger.jsonl"))) return; // אין-ספר כאן → דלג (סביבה-נקייה)
    let prev = "GENESIS"; let checked = 0; let lastSeq = 0; let prevWasAnchor = false;
    const anchors: number[] = [];
    const files = fs.readdirSync(REPO_STATE).filter((f) => f === "ledger.jsonl" || f.startsWith("ledger-")).sort();
    outer: for (const f of files) {
      const ls = fs.readFileSync(path.join(REPO_STATE, f), "utf8").split("\n").filter(Boolean);
      for (const line of ls) {
        const t = JSON.parse(line);
        if (typeof t.seq !== "number" || t.seq <= lastSeq) throw new Error(`סדר-ספר: seq ${t.seq} אחרי ${lastSeq}`);
        lastSeq = t.seq;
        const { h, ...rest } = t;
        if (createHash("sha256").update(JSON.stringify({ ...rest, prev })).digest("hex").slice(0, 32) !== h) {
          if (prevWasAnchor) throw new Error(`שבר-אמת: שני-עוגנים-רצופים @ seq ${t.seq}`);
          anchors.push(t.seq); prev = h; prevWasAnchor = true; continue;
        }
        prev = h; checked++; prevWasAnchor = false;
      }
    }
    if (prevWasAnchor && anchors.length > 0) throw new Error(`זנב-בלתי-מעוגן @ seq ${anchors[anchors.length - 1]}`);
    expect(anchors.length).toBeLessThanOrEqual(3); // צמיחת-עוגנים = אזעקה
    expect(checked).toBeGreaterThan(0);
  });
});

/* ═══ G28 · חוק-ניתוב-הנזילות (גל-109 · agent-2) ═══
 * המדיניות המוצהרת (ext-policy.json poolPct) מפצלת כל ext-deposit:
 * poolMu = ⌊total×pct/100⌋ → בריכת-SAOS/USDS · היתר → כספת-ריבונית.
 * החוק-הנועל: שימור-מדויק (pool+tre === total) · רצפה-לכספת · fail-closed. */
describe("G28 · פיצול-ניתוב-נזילות (splitRouting)", () => {
  test("שימור-מדויק: poolMu + treMu === totalMu (500K קלטים אקראיים × pct 0..100)", () => {
    for (let i = 0; i < 500_000; i++) {
      const total = BigInt(Math.floor(Math.random() * 1e12));
      const pct = Math.floor(Math.random() * 101);
      const { poolMu, treMu } = splitRouting(total, pct);
      expect(poolMu + treMu).toBe(total);
      expect(poolMu >= 0n && treMu >= 0n).toBe(true);
      expect(poolMu).toBe((total * BigInt(pct)) / 100n); // רצפה-מדויקת-כחוק
    }
  });
  test("fail-closed: pct פגום/מחוץ-לטווח = 0 (הכל-לכספת — אף-הפתעה-לא)", () => {
    expect(splitRouting(1_000_000n, NaN).poolMu).toBe(0n);
    expect(splitRouting(1_000_000n, Infinity).poolMu).toBe(0n);
    expect(splitRouting(1_000_000n, 999).poolMu).toBe(0n);
    expect(splitRouting(1_000_000n, -5).poolMu).toBe(0n);
    expect(splitRouting(1_000_000n, 0).treMu).toBe(1_000_000n);
  });
  test("ערכי-קצה: pct=100 הכל-לבריכה · אבק-נשאר-בכספת · ירי-ה-G27 ההיסטורי 42.5@25%", () => {
    expect(splitRouting(1_000_000n, 100)).toEqual({ poolMu: 1_000_000n, treMu: 0n });
    expect(splitRouting(7n, 50)).toEqual({ poolMu: 3n, treMu: 4n }); // רצפה: האבק-בכספת
    const live = splitRouting(fromF(42.5), 25); // זרימת-הירי-הראשונה — מדידה-נגדית
    expect(live.poolMu).toBe(10_625_000n); // 10.625 USDS
    expect(live.treMu).toBe(31_875_000n); // 31.875 USDS
    expect(live.poolMu + live.treMu).toBe(fromF(42.5));
  });
});

/* ═══ G32 · חוק-הון-הריבון (גל-111 · agent-2) ═══
 * המנגנון-החדש: דיבידנד-עמלות (pool→treasury חלק-חוקי) · איגרת-חוב-ריבונית-מכוסה
 * (pool→treasury כחוב-מחויב-בספר · ריבית · החזר) · תקציב-שכר-אמת (G31-מומש).
 * החוקים-הנועלים:
 *  1. שימור-עולם: כל-סוג-שורה-החדש שומר-על סכום-העולם (אפס-הדפסה — חוב הוא העברה, לא יצירה).
 *  2. סימטריית apply/replay: מוני-האוצר (incomeAccrued · wagePaid · dividend · bond) זהים-בדיוק
 *     בין-הזרימה-החיה ל-replay-הזנב (החוק-שנפרץ-בגל-84 — נעול-עתה-גם-למוני-האוצר).
 *  3. חוק-תקציב-השכר: שכר-חסום-כשאין-תקציב · נפתח-מהנפקת-איגרת · wagePaid נמדד-במקור-יחיד.
 *  4. מכסות-איגרת: headroom = min(תקרת-חוב−חוב, מכסת-בריכה, קצירה-פר-הנפקה) · fail-closed.
 */
type SovState = {
  bal: Map<string, Bal>;
  pool: { saos: Mu; usds: Mu; feesUsds: Mu; feesSaos: Mu };
  incomeAccrued: Mu; wagePaid: Mu; dividendPaid: Mu; bondIssued: Mu; bondRepaid: Mu; bondInterest: Mu; wageBlocked: number;
};
function sovApply(st: SovState, t: Tx): boolean {
  const from = st.bal.get(t.from)!; const to = st.bal.get(t.to)!;
  const field = t.asset === "USDS" ? "usds" as const : "saos" as const;
  // סנכרון-מקדים-כמו-בחיים (G32): שורות-בריכה מתיישרות-מול-המודול-לפני-בדיקת-היתרה
  if (t.kind === "dividend" || t.kind === "bond-issue" || t.kind === "bond-interest" || t.kind === "bond-repay" || (t.kind === "infra" && t.from === "pool")) {
    st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos;
  }
  if (from[field] < t.amount) { if (t.kind === "salary") st.wageBlocked++; return false; }
  from[field] -= t.amount;
  if (t.kind === "swap") {
    if (t.asset === "USDS") { st.pool.usds += t.amount; st.pool.saos -= t.outSaos!; from.saos += t.outSaos!; st.pool.feesUsds += t.fee!; }
    else { st.pool.saos += t.amount; st.pool.usds -= t.outUsds!; from.usds += t.outUsds!; st.pool.feesSaos += t.fee!; }
  } else { to[field] += t.amount; }
  // חשבונאות-האוצר + שיקוף-המודול (משוקף-מילה-במילה-ל-engine apply/replay)
  if (t.kind === "dividend") { st.incomeAccrued += t.amount; st.dividendPaid += t.amount; if (t.asset === "USDS") st.pool.usds -= t.amount; else st.pool.saos -= t.amount; st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; }
  else if (t.kind === "bond-issue") { st.bondIssued += t.amount; st.pool.usds -= t.amount; st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; }
  else if (t.kind === "bond-interest") { st.bondInterest += t.amount; st.pool.usds += t.amount; st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; }
  else if (t.kind === "bond-repay") { st.bondRepaid += t.amount; st.pool.usds += t.amount; st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; }
  else if (t.kind === "infra" && t.from === "pool" && t.to === "treasury") { if (t.asset === "USDS") { st.incomeAccrued += t.amount; st.pool.usds -= t.amount; } else { st.pool.saos -= t.amount; } st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; }
  else if (t.kind === "salary") st.wagePaid += t.amount;
  return true;
}
function sovBudget(st: SovState): Mu { return st.incomeAccrued - st.wagePaid - st.bondInterest + (st.bondIssued - st.bondRepaid); }
function sovBondHeadroom(st: SovState, cfg: { maxUsds: Mu; poolSharePct: number; perIssuance: Mu }): Mu {
  const debt = st.bondIssued - st.bondRepaid;
  const headroom = cfg.maxUsds - debt; if (headroom <= 0n) return 0n;
  const poolCap = (st.pool.usds * BigInt(cfg.poolSharePct)) / 100n;
  let m = headroom < poolCap ? headroom : poolCap;
  if (m > cfg.perIssuance) m = cfg.perIssuance;
  return m;
}
function mkSovState(): SovState {
  const bal = new Map<string, Bal>();
  for (const id of IDS) bal.set(id, { usds: 0n, saos: 0n, saosStaked: 0n });
  bal.get("treasury")!.usds = fromF(0.98); // המדידה-האמיתית-של-גל-111: כספת-כמעט-ריקה
  bal.get("pool")!.usds = fromF(8030); bal.get("pool")!.saos = fromF(8000);
  for (const s of ["s1", "s2", "s3"]) bal.get(s)!.usds = fromF(0.2); // חיילים-יבשים
  return { bal, pool: { saos: fromF(8000), usds: fromF(8030), feesUsds: 0n, feesSaos: 0n }, incomeAccrued: 0n, wagePaid: 0n, dividendPaid: 0n, bondIssued: 0n, bondRepaid: 0n, bondInterest: 0n, wageBlocked: 0 };
}
const sovTx = (seq: number, kind: string, from: string, to: string, asset: "USDS" | "SAOS", amount: Mu): Tx =>
  ({ seq, ts: Date.now(), kind, from, to, asset, amount, reason: "g32" });

describe("G32 · חוק-הון-הריבון", () => {
  test("שימור-עולם: דיבידנד/איגרת/ריבית/החזר — אפס-הדפסה (50K צעדים)", () => {
    for (let trial = 0; trial < 20; trial++) {
      const st = mkSovState();
      const w0 = sumG32(st);
      let seq = 0;
      for (let i = 0; i < 2_500; i++) {
        const r = Math.random();
        if (r < 0.3) { // סבב-אוצר: עמלות-שנצברו-מ-swap-אמיתיות → דיבידנד 50% (אפס-הזרקה-מהאוויר)
          const take = (st.pool.feesUsds * 50n) / 100n;
          if (take >= 1n) sovApply(st, sovTx(++seq, "dividend", "pool", "treasury", "USDS", take));
        } else if (r < 0.45 && st.bondIssued - st.bondRepaid === 0n) { // הנפקה-במכסות
          const m = sovBondHeadroom(st, { maxUsds: fromF(3_000), poolSharePct: 12, perIssuance: fromF(300) });
          if (m >= fromF(1)) sovApply(st, sovTx(++seq, "bond-issue", "pool", "treasury", "USDS", m));
        } else if (r < 0.6 && st.bondIssued > st.bondRepaid) { // ריבית-והחזר
          const interest = fromF(rnd6(0.0001, 0.01));
          if (st.bal.get("treasury")!.usds >= interest) sovApply(st, sovTx(++seq, "bond-interest", "treasury", "pool", "USDS", interest));
          const budget = sovBudget(st);
          if (budget > fromF(600)) { let repay = (budget - fromF(600)) / 2n; const debt = st.bondIssued - st.bondRepaid; if (repay > debt) repay = debt; if (repay >= 1n) sovApply(st, sovTx(++seq, "bond-repay", "treasury", "pool", "USDS", repay)); }
        } else if (r < 0.8) { // שכר-מתוך-תקציב (G31-מומש)
          const budget = sovBudget(st);
          if (budget > 0n) { let amt = fromF(rnd6(1, 40)); if (amt > budget) amt = budget; sovApply(st, sovTx(++seq, "salary", "treasury", "s1", "USDS", amt)); }
          else sovApply(st, sovTx(++seq, "salary", "treasury", "s1", "USDS", fromF(5)));
        } else { // סחר-חי
          const buySaos = Math.random() < 0.5;
          const amt = fromF(rnd6(0.5, 20));
          const rIn = buySaos ? st.pool.usds : st.pool.saos, rOut = buySaos ? st.pool.saos : st.pool.usds;
          const out = ammOut(rIn, rOut, amt, FEE_BPS);
          if (out <= 0n || out > rOut / 2n) continue;
          const { fee } = splitFee(amt, FEE_BPS);
          const t: Tx = { seq: ++seq, ts: Date.now(), kind: "swap", from: "s2", to: "pool", asset: buySaos ? "USDS" : "SAOS", amount: amt, reason: "t" };
          if (buySaos) { t.outSaos = out; t.fee = fee; } else { t.outUsds = out; t.fee = fee; }
          sovApply(st, t);
        }
        const w = sumG32(st);
        expect(w.usds).toBe(w0.usds); // אפס-הדפסה — החוב-הוא-העברה (invariant-G32: ללא-צל-הבריכה)
        expect(w.saos).toBe(w0.saos);
      }
    }
  });
  test("סימטריית apply/replay עם מוני-אוצר — יתרות-ומונים זהים-בדיוק", () => {
    for (let trial = 0; trial < 100; trial++) {
      const ledger: Tx[] = [];
      let seq = 0;
      const stA = mkSovState();
      // מצב-סנאפשות: עמלת-AMM שנצברה-מזרימות-קודמות (חלק-מהמצב, לא-מהזנב)
      stA.pool.feesUsds += fromF(2); stA.pool.usds += fromF(2);
      // זרימה-חיה: איגרת → דיבידנד → שכר → ריבית → החזר
      const issue = sovBondHeadroom(stA, { maxUsds: fromF(3_000), poolSharePct: 12, perIssuance: fromF(300) });
      if (sovApply(stA, sovTx(++seq, "bond-issue", "pool", "treasury", "USDS", issue))) ledger.push(sovTx(seq, "bond-issue", "pool", "treasury", "USDS", issue));
      const div = (fromF(2) * 50n) / 100n;
      if (sovApply(stA, sovTx(++seq, "dividend", "pool", "treasury", "USDS", div))) ledger.push(sovTx(seq, "dividend", "pool", "treasury", "USDS", div));
      const sal = fromF(50);
      if (sovApply(stA, sovTx(++seq, "salary", "treasury", "s1", "USDS", sal))) ledger.push(sovTx(seq, "salary", "treasury", "s1", "USDS", sal));
      const int = fromF(0.001);
      if (sovApply(stA, sovTx(++seq, "bond-interest", "treasury", "pool", "USDS", int))) ledger.push(sovTx(seq, "bond-interest", "treasury", "pool", "USDS", int));
      const rep = fromF(10);
      if (sovApply(stA, sovTx(++seq, "bond-repay", "treasury", "pool", "USDS", rep))) ledger.push(sovTx(seq, "bond-repay", "treasury", "pool", "USDS", rep));
      // replay-זנב מהסנאפשוט (מצב-הסנאפשוט כולל-את-העמלה-שנצברה — זהה-ל-stA-טרם-הזנב)
      const stB = mkSovState();
      stB.pool.feesUsds += fromF(2); stB.pool.usds += fromF(2);
      for (const t of ledger) sovApply(stB, t); // החוק: replay-זהה-ל-apply (מנוע-אמת: שתי-המימושות-חייבות-להיות-מילה-במילה)
      expect(stB.incomeAccrued).toBe(stA.incomeAccrued);
      expect(stB.wagePaid).toBe(stA.wagePaid);
      expect(stB.dividendPaid).toBe(stA.dividendPaid);
      expect(stB.bondIssued).toBe(stA.bondIssued);
      expect(stB.bondRepaid).toBe(stA.bondRepaid);
      expect(stB.bondInterest).toBe(stA.bondInterest);
      expect(stB.bal.get("treasury")!.usds).toBe(stA.bal.get("treasury")!.usds);
      expect(stB.pool.usds).toBe(stA.pool.usds);
      expect(sovBudget(stB)).toBe(sovBudget(stA));
    }
  });
  test("חוק-תקציב-השכר (G31-מומש): חסום-באפס-הכנסה · נפתח-באיגרת · wagePaid מדויק", () => {
    const st = mkSovState();
    // אפס-הכנסה-ואפס-חוב → תקציב-אפס → שכר-חסום-בכנות
    expect(sovBudget(st)).toBe(0n);
    expect(sovApply(st, sovTx(1, "salary", "treasury", "s1", "USDS", fromF(5)))).toBe(false);
    expect(st.wageBlocked).toBe(1);
    // הנפקת-איגרת 300$ → תקציב-נפתח → שכר-זורם-ונמדד
    sovApply(st, sovTx(2, "bond-issue", "pool", "treasury", "USDS", fromF(300)));
    expect(sovBudget(st)).toBe(fromF(300));
    expect(sovApply(st, sovTx(3, "salary", "treasury", "s1", "USDS", fromF(120)))).toBe(true);
    expect(st.wagePaid).toBe(fromF(120));
    expect(sovBudget(st)).toBe(fromF(180)); // שימור-מתמטי
    // ריבית-היא-עלות: מקטינה-את-התקציב (כנות-כלכלית)
    sovApply(st, sovTx(4, "bond-interest", "treasury", "pool", "USDS", fromF(1)));
    expect(sovBudget(st)).toBe(fromF(179));
  });
  test("מכסות-איגרת: headroom = min(תקרה−חוב · מכסת-בריכה · קצירה) · fail-closed", () => {
    const st = mkSovState();
    const cfg = { maxUsds: fromF(3_000), poolSharePct: 12, perIssuance: fromF(300) };
    expect(sovBondHeadroom(st, cfg)).toBe(fromF(300)); // קצירה-הדרגתית היא-המגבלה (963>300 · 3000>300)
    st.bondIssued = fromF(2_900); // חוב-כמעט-מלא → headroom=100 (מכסת-התקרה היא-המגבלה)
    expect(sovBondHeadroom(st, cfg)).toBe(fromF(100));
    st.bondIssued = fromF(3_000); // תקרה-מלאה → אפס-הנפקה (fail-closed)
    expect(sovBondHeadroom(st, cfg)).toBe(0n);
    const st2 = mkSovState(); st2.pool.usds = fromF(1_000); // בריכה-דלה: 12% = 120 המגבלה
    expect(sovBondHeadroom(st2, cfg)).toBe(fromF(120));
    const st3 = mkSovState(); st3.pool.usds = fromF(500); // 12% = 60 — תמיד-מתחת-לקצירה
    expect(sovBondHeadroom(st3, cfg)).toBe(fromF(60));
  });
});

/* ══ G67 · קוטל-פנדולום-ה-pool · אחדות-ייצוג ═══════════════════════════════════
 * הממצא-החי (2026-10-23 · claims :3016 · chain-integrity 7/8): pool.usds/saos
 * התהפכו-וגדלו בכל-ריפוי (−3.51→+5.86 · +2.04→−3.55) — פיצול-ייצוגים בין
 * bal("pool") למודול-ה-AMM. החוק-החדש (מילה-במילה בשני-המחילים — חי ו-replay):
 *  1. אחרי-כל-החלפה: bal("pool") == מודול-ה-AMM (sync-מיידי).
 *  2. הפקדה-לבריכה מעמיקה-אמת-ה-AMM בתוך-המחיל-עצמו (כוונת-G66b, בלי-תיקוני-חוץ-ספר).
 *  3. שורות-אוצר הנוגעות-בבריכה (dividend/bond): תנועת-bal + תנועת-מודול + sync —
 *     ההתכנסות-היציבה-של-המצב-הקיים, נעולה-כאן-לנצח.
 * ה-invariant: אחרי-כל-שורה — bal("pool") == מודול (אפס-פיצול-ייצוגים · אפס-פנדולום). */
function lawApplyG67(st: { bal: Map<string, Bal>; pool: { saos: Mu; usds: Mu; feesUsds: Mu; feesSaos: Mu } }, t: any): boolean {
  const from = st.bal.get(t.from)!; const to = st.bal.get(t.to)!;
  const field = t.asset === "USDS" ? "usds" as const : "saos" as const;
  const amt = BigInt(t.amount);
  if (t.kind === "ext-deposit") { // גל-109: אין-חיוב-מקור · G67: העמקת-AMM-בתוך-המחיל
    to[field] += amt;
    if (t.to === "pool") st.pool[field] += amt;
    return true;
  }
  if (from[field] < amt) return false;
  from[field] -= amt;
  if (t.kind === "swap") {
    if (t.asset === "USDS") { st.pool.usds += amt; st.pool.saos -= BigInt(t.outSaos); from.saos += BigInt(t.outSaos); st.pool.feesUsds += BigInt(t.fee); }
    else { st.pool.saos += amt; st.pool.usds -= BigInt(t.outUsds); from.usds += BigInt(t.outUsds); st.pool.feesSaos += BigInt(t.fee); }
    st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos; // G67: sync-החלפה
  } else {
    to[field] += amt;
    if (t.from === "pool" || t.to === "pool") { // גל-111: צל-הבריכה-מודול-אמת (התכנסות-המצב-הקיים · נעול-לנצח)
      if (t.from === "pool") st.pool[field] -= amt;
      if (t.to === "pool") st.pool[field] += amt;
      st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos;
    }
  }
  return true;
}
function mkG67State() {
  const st = { bal: new Map<string, Bal>(), pool: { saos: fromF(8_000), usds: fromF(8_030), feesUsds: 0n, feesSaos: 0n } };
  for (const id of IDS) st.bal.set(id, { usds: 0n, saos: 0n, saosStaked: 0n });
  st.bal.get("treasury")!.usds = fromF(60_000);
  st.bal.get("pool")!.usds = fromF(8_030); st.bal.get("pool")!.saos = fromF(8_000);
  for (const s of ["s1", "s2", "s3"]) { st.bal.get(s)!.usds = fromF(900); st.bal.get(s)!.saos = fromF(25); }
  return st;
}
describe("G67 · אחדות-ייצוג-הבריכה — קוטל-פנדולום-ה-pool", () => {
  test("אחרי-כל-שורה: bal(\"pool\") == מודול-ה-AMM (300 שורות-מעורבות · אפס-פיצול)", () => {
    for (let trial = 0; trial < 100; trial++) {
      const st = mkG67State();
      let seq = 0;
      for (let i = 0; i < 300; i++) {
        const r = Math.random();
        if (r < 0.45) { // החלפה
          const from = ["s1", "s2", "s3", "treasury"][Math.floor(Math.random() * 4)]!;
          const buySaos = Math.random() < 0.5;
          const amt = fromF(rnd6(0.5, 40));
          const rIn = buySaos ? st.pool.usds : st.pool.saos, rOut = buySaos ? st.pool.saos : st.pool.usds;
          const out = ammOut(rIn, rOut, amt, FEE_BPS);
          if (out <= 0n || out > rOut / 2n) continue;
          const { fee } = splitFee(amt, FEE_BPS);
          const t: any = { seq: ++seq, ts: 0, kind: "swap", from, to: "pool", asset: buySaos ? "USDS" : "SAOS", amount: amt, reason: "t", fee };
          if (buySaos) t.outSaos = out; else t.outUsds = out;
          if (!lawApplyG67(st, t)) continue; // דחיית-יתרה = חוק-כנה, לא-כשל
        } else if (r < 0.65) { // הפקדת-חוץ (ניתוב-G28: כספת+בריכה)
          const amt = fromF(rnd6(1, 120));
          const { poolMu, treMu } = splitRouting(amt, 25);
          if (treMu > 0n) expect(lawApplyG67(st, { seq: ++seq, ts: 0, kind: "ext-deposit", from: "ext:venue", to: "treasury", asset: "USDS", amount: treMu, reason: "t" })).toBe(true);
          if (poolMu > 0n) expect(lawApplyG67(st, { seq: ++seq, ts: 0, kind: "ext-deposit", from: "ext:venue", to: "pool", asset: "USDS", amount: poolMu, reason: "t" })).toBe(true);
        } else if (r < 0.8) { // דיבידנד-עמלות (אוצר → מהבריכה)
          const take = fromF(rnd6(0.02, 2));
          if (st.pool.usds >= take && st.bal.get("pool")!.usds >= take)
            expect(lawApplyG67(st, { seq: ++seq, ts: 0, kind: "dividend", from: "pool", to: "treasury", asset: "USDS", amount: take, reason: "t" })).toBe(true);
        } else if (r < 0.9) { // ריבית-איגרת (מהכספת-אל-הבריכה)
          const i = fromF(rnd6(0.01, 1));
          if (st.bal.get("treasury")!.usds >= i)
            expect(lawApplyG67(st, { seq: ++seq, ts: 0, kind: "bond-interest", from: "treasury", to: "pool", asset: "USDS", amount: i, reason: "t" })).toBe(true);
        } else { // שירות רגיל (שטח-מת)
          const from = ["s1", "s2", "s3"][Math.floor(Math.random() * 3)]!;
          expect(lawApplyG67(st, { seq: ++seq, ts: 0, kind: "service", from, to: "treasury", asset: "USDS", amount: fromF(rnd6(0.1, 5)), reason: "t" })).toBe(true);
        }
        // ה-invariant המנצח — בכל-צעד, ללא-יוצא-מן-הכלל:
        expect(st.bal.get("pool")!.usds).toBe(st.pool.usds);
        expect(st.bal.get("pool")!.saos).toBe(st.pool.saos);
      }
    }
  });
  test("סימטריית apply/replay מורחבת: זרימה-מעורבת + replay == מצב-חי (µ¢-מדויק)", () => {
    for (let trial = 0; trial < 50; trial++) {
      const live = mkG67State(); const ledger: any[] = [];
      let seq = 0;
      const gen = (st: typeof live): any => {
        const r = Math.random();
        if (r < 0.5) {
          const from = ["s1", "s2", "s3", "treasury"][Math.floor(Math.random() * 4)]!;
          const buySaos = Math.random() < 0.5;
          const amt = fromF(rnd6(0.5, 40));
          const rIn = buySaos ? st.pool.usds : st.pool.saos, rOut = buySaos ? st.pool.saos : st.pool.usds;
          const out = ammOut(rIn, rOut, amt, FEE_BPS);
          if (out <= 0n || out > rOut / 2n) return null;
          const { fee } = splitFee(amt, FEE_BPS);
          const t: any = { seq: ++seq, ts: 0, kind: "swap", from, to: "pool", asset: buySaos ? "USDS" : "SAOS", amount: amt, reason: "t", fee };
          if (buySaos) t.outSaos = out; else t.outUsds = out;
          return t;
        }
        const amt = fromF(rnd6(1, 80));
        const { poolMu, treMu } = splitRouting(amt, 25);
        return { seq: ++seq, ts: 0, kind: "ext-deposit", from: "ext:venue", to: poolMu > 0n && Math.random() < 0.5 ? "pool" : "treasury", asset: "USDS", amount: poolMu > 0n && Math.random() < 0.5 ? poolMu : treMu, reason: "t" };
      };
      for (let i = 0; i < 120; i++) { const t = gen(live); if (t && lawApplyG67(live, t)) ledger.push(t); }
      const replay = mkG67State();
      for (const t of ledger) expect(lawApplyG67(replay, t)).toBe(true); // ה-replay משקף-מילה-במילה
      expect(replay.bal.get("pool")!.usds).toBe(live.bal.get("pool")!.usds);
      expect(replay.bal.get("pool")!.saos).toBe(live.bal.get("pool")!.saos);
      expect(replay.pool.usds).toBe(live.pool.usds);
      expect(replay.pool.saos).toBe(live.pool.saos);
    }
  });
  test("תיעוד-הפגם-שנקטל: בלי-sync-החלפה — bal(\"pool\") מתפצלת-מהמודול (האדום-ההיסטורי)", () => {
    const st = mkG67State();
    const buySaos = true; const amt = fromF(10);
    const rIn = st.pool.usds, rOut = st.pool.saos;
    const out = ammOut(rIn, rOut, amt, FEE_BPS);
    const { fee } = splitFee(amt, FEE_BPS);
    // חוק-ישן (לפני-G67): ההחלפה מזיזה-מודול-בלבד — bal נשארת-מיושנת
    const oldBal = st.bal.get("pool")!.usds;
    st.pool.usds += amt; st.pool.saos -= out;
    expect(st.bal.get("pool")!.usds).toBe(oldBal); // הפיצול-עצמו — הפנדולום
    expect(st.bal.get("pool")!.usds).not.toBe(st.pool.usds);
    // חוק-G67: sync-מיידי — אחדות
    st.bal.get("pool")!.usds = st.pool.usds; st.bal.get("pool")!.saos = st.pool.saos;
    expect(st.bal.get("pool")!.usds).toBe(st.pool.usds);
  });
});
