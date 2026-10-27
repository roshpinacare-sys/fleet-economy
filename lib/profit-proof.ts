/* ═══ profit-proof.ts — מוכחות-רווח: ספירת-הכנסות אמת + מוני-נפח + חוק-הגירבוקס ═══
 * ===========================================================================
 * G78-f owner directive §1+§5 (TREASURY PROFIT PROOF): real yield streaming,
 * orderbook volume, gearbox upshift — all measured, zero invented rows.
 *
 * מקורות-נמדדים (raw.githubusercontent.com/roshpinacare-sys/<repo>/main/...):
 *   • saos-dex grids/state/external-profit.jsonl  (SAOS-EXTERNAL-PROFIT/1)
 *       kind="curation"      → קצבת-קיורייט (accrual, vests-denominated)
 *       kind="fill-evidence" → מילויי-ספר-הוראות אמת (opNature="real-tx" + trxid)
 *   • saos-dex grids/state/arb-ledger.json        (arb-ledger-v1, paperPnlSbd)
 *   • saos-dex grids/state/treasury-receipts.jsonl (SAOS-TREASURY-LADDER-RECEIPT/1)
 *   • saos-dex grids/state/army-receipts.jsonl     (SAOS-ARMY-LADDER-RECEIPT/1)
 *   • saos-dex grids/state/policy-gears.json       (SAOS-POLICY-GEARS/1 — the gearbox table)
 *   • fleet-economy state/snapshot.json            (הבריכה-הפנימית: עמלות-AMM)
 *
 * חוקים:
 *   - אפס-המצאות: שורת-נתונים נכנסת רק ממקור שנמדד; זרם-ריק = שורת אפס-כנה
 *     (amount 0 + proof-ref "stream-empty"), לעולם לא שורה מומצאת.
 *   - fail-honest: שורה-שבורה נספרת ב-bad ולא מושתקת; מקור-שנכשל מדווח בשמו.
 *   - R329/R330 gearbox law (verbatim semantics, אותו-חוק של ה-road ב-saos-dex
 *     ושל ה-evaluator ב-giant): verdict /ACTED/ && !/FAILED|HALTED/ = green →
 *     streak++ (+upshift גיר-אחד-לקבלה); /FAILED|HALTED/ = red → streak=0,
 *     gear=1 (מיידי); אחרת neutral → ללא-שינוי.
 *   - אפס-תלות-חוץ, אפס-שעון-בחוק (השעון מוזרק על-ידי הקורא).
 */

/* ─── JSONL ─────────────────────────────────────────────────────────────── */

export interface JsonlResult {
  rows: Record<string, unknown>[];
  bad: number;
}

