/* ═══ profit-proof.test.ts — מוכחות-רווח: ספירת-הכנסות · מוני-נפח · חוק-הגירבוקס ═══
 * ===========================================================================
 * G78-f · fixtures = צורות-נמדדות מהמקורות החיים (saos-dex grids/state,
 * fleet-economy snapshot) — קלטות-ראייה, לא המצאות. כל-חוק נבדק fail-closed:
 * שורה-שבורה נספרת, זרם-ריק = אפס-כנה, red מאפס-את-הסטריק מיד.
 */
import { describe, test, expect } from "bun:test";
import {
  parseJsonl,
  sumCuration,
  sumFills,
  sumArb,
  sumLadder,
  parseAmount,
  classifyVerdict,
  replayGearReceipts,
  streakFromHistory,
  buildGearboxProof,
  buildYieldRows,
} from "../lib/profit-proof";

/* קלטות-ראייה: צורות-נמדדות (מקור: saos-dex grids/state/external-profit.jsonl) */
const CURATION_ROW = {
  schema: "SAOS-EXTERNAL-PROFIT/1", ts: "2026-10-21T11:00:18", block: 158825,
  trxid: null, opNature: "virtual-op", account: "headcorner", kind: "curation",
  vests: 12.894648, steem: 0.008002, sbd: 0.000833, usd: 0.00044,
  provenance: "tomoyan/steem-japan--2026-10-14-20261014t110019z",
  opHash: "158825:curation:{...}",
};
const FILL_ROW = {
  schema: "SAOS-EXTERNAL-PROFIT/1", ts: "2026-10-23T13:41:42", block: 1107,
  trxid: "b0c84fdab605f23ad4a7d7d1d0f3240534b0403d", opNature: "real-tx",
  account: "hcsoldier4", kind: "fill-evidence",
  pays: "0.155 SBD", gets: "1.500 STEEM", counterparty: "headcorner",
  profit: 0, steem: 0, sbd: 0, usd: 0, opHash: "1107:fill-evidence:{...}",
};
const CASHLY_FILL_ROW = {
  ...FILL_ROW, account: "headcorner", counterparty: "cashly",
  pays: "8.082 STEEM", gets: "0.820 SBD", ts: "2026-10-22T15:46:36",
};

describe("parseJsonl — כנות-פרסינג", () => {
  test("שורה-שבורה נספרת ב-bad (לא-מושתקת, לא-מומצאת)", () => {
    const r = parseJsonl('{"a":1}\nnot-json\n\n{"a":2}\n[1,2]\n');
    expect(r.rows.length).toBe(2);
    expect(r.bad).toBe(2); // not-json + array-row (לא-אובייקט)
  });
  test("גוף-ריק → אפס-שורות אפס-פסולות", () => {
    expect(parseJsonl("")).toEqual({ rows: [], bad: 0 });
  });
});

describe("curation — קצבת-קיורייט (accrual)", () => {
  test("סכום-נמדד לפי-מטבע + realTx נפרד מ-accrual", () => {
    const t = sumCuration([CURATION_ROW, { ...CURATION_ROW, vests: 11.282785, steem: 0.007002, sbd: 0.000729, usd: 0.000385, ts: "2026-10-21T12:00:24" }]);
    expect(t.count).toBe(2);
    expect(t.realTx).toBe(0); // virtual-op — accrual
    expect(t.vests).toBeCloseTo(24.177433, 6);
    expect(t.steem).toBeCloseTo(0.015004, 6);
    expect(t.usd).toBeCloseTo(0.000825, 6);
    expect(t.lastTs).toBe("2026-10-21T12:00:24");
  });
  test("זרם-ריק → אפסים-כנים", () => {
    const t = sumCuration([]);
    expect(t.count).toBe(0); expect(t.vests).toBe(0); expect(t.lastTs).toBeNull();
  });
});

