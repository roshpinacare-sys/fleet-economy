/* ═══ fuel-stream.test.ts — מפעל-התדלוק הריבוני · הוכחות דטרמיניסטיות ═══
 * ===========================================================================
 * G77-b (מנדט-בעלים §1.3 · trace 1a178c595ee6edd5 · 2026-10-26):
 * זרימת-דלק אוטונומית-רציפה מהכספת אל חיילי-הגריד (כולל saos-0004) על ספר
 * ה-hash — חוקי-רצפה/תקרה, אידמפוטנטיות לפי planId, fail-closed על מחסור-כספת
 * עם קבלות-חסימה כנות (אפס-יתרות-מפוברקות).
 *
 * מה-הטסט הזה מוכיח (אפס-רשת · אפס-שעון-קיר · ספר-סינתטי · אפס-תלות-חדשה):
 *  1. אידמפוטנטיות (חוק c של המש-rc-rebalance): קלט-זהה ⇒ planId זהה ותוכנית
 *     deep-equal — השעון מוזרק ונשלל מה-planId.
 *  2. חוק-רצפה: חייל-מתחת-לרצפה מתודלק בדיוק עד-הרצפה (מוגבל-תקרת-מנה).
 *  3. חוק-תקרה: חייל-מעל-הרצפה לא מקבל כלום · אף-טפטוף לא דוחף מעל-הרצפה.
 *  4. חוק-רזרבת-כספת: מחסור → ok:false + קבלת-חסימה כנה (fuel-blocked-<planId>)
 *     · treasuryAfter === treasuryBefore — אפס-כסף-מהאוויר.
 *  5. חוק-תקרת-מחזור: הסך-למחזור ≤ cycleCap · ניצול-מלא-מסודר-בסדר-הרשומה ·
 *     הנותרים חסומים-כנים (cycle-cap-exhausted) — אף-שקט-לא-ממוצה.
 *  6. אריתמטיקה-שלמה: הכל BigInt µ¢ · שימור: Σdrips === treasuryBefore−after.
 *  7. מחזור-דטרמיניסטי: cycle = ⌊now/cycleMs⌋ · planId משתנה-בין-מחזורים בלבד.
 *  8. רשומת-גריד נתונית: קובץ-רשום תקין נטען · קובץ-פגום → fail-closed לברירת-
 *     מחדל-הריקה (המנוע-לא-מת) · id-פסול נדחה · כפילות נדחית · תקרת-גודל.
 *  9. סנאפשוט-מחזור-ספר: כל-שדה נמדד-וכנה · אין-המצאה · cycle-32 ברירת-המחדל
 *     של חוב-החידוש · מספור = מקס-קיים+1.
 * 10. סדר-קבוע: הטפטופים יוצאים בסדר-הרשומה (דטרמיניזם-מלא לקבלות-השרשרת).
 */
import { describe, test, expect } from "bun:test";
import { fromF, toF, type Mu } from "../lib/mu";
import {
  planFuelStream,
  fuelCycleIndex,
  fuelPlanId,
  type FuelPolicy,
  type FuelPlan,
} from "../lib/fuel-stream";
import {
  parseGridRoster,
  loadGridRoster,
  GRID_ROSTER_RELPATH,
  emptyGridRoster,
} from "../lib/grid-roster";
import {
  buildCycleSnapshot,
  nextCycleNumber,
  CYCLE_BASELINE,
} from "../lib/ledger-cycle";

/* ── מדיניות-מבחן (µ¢ — מ-fromF בלבד, אפס-פלואט-בחוק) ── */
const POLICY: FuelPolicy = {
  cycleMs: 120_000,
  floorMu: fromF(2),
  ceilingMu: fromF(25),
  reserveMu: fromF(150),
  maxDripMu: fromF(2),
  cycleCapMu: fromF(10),
};

const T0 = 1_793_100_000_000; // שעון-מוזרק קבוע (לא Date.now — אפס-זמן-קיר)

