/* ═══ ledger-cycle.ts — סנאפשוט-מחזור-הספר (חוב-החידוש · G77-c יצטט) ═══
 * ===========================================================================
 * G77-b · חוב-החידוש (G76-c): פנקס-ההוצאה-לפועל Domain/execution-state.json התיישן
 * מעבר-חלון-הטריות-שלו. הליין-ההוא (G77-c) בעליו — אסור-נגיעה. חוב-הליין הזה:
 * לחשוף-סנאפשוט-מכונה-טרי (state/audit/ledger-cycle[-<N>].json) עם מדידות-אמת
 * מהספר-החי: seq · ראש-השרשרת (headHash) · אימות · הרשומות (כולל saos-0004) ·
 * סטטיסטיקת-זרימת-הדלק · הכספת. מקור-ציטוט מכונה-למכונה — אפס-סיפורים.
 *
 * מספור-המחזור: ברירת-המחדל 32 (חוב-החידוש-עצמו); אחר-כך מקס-קיים+1.
 * הבנאי טהור: כל-שדה נמדד-מהקלט — אפס-המצאה, אפס-שעון-קיר (nowIso מוזרק). */
import type { Mu } from "./mu";
import { FUEL_POLICY_DEFAULT, type FuelPlan, type FuelPolicy } from "./fuel-stream";
import type { GridSoldier } from "./grid-roster";

export const CYCLE_SCHEMA = "saos.ledger-cycle/1";
/** חוב-החידוש (G76-c · מגל-81): הסנאפשוט-הראשון = מחזור-32. */
export const CYCLE_BASELINE = 32;

export type CycleSnapshot = {
  schema: string;
  cycle: number;
  at: string;
  engine: string;
  bookGen: number;
  seq: number;
  headHash: string | null;
  verify: { ok: boolean; checked: number; anchors: number };
  roster: {
    base: string[];
    grid: { id: string; role: string; chain: string; rail: string }[];
    saos0004Registered: boolean;
  };
  fuel: {
    policy: { cycleMs: number; floorUsds: number; ceilingUsds: number; reserveUsds: number; maxDripUsds: number; cycleCapUsds: number };
    cycles: number;
    paidUsds: number;
    blocked: number;
    lastPlanId: string | null;
    lastPlan: { ok: boolean; reason: string; cycle: number; drips: { to: string; amountUsds: number; ref: string }[]; blocked: { subject: string; reason: string }[]; totalUsds: number } | null;
  };
  treasury: { usds: number };
  balances: Record<string, { usds: number }>;
  fundingRail: string;
  law: string;
};

const muUsds = (m: Mu): number => Number(m) / 1e6;

export function buildCycleSnapshot(input: {
  cycle: number;
  nowIso: string;
  engine: string;
  bookGen: number;
  seq: number;
  headHash: string | null;
  verify: { ok: boolean; checked: number; anchors: number };
  baseRoster: readonly string[];
  gridRoster: readonly GridSoldier[];
  balances: ReadonlyMap<string, Mu>;
  treasuryMu: Mu;
  lastPlan: FuelPlan | null;
  fuelCycles: number;
  fuelPaidMu: Mu;
  fuelBlocked: number;
  fundingRail: string;
  policy?: FuelPolicy;
}): CycleSnapshot {
  const pol = input.policy ?? FUEL_POLICY_DEFAULT;
  const balances: Record<string, { usds: number }> = {};
  for (const [id, b] of input.balances) balances[id] = { usds: +muUsds(b.usds).toFixed(6) };
  const grid = input.gridRoster.map((s) => ({ id: s.id, role: s.role, chain: s.chain, rail: s.rail }));
  const plan = input.lastPlan
    ? {
        ok: input.lastPlan.ok,
        reason: input.lastPlan.reason,
        cycle: input.lastPlan.cycle,
        drips: input.lastPlan.drips.map((d) => ({ to: d.to, amountUsds: +muUsds(d.amountMu).toFixed(6), ref: d.ref })),
        blocked: input.lastPlan.blocked.map((b) => ({ subject: b.subject, reason: b.reason })),
        totalUsds: +muUsds(input.lastPlan.totalMu).toFixed(6),
      }
    : null;
  return {
    schema: CYCLE_SCHEMA,
    cycle: input.cycle,
    at: input.nowIso,
    engine: input.engine,
    bookGen: input.bookGen,
    seq: input.seq,
    headHash: input.headHash,
    verify: { ...input.verify },
    roster: {
      base: [...input.baseRoster],
      grid,
      saos0004Registered: grid.some((g) => g.id === "saos-0004"),
    },
    fuel: {
      policy: {
        cycleMs: pol.cycleMs,
        floorUsds: +muUsds(pol.floorMu).toFixed(6),
        ceilingUsds: +muUsds(pol.ceilingMu).toFixed(6),
        reserveUsds: +muUsds(pol.reserveMu).toFixed(6),
        maxDripUsds: +muUsds(pol.maxDripMu).toFixed(6),
        cycleCapUsds: +muUsds(pol.cycleCapMu).toFixed(6),
      },
      cycles: input.fuelCycles,
      paidUsds: +muUsds(input.fuelPaidMu).toFixed(6),
      blocked: input.fuelBlocked,
      lastPlanId: input.lastPlan?.planId ?? null,
      lastPlan: plan,
    },
    treasury: { usds: +muUsds(input.treasuryMu).toFixed(6) },
    balances,
    fundingRail: input.fundingRail,
    law: "G77-b · סנאפשוט-מחזור-ספר — כל-שדה-נמדד-מהספר-החי · חוב-החידוש של פנקס-ההוצאה (G77-c מצטט, אפס-עריכה-שם)",
  };
}

/** מספור-המחזור: אין-קיימים/מקס-מתחת-לבסיס ⇒ 32 (חוב-החידוש); אחרת מקס+1. */
export function nextCycleNumber(existingCycles: readonly number[]): number {
  const valid = existingCycles.filter((n) => Number.isInteger(n) && n >= CYCLE_BASELINE);
  if (!valid.length) return CYCLE_BASELINE;
  return Math.max(...valid) + 1;
}