describe("fills — נפח-ספר-הוראות אמת", () => {
  test("pays/gets מתפרקים לפי-מטבע; real-tx נספר", () => {
    const t = sumFills([FILL_ROW, CASHLY_FILL_ROW]);
    expect(t.fills).toBe(2);
    expect(t.realTx).toBe(2);
    expect(t.volumeSteem).toBeCloseTo(9.582, 3); // 1.500 + 8.082
    expect(t.volumeSbd).toBeCloseTo(0.975, 3); // 0.155 + 0.820
    expect(t.byTrader["hcsoldier4"].fills).toBe(1);
    expect(t.byTrader["hcsoldier4"].sbd).toBeCloseTo(0.155, 3);
    expect(t.byTrader["headcorner"].steem).toBeCloseTo(8.082, 3);
  });
  test("parseAmount — דקדוק-נמדד", () => {
    expect(parseAmount("8.082 STEEM")).toEqual({ amount: 8.082, asset: "STEEM" });
    expect(parseAmount("0.155 SBD")).toEqual({ amount: 0.155, asset: "SBD" });
    expect(parseAmount("garbage")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("arb — PnL-נייר מדווח-בשמו", () => {
  test("סכום-paperPnlSbd + דגלי-muted/degraded + realness", () => {
    const t = sumArb([
      { ts: "2026-10-24T14:39:25.929Z", pair: "HIVE:HBD", realness: "CEX_REF", paperPnlSbd: -0.037607, paperMuted: false, degraded: false },
      { ts: "2026-10-25T10:00:00.000Z", pair: "STEEM:SBD", realness: "CEX_REF", paperPnlSbd: 0.5, paperMuted: true, degraded: true },
    ]);
    expect(t.count).toBe(2);
    expect(t.paperPnlSbd).toBeCloseTo(0.462393, 6);
    expect(t.muted).toBe(1); expect(t.degraded).toBe(1);
    expect(t.realness["CEX_REF"]).toBe(2);
    expect(t.lastTs).toBe("2026-10-25T10:00:00.000Z");
  });
});

describe("ladder — קבלות-סולם (אוצר/צבא)", () => {
  const TX = "992cf57dc41dae186a7384b7e306210338916451";
  const receipt = (verdict: string, executed: unknown[], at: string, trader = "hcsoldier4", liveOrders = 2) =>
    ({ schema: "SAOS-TREASURY-LADDER-RECEIPT/1", at, trader, mid: 0.102, liveOrders, executed, verdict });

  test("executed עם txid = מציאות-מבצעת: נפח-notional נמדד", () => {
    const t = sumLadder([
      receipt("LADDER-ACTED", [
        { action: "create", leg: { legId: "sell-2", side: "sell", sizeSteem: 1.5, priceSbd: 0.105247 }, txid: TX, block: 110797593 },
        { action: "create", leg: { legId: "sell-2", side: "sell", sizeSteem: 1.5, priceSbd: 0.105247 }, error: "all-alt-nodes-failed" },
      ], "2026-10-27T09:22:15.649Z"),
    ]);
    expect(t.receipts).toBe(1); expect(t.green).toBe(1);
    expect(t.executedTx).toBe(1); // רק-ה-act עם txid
    expect(t.errors).toBe(1);
    expect(t.notionalSbd).toBeCloseTo(1.5 * 0.105247, 9);
    expect(t.notionalSteem).toBeCloseTo(1.5, 9);
    expect(t.openOrders).toBe(2);
    expect(t.lastVerdict).toBe("LADDER-ACTED");
  });
  test("red נספר; מעשים-שנכשלו לא-תורמים-נפח", () => {
    const t = sumLadder([
      receipt("ARMY-ACTS-FAILED", [
        { action: "create", leg: { legId: "buy-1", side: "buy", sizeSteem: 3, priceSbd: 0.099061 }, error: "all-steem-nodes-failed" },
        { action: "create", leg: { legId: "sell-2", side: "sell", sizeSteem: 3, priceSbd: 0.108422 }, state: "PARITY-FLOOR-SKIP", why: "sell 0.108422 < parity-floor 0.108422" },
      ], "2026-10-27T12:22:58.831Z", "hcsoldier5", 3),
    ]);
    expect(t.red).toBe(1); expect(t.green).toBe(0);
    expect(t.executedTx).toBe(0); expect(t.notionalSbd).toBe(0);
    expect(t.byTrader["hcsoldier5"].receipts).toBe(1);
    expect(t.openOrders).toBe(3);
  });
});

describe("gearbox law (R329/R330) — חוק-ההילוכים", () => {
  const gears = [
    { gear: 1, require: { greenStreak: 0 }, laneOverrides: { grid: { maxNotionalPerOpSbd: 25, maxCycleNotionalSbd: 120 } } },
    { gear: 2, require: { greenStreak: 6 }, laneOverrides: { grid: { maxNotionalPerOpSbd: 50, maxCycleNotionalSbd: 240 } } },
    { gear: 3, require: { greenStreak: 12 }, laneOverrides: { grid: { maxNotionalPerOpSbd: 100, maxCycleNotionalSbd: 480 } } },
  ];
  test("classifyVerdict — מילה-במילה מה-road", () => {
    expect(classifyVerdict("LADDER-ACTED")).toBe("green");
    expect(classifyVerdict("ARMY-ACTED")).toBe("green");
    expect(classifyVerdict("ARMY-ACTS-FAILED")).toBe("red");
    expect(classifyVerdict("POLICY-HALTED")).toBe("red");
    expect(classifyVerdict("AT-TARGET")).toBe("neutral");
    expect(classifyVerdict("STASIS")).toBe("neutral");
    expect(classifyVerdict("")).toBe("neutral");
  });
  test("6 ירוקות רצופות → upshift לגיר 2 (נמדד: 09:22Z היסטוריה)", () => {
    const greens = Array.from({ length: 6 }, (_, i) => ({ verdict: "ARMY-ACTED" }));
    expect(replayGearReceipts(greens.slice(0, 5), gears)).toEqual({ gear: 1, greenStreak: 5 });
    expect(replayGearReceipts(greens, gears)).toEqual({ gear: 2, greenStreak: 6 });
  });
  test("red מיידי: streak=0 gear=1 (downshift-מהיר, upshift-איטי)", () => {
    const r = replayGearReceipts(
      [...Array.from({ length: 7 }, () => ({ verdict: "ARMY-ACTED" })), { verdict: "ARMY-ACTS-FAILED" }],
      gears,
    );
    expect(r).toEqual({ gear: 1, greenStreak: 0 });
  });
  test("neutral לא מגדל ולא מאפס", () => {
    const r = replayGearReceipts(
      [{ verdict: "ARMY-ACTED" }, { verdict: "AT-TARGET" }, { verdict: "ARMY-ACTED" }],
      gears,
    );
    expect(r).toEqual({ gear: 1, greenStreak: 2 });
  });
  test("replay על-היסטוריית-ה-git (newest-first) — streakFromHistory", () => {
    const history = [
      { at: "2026-10-27T11:28:50.518Z", kind: "army", verdict: "ARMY-ACTED", gear: 1, greenStreak: 2 },
      { at: "2026-10-27T11:02:04.808Z", kind: "army", verdict: "ARMY-ACTED", gear: 1, greenStreak: 1 },
      { at: "2026-10-27T10:34:50.079Z", kind: "army", verdict: "ARMY-ACTS-FAILED", gear: 1, greenStreak: 0 },
    ];
    expect(streakFromHistory(history)).toBe(2);
    expect(streakFromHistory([{ verdict: "ARMY-ACTS-FAILED" }, { verdict: "LADDER-ACTED" }])).toBe(0);
  });
  test("buildGearboxProof — fail-closed על-טבלה-פגומה", () => {
    const p = buildGearboxProof({ protocol: "SOMETHING/ELSE" } as never, "2026-10-27T12:00:00Z", "test");
    expect(p.failClosed).toBe(true);
    expect(p.gear).toBe(1);
    expect(p.missingForNext).toContain("fail-closed");
  });
  test("buildGearboxProof — טבלה-חיה: missing-evidence מדויק להילוך-הבא", () => {
    const table = {
      protocol: "SAOS-POLICY-GEARS/1", gears,
      state: { gear: 1, greenStreak: 2, lastVerdict: "ARMY-ACTED", lastKind: "army", history: [
        { at: "2026-10-27T11:28:50.518Z", kind: "army", verdict: "ARMY-ACTED", gear: 1, greenStreak: 2 },
        { at: "2026-10-27T11:02:04.808Z", kind: "army", verdict: "ARMY-ACTED", gear: 1, greenStreak: 1 },
      ] },
    };
    const p = buildGearboxProof(table as never, "2026-10-27T12:00:00Z", "test");
    expect(p.failClosed).toBe(false);
    expect(p.gear).toBe(1); expect(p.greenStreak).toBe(2);
    expect(p.nextGear).toBe(2); expect(p.requireNextGreenStreak).toBe(6);
    expect(p.missingForNext).toContain("4 more consecutive green verdicts");
    expect(p.topGear).toBe(3);
    expect(p.crossChecks.length).toBe(0); // replay אחיקרי על ההיסטוריה החיה
  });
});

describe("yield rows — פורמט-צרכן-יציב", () => {
  test("שורות {at, stream, amount, currency, proof-ref, source} בדיוק", () => {
    const rows = buildYieldRows([
      { stream: "curation-rewards", at: "2026-10-27T12:40:00Z", proofRef: "raw:saos-dex/external-profit.jsonl", source: "saos-dex grids/state", measures: [{ amount: 0.015004, currency: "STEEM" }, { amount: 0.000825, currency: "USD" }] },
      { stream: "arb-paper-pnl", at: "2026-10-27T12:40:00Z", proofRef: "raw:saos-dex/arb-ledger.json", source: "saos-dex grids/state", measures: [] },
    ]);
    expect(rows.length).toBe(3);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["amount", "at", "currency", "proof-ref", "source", "stream"]);
    const arb = rows.find((r) => r.stream === "arb-paper-pnl")!;
    expect(arb.amount).toBe(0);
    expect(arb["proof-ref"]).toContain("stream-empty:0-rows");
    expect(arb.currency).toBe("n/a");
  });
});