/* ספר-סינתטי: כספת בריאה + חיילי-גריד במצבים שונים */
function synthBook(): { roster: string[]; balances: Map<string, Mu>; treasury: Mu } {
  return {
    roster: ["headcorner", "saos-0001", "saos-0002", "saos-0003", "saos-0004"],
    balances: new Map<string, Mu>([
      ["headcorner", fromF(0.5)],
      ["saos-0001", fromF(2)], // בדיוק-על-הרצפה — לא-חסר-כלום
      ["saos-0002", fromF(30)], // מעל-התקרה — לא-מתודלק-לעולם
      ["saos-0003", fromF(1.9)],
      ["saos-0004", fromF(0)], // החייל-החדש — יבש-לגמרי
    ]),
    treasury: fromF(1_000),
  };
}

describe("אידמפוטנטיות לפי planId (חוק c של המש)", () => {
  test("קלט-זהה + שעון-שונה-בתוך-אותו-מחזור ⇒ planId זהה ותוכנית deep-equal", () => {
    const b = synthBook();
    const p1 = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const p2 = planFuelStream(T0 + 45_000, b.roster, b.balances, b.treasury, POLICY);
    expect(p1.planId).toBe(p2.planId);
    const ser = (p: FuelPlan) => JSON.stringify(p.drips.map((d) => ({ to: d.to, amountMu: d.amountMu.toString(), ref: d.ref })));
    expect(ser(p1)).toBe(ser(p2));
    expect(p1.cycle).toBe(p2.cycle);
  });
  test("planId נגזר-sha256-מהליבה (roster+יתרות+מדיניות+מחזור) — רגיש-לכל-שינוי", () => {
    const b = synthBook();
    const base = fuelPlanId({ roster: b.roster, balances: [...b.balances].map(([id, usds]) => ({ id, usds })), policy: POLICY, cycle: 7 });
    const movedBal = new Map(b.balances); movedBal.set("saos-0004", fromF(0.01));
    const afterBal = fuelPlanId({ roster: b.roster, balances: [...movedBal].map(([id, usds]) => ({ id, usds })), policy: POLICY, cycle: 7 });
    const afterCycle = fuelPlanId({ roster: b.roster, balances: [...b.balances].map(([id, usds]) => ({ id, usds })), policy: POLICY, cycle: 8 });
    expect(base).not.toBe(afterBal); // יתרה-השתנתה → planId חדש
    expect(base).not.toBe(afterCycle); // מחזור-חדש → planId חדש (הספק-הבא חוקי)
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });
  test("refs-הטפטוף נגזרים-מה-planId — dedup-המנוע הופך את-ההוצאה לאידמפוטנטית", () => {
    const b = synthBook();
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    for (const d of p.drips) expect(d.ref).toBe(`fuel-${p.planId}-${d.to}`);
  });
});