/** Parse a JSONL body; broken lines are COUNTED (never silently dropped). */
export function parseJsonl(text: string): JsonlResult {
  const rows: Record<string, unknown>[] = [];
  let bad = 0;
  for (const line of String(text ?? "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v as Record<string, unknown>);
      else bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { rows, bad };
}

/* ─── external-profit (curation + fill-evidence) ────────────────────────── */

export interface StreamTotals {
  count: number;
  realTx: number;
  vests: number;
  steem: number;
  sbd: number;
  usd: number;
  lastTs: string | null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function sumCuration(rows: Record<string, unknown>[]): StreamTotals {
  const t: StreamTotals = { count: 0, realTx: 0, vests: 0, steem: 0, sbd: 0, usd: 0, lastTs: null };
  for (const r of rows) {
    if (str(r.kind) !== "curation") continue;
    t.count += 1;
    if (str(r.opNature) === "real-tx") t.realTx += 1;
    t.vests += num(r.vests);
    t.steem += num(r.steem);
    t.sbd += num(r.sbd);
    t.usd += num(r.usd);
    const ts = str(r.ts);
    if (ts && (!t.lastTs || ts > t.lastTs)) t.lastTs = ts;
  }
  return t;
}

/** "8.082 STEEM" → { amount: 8.082, asset: "STEEM" } — measured pays/gets grammar. */
export function parseAmount(s: string): { amount: number; asset: string } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s+([A-Za-z]+)\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const amount = Number(m[1]);
  return Number.isFinite(amount) ? { amount, asset: m[2].toUpperCase() } : null;
}

export interface FillTotals {
  fills: number;
  realTx: number;
  volumeSteem: number;
  volumeSbd: number;
  lastTs: string | null;
  byTrader: Record<string, { fills: number; steem: number; sbd: number }>;
}

/** fill-evidence rows: pays/gets = real orderbook volume (per side account). */
export function sumFills(rows: Record<string, unknown>[]): FillTotals {
  const t: FillTotals = { fills: 0, realTx: 0, volumeSteem: 0, volumeSbd: 0, lastTs: null, byTrader: {} };
  for (const r of rows) {
    if (str(r.kind) !== "fill-evidence") continue;
    t.fills += 1;
    if (str(r.opNature) === "real-tx") t.realTx += 1;
    for (const field of ["pays", "gets"] as const) {
      const a = parseAmount(str(r[field]));
      if (!a) continue;
      if (a.asset === "STEEM") t.volumeSteem += a.amount;
      else if (a.asset === "SBD") t.volumeSbd += a.amount;
    }
    const acct = str(r.account) || "unknown";
    const slot = (t.byTrader[acct] ??= { fills: 0, steem: 0, sbd: 0 });
    slot.fills += 1;
    const pays = parseAmount(str(r.pays));
    if (pays) {
      if (pays.asset === "STEEM") slot.steem += pays.amount;
      else if (pays.asset === "SBD") slot.sbd += pays.amount;
    }
    const ts = str(r.ts);
    if (ts && (!t.lastTs || ts > t.lastTs)) t.lastTs = ts;
  }
  return t;
}

/* ─── arb-ledger ────────────────────────────────────────────────────────── */

export interface ArbTotals {
  count: number;
  paperPnlSbd: number;
  muted: number;
  degraded: number;
  realness: Record<string, number>;
  lastTs: string | null;
}

export function sumArb(entries: Record<string, unknown>[]): ArbTotals {
  const t: ArbTotals = { count: 0, paperPnlSbd: 0, muted: 0, degraded: 0, realness: {}, lastTs: null };
  for (const e of entries) {
    t.count += 1;
    t.paperPnlSbd += num(e.paperPnlSbd);
    if (e.paperMuted === true) t.muted += 1;
    if (e.degraded === true) t.degraded += 1;
    const rn = str(e.realness) || "unknown";
    t.realness[rn] = (t.realness[rn] ?? 0) + 1;
    const ts = str(e.ts);
    if (ts && (!t.lastTs || ts > t.lastTs)) t.lastTs = ts;
  }
  return t;
}

/* ─── ladder receipts (treasury + army) ─────────────────────────────────── */

export interface LadderAct {
  action: string;
  leg: { legId?: string; side?: string; sizeSteem?: number; priceSbd?: number; [k: string]: unknown };
  txid?: string;
  block?: number;
  cancelTxid?: string | null;
  error?: string;
  state?: string;
  why?: string;
  [k: string]: unknown;
}

export interface LadderTotals {
  receipts: number;
  green: number;
  red: number;
  neutral: number;
  executedTx: number;
  errors: number;
  notionalSbd: number;
  notionalSteem: number;
  lastVerdict: string | null;
  lastAt: string | null;
  openOrders: number | null;
  byTrader: Record<string, { receipts: number; executedTx: number }>;
}

const actIsReal = (a: LadderAct): boolean => typeof a.txid === "string" && a.txid.length > 0;
const actNotional = (a: LadderAct): { sbd: number; steem: number } => {
  const size = num(a.leg?.sizeSteem);
  const price = num(a.leg?.priceSbd);
  return { sbd: size * price, steem: size };
};

export function sumLadder(rows: Record<string, unknown>[]): LadderTotals {
  const t: LadderTotals = {
    receipts: 0, green: 0, red: 0, neutral: 0, executedTx: 0, errors: 0,
    notionalSbd: 0, notionalSteem: 0, lastVerdict: null, lastAt: null, openOrders: null, byTrader: {},
  };
  for (const r of rows) {
    t.receipts += 1;
    const cls = classifyVerdict(str(r.verdict));
    if (cls === "green") t.green += 1;
    else if (cls === "red") t.red += 1;
    else t.neutral += 1;
    const executed = Array.isArray(r.executed) ? (r.executed as LadderAct[]) : [];
    for (const a of executed) {
      if (a && typeof a === "object") {
        if (actIsReal(a)) {
          t.executedTx += 1;
          const n = actNotional(a);
          t.notionalSbd += n.sbd;
          t.notionalSteem += n.steem;
        }
        if (typeof a.error === "string" && a.error) t.errors += 1;
      }
    }
    const trader = str(r.trader) || "unknown";
    const slot = (t.byTrader[trader] ??= { receipts: 0, executedTx: 0 });
    slot.receipts += 1;
    for (const a of executed) if (a && actIsReal(a)) slot.executedTx += 1;
    if (typeof r.liveOrders === "number" && Number.isFinite(r.liveOrders)) t.openOrders = r.liveOrders;
    const at = str(r.at);
    if (at && (!t.lastAt || at > t.lastAt)) {
      t.lastAt = at;
      t.lastVerdict = str(r.verdict) || null;
    }
  }
  return t;
}

/* ─── gearbox law (R329/R330 — verbatim semantics) ──────────────────────── */

export type VerdictClass = "green" | "red" | "neutral";

/** R329: /ACTED/ && !/FAILED|HALTED/ green; /FAILED|HALTED/ red; else neutral. */
export function classifyVerdict(verdict: string): VerdictClass {
  const v = String(verdict ?? "");
  if (/FAILED|HALTED/.test(v)) return "red";
  if (/ACTED/.test(v)) return "green";
  return "neutral";
}

export interface GearRow {
  gear: number;
  require: { greenStreak: number };
  laneOverrides: Record<string, unknown>;
}

export interface GearTable {
  protocol: string;
  gears?: GearRow[];
  state?: {
    gear?: number;
    greenStreak?: number;
    lastVerdict?: string | null;
    history?: Array<{ at: string; kind: string; verdict: string; gear: number; greenStreak: number }>;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

/** Chronological replay from cold start (gear 1, streak 0); one gear per green receipt. */
export function replayGearReceipts(
  receipts: ReadonlyArray<{ verdict: string }>,
  gears?: GearRow[] | null,
): { gear: number; greenStreak: number } {
  const sorted = validGears(gears)
    ? [...gears].sort((a, b) => a.require.greenStreak - b.require.greenStreak)
    : null;
  let gear = 1;
  let streak = 0;
  for (const r of receipts) {
    const c = classifyVerdict(String(r?.verdict ?? ""));
    if (c === "red") {
      streak = 0;
      gear = 1;
    } else if (c === "green") {
      streak += 1;
      const next = sorted?.find(
        (row) => row.require.greenStreak > 0 && streak >= row.require.greenStreak && row.gear > gear,
      );
      if (next) gear = next.gear;
    } // neutral: no change
  }
  return { gear, greenStreak: streak };
}

/** Walk git-written history (newest first): green counts, red stops, neutral transparent. */
export function streakFromHistory(
  history: ReadonlyArray<{ verdict: string }> | null | undefined,
): number {
  let n = 0;
  for (const h of history ?? []) {
    const c = classifyVerdict(String(h?.verdict ?? ""));
    if (c === "red") break;
    if (c === "green") n += 1;
  }
  return n;
}

function validGears(gears: GearRow[] | null | undefined): GearRow[] | null {
  if (!Array.isArray(gears) || gears.length === 0) return null;
  for (const g of gears) {
    if (!g || typeof g !== "object") return null;
    if (typeof g.gear !== "number" || !Number.isFinite(g.gear)) return null;
    if (!g.require || typeof g.require.greenStreak !== "number" || !Number.isFinite(g.require.greenStreak)) return null;
    if (!g.laneOverrides || typeof g.laneOverrides !== "object") return null;
  }
  return gears;
}

export interface GearboxProof {
  schema: "SAOS-GEARBOX-PROOF/1";
  at: string;
  source: string;
  failClosed: boolean;
  gear: number;
  greenStreak: number;
  lastVerdict: string | null;
  lastKind: string | null;
  nextGear: number | null;
  requireNextGreenStreak: number | null;
  missingForNext: string | null;
  topGear: number;
  historyTail: Array<{ at: string; kind: string; verdict: string; gear: number; greenStreak: number }>;
  crossChecks: string[];
}

/** The proof artifact: git state + independent replay cross-check, honest on any mismatch. */
export function buildGearboxProof(table: GearTable | null, at: string, source: string, historyTailN = 12): GearboxProof {
  const failClosed = !table || table.protocol !== "SAOS-POLICY-GEARS/1" || !validGears(table.gears ?? null);
  if (failClosed) {
    return {
      schema: "SAOS-GEARBOX-PROOF/1", at, source, failClosed: true,
      gear: 1, greenStreak: 0, lastVerdict: null, lastKind: null,
      nextGear: null, requireNextGreenStreak: null,
      missingForNext: "fail-closed: gear table missing/invalid — gear 1 forced (most conservative row)",
      topGear: 1, historyTail: [],
      crossChecks: [`protocol=${table?.protocol ?? "missing"} — expected SAOS-POLICY-GEARS/1`],
    };
  }
  const gears = table.gears!;
  const st = table.state ?? {};
  const history = Array.isArray(st.history) ? st.history : [];
  const gitGear = typeof st.gear === "number" ? st.gear : 1;
  const gitStreak = typeof st.greenStreak === "number" ? st.greenStreak : streakFromHistory(history);
  const replayed = replayGearReceipts([...history].reverse(), gears);
  const crossChecks: string[] = [];
  if (replayed.gear !== gitGear) {
    crossChecks.push(`replayed gear ${replayed.gear} != git state gear ${gitGear} (history window may be truncated at ${history.length} entries; the road is the saos-dex writer — this is a read-only proof)`);
  }
  if (replayed.greenStreak !== gitStreak && typeof st.greenStreak === "number") {
    crossChecks.push(`replayed streak ${replayed.greenStreak} != git state streak ${st.greenStreak}`);
  }
  const sorted = [...gears].sort((a, b) => a.require.greenStreak - b.require.greenStreak);
  const topGear = sorted.reduce((acc, g) => Math.max(acc, g.gear), 1);
  const next = sorted.find((g) => g.gear > gitGear) ?? null;
  const missingForNext = next
    ? `greenStreak ${gitStreak}/${next.require.greenStreak} — ${Math.max(0, next.require.greenStreak - gitStreak)} more consecutive green verdicts required (e.g. LADDER-ACTED/ARMY-ACTED); any FAILED/HALTED resets instantly`
    : null;
  return {
    schema: "SAOS-GEARBOX-PROOF/1", at, source, failClosed: false,
    gear: gitGear, greenStreak: gitStreak,
    lastVerdict: str(st.lastVerdict) || null, lastKind: str((st as Record<string, unknown>).lastKind) || null,
    nextGear: next?.gear ?? null, requireNextGreenStreak: next?.require.greenStreak ?? null,
    missingForNext, topGear,
    historyTail: history.slice(0, historyTailN),
    crossChecks,
  };
}

/* ─── yield-intake rows (stable consumer format) ────────────────────────── */

export interface YieldRow {
  at: string;
  stream: string;
  amount: number;
  currency: string;
  "proof-ref": string;
  source: string;
}

export interface YieldStreamInput {
  stream: string;
  at: string;
  proofRef: string;
  source: string;
  /** measured rows; empty → honest zero-row */
  measures: Array<{ amount: number; currency: string }>;
}

/** One row per (stream, currency) measure; empty stream = one honest zero row. */
export function buildYieldRows(inputs: YieldStreamInput[]): YieldRow[] {
  const out: YieldRow[] = [];
  for (const inp of inputs) {
    const seen = new Set<string>();
    let any = false;
    for (const m of inp.measures) {
      if (!Number.isFinite(m.amount)) continue;
      const key = m.currency;
      if (seen.has(key)) {
        // merge duplicate currencies into one row (sum) — stable one-row-per-currency
        const existing = out.find((r) => r.stream === inp.stream && r.currency === m.currency);
        if (existing) existing.amount += m.amount;
        continue;
      }
      seen.add(key);
      any = true;
      out.push({ at: inp.at, stream: inp.stream, amount: m.amount, currency: m.currency, "proof-ref": inp.proofRef, source: inp.source });
    }
    if (!any) {
      out.push({ at: inp.at, stream: inp.stream, amount: 0, currency: "n/a", "proof-ref": `stream-empty:0-rows@${inp.proofRef}`, source: inp.source });
    }
  }
  return out;
}

/* ─── volume counters (stable consumer format) ──────────────────────────── */

export interface VolumeCounterSource {
  name: string;
  url: string;
  http: number;
  bytes: number;
  rows: number | null;
  bad: number;
}

export interface VolumeCounters {
  schema: "SAOS-VOLUME-COUNTERS/1";
  generatedAt: string;
  orderbook: {
    fills: number;
    fillsRealTx: number;
    volumeSteem: number;
    volumeSbd: number;
    byTrader: Record<string, { fills: number; steem: number; sbd: number }>;
  };
  ladder: {
    treasury: { receipts: number; green: number; red: number; executedTx: number; errors: number; notionalSbd: number; notionalSteem: number; openOrders: number | null; lastVerdict: string | null };
    army: { receipts: number; green: number; red: number; executedTx: number; errors: number; notionalSbd: number; notionalSteem: number; openOrders: number | null; lastVerdict: string | null };
  };
  gearbox: { gear: number; greenStreak: number; lastVerdict: string | null; nextGear: number | null; requireNextGreenStreak: number | null; failClosed: boolean };
  economy: { seq: number | null; poolFeesUsds: number | null; poolFeesSaos: number | null };
  sources: VolumeCounterSource[];
}