describe("חוקי-רצפה ותקרה", () => {
  test("חייל-מתחת-הרצפה מתודלק בדיוק-עד-הרצפה · saos-0004-היבש-מתודלק-מאפס", () => {
    const b = synthBook();
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    expect(p.ok).toBe(true);
    expect(p.reason).toBe("dripped");
    const by = new Map(p.drips.map((d) => [d.to, d.amountMu]));
    expect(by.get("headcorner")).toBe(fromF(1.5)); // 0.5 → 2
    expect(by.get("saos-0004")).toBe(fromF(2)); // 0 → 2 (מנה-מלאה)
    expect(by.get("saos-0003")).toBe(fromF(0.1)); // 1.9 → 2
    expect(by.has("saos-0001")).toBe(false); // על-הרצפה — לא-חסר
    expect(by.has("saos-0002")).toBe(false); // מעל-תקרה — לעולם-לא
  });
  test("תקרת-מנה: טפטוף = min(רצפה−יתרה, maxDrip) — לעולם-לא-מעל-המנה", () => {
    const b = synthBook();
    b.balances.set("saos-0004", fromF(0.01));
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const by = new Map(p.drips.map((d) => [d.to, d.amountMu]));
    expect(by.get("saos-0004")).toBe(fromF(1.99)); // want=1.99 < maxDrip=2 → ה-רצפה-היא-הקובע
    b.balances.set("saos-0004", fromF(0));
    const p2 = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const by2 = new Map(p2.drips.map((d) => [d.to, d.amountMu]));
    expect(by2.get("saos-0004")).toBe(POLICY.maxDripMu); // want=2 → המנה-המלאה
  });
  test("תקרת-מחזור: הסך ≤ cycleCap · סדר-הרשומה קובע · הנותרים חסומים-כנים", () => {
    const b = synthBook();
    for (const id of b.roster) b.balances.set(id, fromF(0)); // הכל-יבש — רוצים 2 לכל-אחד (Σ10 = cap בדיוק)
    b.roster.push("saos-0005"); // חייל-שישי — ה-cap ייגמר לפניו
    b.balances.set("saos-0005", fromF(0));
    const tight: FuelPolicy = { ...POLICY, cycleCapMu: fromF(9) };
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, tight);
    expect(p.ok).toBe(true);
    expect(p.reason).toBe("dripped");
    expect(toF(p.totalMu)).toBe(9);
    expect(p.drips.length).toBe(5); // hc,s1,s2,s3 מנה-מלאה (8) + saos-0004 שארית 1 = cap 9
    expect(p.drips[4].to).toBe("saos-0004");
    expect(p.drips[4].amountMu).toBe(fromF(1)); // השארית-האחרונה-של-ה-cap
    expect(p.blocked.some((x) => x.subject === "saos-0005" && x.reason === "cycle-cap-exhausted")).toBe(true);
    expect(toF(p.treasuryAfterMu)).toBe(991); // 1000 − 9 — שימור-מדויק
  });
  test("שימור-כפול: Σdrips === treasuryBefore − treasuryAfter · אף-חשבון-לא-נוגע-שלילית", () => {
    const b = synthBook();
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const sum = p.drips.reduce((a, d) => a + d.amountMu, 0n);
    expect(sum).toBe(p.totalMu);
    expect(p.treasuryBeforeMu - p.treasuryAfterMu).toBe(p.totalMu);
    for (const d of p.drips) expect(d.amountMu > 0n).toBe(true);
  });
});

describe("fail-closed על מחסור-כספת (קבלות-חסימה כנות)", () => {
  test("כספת-מתחת-לרזרבה ⇒ ok:false · blocked-insufficient-treasury · אפס-טפטופים · ref-קבלת-חסימה", () => {
    const b = synthBook();
    const p = planFuelStream(T0, b.roster, b.balances, fromF(120), POLICY); // 120 < רזרבה 150
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("blocked-insufficient-treasury");
    expect(p.drips).toEqual([]);
    expect(p.totalMu).toBe(0n);
    expect(p.treasuryAfterMu).toBe(p.treasuryBeforeMu); // אפס-יתרה-מפוברקת
    expect(p.blocked[0].subject).toBe("treasury");
    expect(p.blocked[0].ref).toBe(`fuel-blocked-${p.planId}`);
    expect(p.blocked[0].reason).toContain("150"); // הרזרבה-החוקית-מצוינת-בכנות
  });
  test("כספת-גדולה-מהרזרבה-אך-קטנה-מהצורך ⇒ טפטוף-חלקי-עד-הרזרבה-בלבד", () => {
    const b = synthBook();
    for (const id of b.roster) b.balances.set(id, fromF(0));
    const p = planFuelStream(T0, b.roster, b.balances, fromF(153), POLICY); // מעל-רזרבה 150 ב-3 בלבד
    expect(p.ok).toBe(true);
    expect(toF(p.totalMu)).toBe(3); // בדיוק-העודף-מעל-הרזרבה — אף-µ¢-מעל
    expect(p.blocked.some((x) => x.reason === "treasury-reserve-guard")).toBe(true);
  });
  test("רשומה-ריקה ⇒ blocked-empty-roster · מדיניות-פסולה ⇒ blocked-invalid-policy", () => {
    const b = synthBook();
    const empty = planFuelStream(T0, [], b.balances, b.treasury, POLICY);
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe("blocked-empty-roster");
    const bad: FuelPolicy = { ...POLICY, floorMu: fromF(50), ceilingMu: fromF(10) }; // רצפה-מעל-תקרה
    const invalid = planFuelStream(T0, b.roster, b.balances, b.treasury, bad);
    expect(invalid.ok).toBe(false);
    expect(invalid.reason).toBe("blocked-invalid-policy");
    const zeroDrip: FuelPolicy = { ...POLICY, maxDripMu: 0n };
    expect(planFuelStream(T0, b.roster, b.balances, b.treasury, zeroDrip).reason).toBe("blocked-invalid-policy");
  });
  test("הכל-מעל-הרצפה ⇒ ok:true · all-above-floor · אפס-מגע-בכספת", () => {
    const b = synthBook();
    for (const id of b.roster) b.balances.set(id, fromF(5));
    const p = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    expect(p.ok).toBe(true);
    expect(p.reason).toBe("all-above-floor");
    expect(p.drips).toEqual([]);
    expect(p.totalMu).toBe(0n);
    expect(p.treasuryAfterMu).toBe(p.treasuryBeforeMu);
  });
});

describe("מחזור-דטרמיניסטי (שעון-מוזרק)", () => {
  test("cycle = ⌊now/cycleMs⌋ — חלוקה-שלמה-כנה", () => {
    expect(fuelCycleIndex(0, 120_000)).toBe(0);
    expect(fuelCycleIndex(119_999, 120_000)).toBe(0);
    expect(fuelCycleIndex(120_000, 120_000)).toBe(1);
    expect(fuelCycleIndex(T0, 120_000)).toBe(Math.floor(T0 / 120_000));
  });
  test("מחזור-חדש ⇒ planId-חדש ⇒ refs-חדשים — הזרם-הבא-חוקי-ולא-חסום-dedup", () => {
    const b = synthBook();
    const p1 = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const drained = new Map(b.balances);
    for (const d of p1.drips) drained.set(d.to, drained.get(d.to)! + d.amountMu);
    const p2 = planFuelStream(T0 + POLICY.cycleMs, b.roster, drained, b.treasury - p1.totalMu, POLICY);
    expect(p2.planId).not.toBe(p1.planId);
    expect(p2.drips.every((d) => !p1.drips.some((x) => x.ref === d.ref))).toBe(true);
  });
});

describe("רשומת-הגריד הנתונית (state/grid-roster.json)", () => {
  test(GRID_ROSTER_RELPATH + " — קובץ-רשום-תקין נטען-מלא", () => {
    const r = loadGridRoster("/home/z/audit/repos/fleet-economy/state");
    expect(r.source).toBe("registry");
    expect(r.schema).toBe("saos.grid-roster/1");
    const ids = r.soldiers.map((s) => s.id);
    expect(ids).toContain("saos-0004"); // הרישום-המנדטי
    expect(ids).toContain("headcorner");
    expect(ids).toContain("saos-0001");
    for (const s of r.soldiers) {
      expect(s.role.length).toBeGreaterThan(0);
      expect(["steem", "hive", "blurt", "internal"]).toContain(s.chain);
      expect(["internal-credits", "steem", "sbd"]).toContain(s.rail);
    }
  });
  test("JSON-פגום ⇒ fail-closed לברירת-המחדל-הריקה (המנוע-לא-מת · כנות-מלאה)", () => {
    const r = loadGridRoster("/home/z/coord-work/tmp/G77b/no-such-dir-כנה");
    expect(r.source).toBe("default");
    expect(r.soldiers).toEqual([]);
  });
  test("parse: id-פסול/כפילות/schema-שגוי נדחים-זעקה (לא-שקט)", () => {
    expect(() => parseGridRoster(JSON.stringify({ schema: "saos.grid-roster/1", soldiers: [{ id: "UPPER", role: "x", chain: "steem", rail: "internal-credits" }] }))).toThrow();
    expect(() => parseGridRoster(JSON.stringify({ schema: "saos.grid-roster/1", soldiers: [{ id: "saos-0004", role: "x", chain: "steem", rail: "internal-credits" }, { id: "saos-0004", role: "y", chain: "steem", rail: "internal-credits" }] }))).toThrow();
    expect(() => parseGridRoster(JSON.stringify({ schema: "saos.grid-roster/9", soldiers: [] }))).toThrow();
    expect(() => parseGridRoster("לא-json")).toThrow();
    const ok = parseGridRoster(JSON.stringify({ schema: "saos.grid-roster/1", soldiers: [{ id: "saos-0004", role: "חייל-גריד", chain: "steem", rail: "internal-credits" }] }));
    expect(ok.soldiers[0].id).toBe("saos-0004");
  });
  test("emptyGridRoster — ברירת-המחדל-הכנה", () => {
    expect(emptyGridRoster().source).toBe("default");
    expect(emptyGridRoster().soldiers).toEqual([]);
  });
});

describe("סנאפשוט-מחזור-הספר (חוב-החידוש cycle-32 · G77-c יצטט)", () => {
  test("buildCycleSnapshot — כל-שדה-נמדד · אפס-המצאה · saos-0004-נרשם-מוצהר", () => {
    const b = synthBook();
    const plan: FuelPlan = planFuelStream(T0, b.roster, b.balances, b.treasury, POLICY);
    const snap = buildCycleSnapshot({
      cycle: 32,
      nowIso: new Date(T0).toISOString(),
      engine: "fleet-economy",
      bookGen: 3,
      seq: 68_058,
      headHash: "a8f83b7054de33a672933b824e56448f",
      verify: { ok: true, checked: 68_058, anchors: 0 },
      baseRoster: ["yarden", "tamar", "shachar", "aluf", "erez", "gal"],
      gridRoster: parseGridRoster(JSON.stringify({ schema: "saos.grid-roster/1", soldiers: [{ id: "saos-0004", role: "חייל-גריד", chain: "steem", rail: "internal-credits" }] })).soldiers,
      balances: b.balances,
      treasuryMu: b.treasury,
      lastPlan: plan,
      fuelCycles: 11,
      fuelPaidMu: fromF(12.5),
      fuelBlocked: 2,
      fundingRail: "STEEM/SBD → ext-flows gate (venue+txid provenance) · internal credits → fuel lane",
    });
    expect(snap.schema).toBe("saos.ledger-cycle/1");
    expect(snap.cycle).toBe(32);
    expect(snap.seq).toBe(68_058);
    expect(snap.headHash).toBe("a8f83b7054de33a672933b824e56448f");
    expect(snap.verify.ok).toBe(true);
    expect(snap.roster.grid.map((g) => g.id)).toEqual(["saos-0004"]);
    expect(snap.roster.saos0004Registered).toBe(true);
    expect(snap.fuel.lastPlanId).toBe(plan.planId);
    expect(snap.fuel.paidUsds).toBe(12.5);
    expect(snap.fuel.blocked).toBe(2);
    expect(snap.treasury.usds).toBe(1_000);
    expect(snap.fundingRail).toContain("STEEM");
  });
  test("nextCycleNumber — ברירת-המחדל 32 (חוב-החידוש) · אחר-כך מקס-קיים+1", () => {
    expect(CYCLE_BASELINE).toBe(32);
    expect(nextCycleNumber([])).toBe(32);
    expect(nextCycleNumber([32, 33])).toBe(34);
    expect(nextCycleNumber([5])).toBe(32); // מספור-ישן-מתחת-לבסיס — החוב-קודם
  });
});
