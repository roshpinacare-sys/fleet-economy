#!/usr/bin/env bun
/* ═══ profit-proof-export.mjs — יצוא-מוכחות-רווח מהמקורות-החיים (G78-f §1+§5) ═══
 * ===========================================================================
 * קורא-בלבד: מושך את המדינות האחרונות מ-origin (raw.githubusercontent.com/
 * roshpinacare-sys/<repo>/main/...) בזמן-אינטגרציה, סופר הכנסות-אמת, בונה
 * מוני-נפח + מוכחת-גירבוקס, וכותב 3 ארטיפקטים יציבים ל-state/ (אטום: tmp+rename):
 *
 *   state/yield-intake.jsonl   — שורות {at, stream, amount, currency, proof-ref, source}
 *   state/volume-counters.json — SAOS-VOLUME-COUNTERS/1 (ספר-ההוראות + ops)
 *   state/gearbox-proof.json   — SAOS-GEARBOX-PROOF/1 (גיר · סטריק · ראיות-חסרות)
 *
 * חוקים: אפס-המצאות (זרם-ריק = שורת-אפס-כנה) · fail-honest (מקור-שנכשל מדווח
 * בשמו, אף-שורה-לא-מומצאת) · אפס-סודות · יציאה 1 רק-אם-כל-המקורות-נכשלו.
 */
import fs from "fs";
import path from "path";
import {
  parseJsonl, sumCuration, sumFills, sumArb, sumLadder,
  buildGearboxProof, buildYieldRows,
} from "../lib/profit-proof.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."); // repo root (script lives in scripts/)
const STATE = path.join(ROOT, "state");
const ORG = "roshpinacare-sys";
const RAW = (repo, p) => `https://raw.githubusercontent.com/${ORG}/${repo}/main/${p}`;
const TIMEOUT_MS = 25_000;
const MAX_BYTES = 24 * 1024 * 1024; // הגנת-נפח כנה

const SOURCES = [
  { name: "saos-dex:external-profit", repo: "saos-dex", p: "grids/state/external-profit.jsonl" },
  { name: "saos-dex:arb-ledger", repo: "saos-dex", p: "grids/state/arb-ledger.json" },
  { name: "saos-dex:policy-gears", repo: "saos-dex", p: "grids/state/policy-gears.json" },
  { name: "saos-dex:treasury-receipts", repo: "saos-dex", p: "grids/state/treasury-receipts.jsonl" },
  { name: "saos-dex:army-receipts", repo: "saos-dex", p: "grids/state/army-receipts.jsonl" },
  { name: "fleet-economy:snapshot", repo: "fleet-economy", p: "state/snapshot.json" },
];

async function fetchSource(src) {
  const url = RAW(src.repo, src.p);
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "fleet-economy-profit-proof/1" } });
    clearTimeout(timer);
    if (!res.ok) return { ...src, url, http: res.status, bytes: 0, body: null, ms: Date.now() - started, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ...src, url, http: res.status, bytes: buf.byteLength, body: null, ms: Date.now() - started, error: `body ${buf.byteLength}B > cap` };
    return { ...src, url, http: res.status, bytes: buf.byteLength, body: new TextDecoder().decode(buf), ms: Date.now() - started, error: null };
  } catch (e) {
    return { ...src, url, http: 0, bytes: 0, body: null, ms: Date.now() - started, error: String(e?.cause?.code ?? e?.message ?? e).slice(0, 120) };
  }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const at = new Date().toISOString();
const results = await Promise.all(SOURCES.map(fetchSource));
const byName = Object.fromEntries(results.map((r) => [r.name, r]));
const okSources = results.filter((r) => r.body !== null);
if (okSources.length === 0) {
  console.error("[profit-proof] FAIL — כל-המקורות-נכשלו: " + results.map((r) => `${r.name}=${r.error ?? "?"}`).join(" · "));
  process.exit(1);
}

/* ─── ניתוח-נמדד ─── */
const ext = byName["saos-dex:external-profit"];
const arb = byName["saos-dex:arb-ledger"];
const gears = byName["saos-dex:policy-gears"];
const treasury = byName["saos-dex:treasury-receipts"];
const army = byName["saos-dex:army-receipts"];
const snap = byName["fleet-economy:snapshot"];

let extRows = [], extBad = 0, curation = null, fills = null;
if (ext.body) {
  const pr = parseJsonl(ext.body);
  extRows = pr.rows; extBad = pr.bad;
  curation = sumCuration(extRows);
  fills = sumFills(extRows);
}
let arbEntries = [], arbTot = null, arbBad = 0;
if (arb.body) {
  try {
    const j = JSON.parse(arb.body);
    if (Array.isArray(j.entries)) arbEntries = j.entries;
    else arbBad += 1;
  } catch { arbBad += 1; }
  arbTot = sumArb(arbEntries);
}
let gearTable = null, gearsBad = 0;
if (gears.body) {
  try {
    const j = JSON.parse(gears.body);
    if (j && j.protocol === "SAOS-POLICY-GEARS/1") gearTable = j;
    else gearsBad += 1;
  } catch { gearsBad += 1; }
}
let treasuryRows = [], treasuryBad = 0, treasuryTot = null;
if (treasury.body) {
  const pr = parseJsonl(treasury.body);
  treasuryRows = pr.rows; treasuryBad = pr.bad;
  treasuryTot = sumLadder(treasuryRows);
}
let armyRows = [], armyBad = 0, armyTot = null;
if (army.body) {
  const pr = parseJsonl(army.body);
  armyRows = pr.rows; armyBad = pr.bad;
  armyTot = sumLadder(armyRows);
}
let economy = { seq: null, poolFeesUsds: null, poolFeesSaos: null };
if (snap.body) {
  try {
    const s = JSON.parse(snap.body);
    economy = {
      seq: typeof s.seq === "number" ? s.seq : null,
      poolFeesUsds: s.pool && typeof s.pool.feesUsds === "number" ? s.pool.feesUsds : null,
      poolFeesSaos: s.pool && typeof s.pool.feesSaos === "number" ? s.pool.feesSaos : null,
    };
  } catch { /* fail-honest — המדידות נשארות null */ }
}

const gearProof = buildGearboxProof(gearTable, at, RAW("saos-dex", "grids/state/policy-gears.json"));

/* ─── yield-intake rows ─── */
const srcRef = (r) => `raw:${r.repo}/${r.p}`;
const yieldInputs = [];
yieldInputs.push({
  stream: "curation-rewards", at, proofRef: ext.body ? srcRef(ext) : `source-failed:${ext.error ?? "unknown"}`, source: "saos-dex grids/state/external-profit.jsonl (steem-engine curation exports, accrual)",
  measures: curation && curation.count > 0 ? [
    { amount: curation.vests, currency: "VESTS" },
    { amount: curation.steem, currency: "STEEM" },
    { amount: curation.sbd, currency: "SBD" },
    { amount: curation.usd, currency: "USD" },
  ] : [],
});
yieldInputs.push({
  stream: "orderbook-fills", at, proofRef: ext.body ? srcRef(ext) : `source-failed:${ext.error ?? "unknown"}`, source: "saos-dex grids/state/external-profit.jsonl (fill-evidence, opNature=real-tx + trxid)",
  measures: fills && fills.fills > 0 ? [
    { amount: fills.volumeSteem, currency: "STEEM" },
    { amount: fills.volumeSbd, currency: "SBD" },
    { amount: fills.fills, currency: "count" },
    { amount: fills.realTx, currency: "count-real-tx" },
  ] : [],
});
yieldInputs.push({
  stream: "arb-paper-pnl", at, proofRef: arb.body ? srcRef(arb) : `source-failed:${arb.error ?? "unknown"}`, source: "saos-dex grids/state/arb-ledger.json (wallet-scanner arb layer, paperPnlSbd as labeled)",
  measures: arbTot && arbTot.count > 0 ? [{ amount: arbTot.paperPnlSbd, currency: "SBD-paper" }] : [],
});
yieldInputs.push({
  stream: "treasury-ladder-ops", at, proofRef: treasury.body ? srcRef(treasury) : `source-failed:${treasury.error ?? "unknown"}`, source: "saos-dex grids/state/treasury-receipts.jsonl (SAOS-TREASURY-LADDER-RECEIPT/1)",
  measures: treasuryTot && treasuryTot.receipts > 0 ? [
    { amount: treasuryTot.executedTx, currency: "count-executed-tx" },
    { amount: treasuryTot.notionalSbd, currency: "SBD-notional" },
    { amount: treasuryTot.notionalSteem, currency: "STEEM-notional" },
  ] : [],
});
yieldInputs.push({
  stream: "army-ladder-ops", at, proofRef: army.body ? srcRef(army) : `source-failed:${army.error ?? "unknown"}`, source: "saos-dex grids/state/army-receipts.jsonl (SAOS-ARMY-LADDER-RECEIPT/1)",
  measures: armyTot && armyTot.receipts > 0 ? [
    { amount: armyTot.executedTx, currency: "count-executed-tx" },
    { amount: armyTot.notionalSbd, currency: "SBD-notional" },
    { amount: armyTot.notionalSteem, currency: "STEEM-notional" },
  ] : [],
});
yieldInputs.push({
  stream: "amm-pool-fees", at, proofRef: snap.body ? srcRef(snap) : `source-failed:${snap.error ?? "unknown"}`, source: "fleet-economy state/snapshot.json (internal AMM pool fees)",
  measures: economy.poolFeesUsds !== null || economy.poolFeesSaos !== null ? [
    ...(economy.poolFeesUsds !== null ? [{ amount: economy.poolFeesUsds, currency: "USDS" }] : []),
    ...(economy.poolFeesSaos !== null ? [{ amount: economy.poolFeesSaos, currency: "SAOS" }] : []),
  ] : [],
});
const yieldRows = buildYieldRows(yieldInputs);

/* ─── volume counters ─── */
const ladderPub = (t) => t ? {
  receipts: t.receipts, green: t.green, red: t.red, executedTx: t.executedTx, errors: t.errors,
  notionalSbd: Math.round(t.notionalSbd * 1e9) / 1e9, notionalSteem: Math.round(t.notionalSteem * 1e9) / 1e9,
  openOrders: t.openOrders, lastVerdict: t.lastVerdict,
} : { receipts: 0, green: 0, red: 0, executedTx: 0, errors: 0, notionalSbd: 0, notionalSteem: 0, openOrders: null, lastVerdict: null };
const counters = {
  schema: "SAOS-VOLUME-COUNTERS/1",
  generatedAt: at,
  orderbook: fills ? {
    fills: fills.fills, fillsRealTx: fills.realTx,
    volumeSteem: Math.round(fills.volumeSteem * 1e9) / 1e9,
    volumeSbd: Math.round(fills.volumeSbd * 1e9) / 1e9,
    byTrader: fills.byTrader,
  } : { fills: 0, fillsRealTx: 0, volumeSteem: 0, volumeSbd: 0, byTrader: {} },
  ladder: { treasury: ladderPub(treasuryTot), army: ladderPub(armyTot) },
  gearbox: {
    gear: gearProof.gear, greenStreak: gearProof.greenStreak, lastVerdict: gearProof.lastVerdict,
    nextGear: gearProof.nextGear, requireNextGreenStreak: gearProof.requireNextGreenStreak,
    failClosed: gearProof.failClosed,
  },
  economy,
  sources: results.map((r) => ({ name: r.name, url: r.url, http: r.http, bytes: r.bytes, rows: r.name === "saos-dex:external-profit" ? extRows.length : r.name === "saos-dex:treasury-receipts" ? treasuryRows.length : r.name === "saos-dex:army-receipts" ? armyRows.length : r.name === "saos-dex:arb-ledger" ? arbEntries.length : null, bad: r.name === "saos-dex:external-profit" ? extBad : r.name === "saos-dex:arb-ledger" ? arbBad : r.name === "saos-dex:policy-gears" ? gearsBad : r.name === "saos-dex:treasury-receipts" ? treasuryBad : r.name === "saos-dex:army-receipts" ? armyBad : 0 })),
};

/* ─── איטום ─── */
atomicWrite(path.join(STATE, "yield-intake.jsonl"), yieldRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
atomicWrite(path.join(STATE, "volume-counters.json"), JSON.stringify(counters, null, 1) + "\n");
atomicWrite(path.join(STATE, "gearbox-proof.json"), JSON.stringify(gearProof, null, 1) + "\n");

console.log(`[profit-proof] נמדד ${at}`);
for (const r of results) console.log(`  ${r.http === 200 && r.body !== null ? "OK  " : "FAIL"} ${r.name} http=${r.http} bytes=${r.bytes} ${r.error ?? ""}`);
console.log(`[yield] שורות: ${yieldRows.length} → state/yield-intake.jsonl`);
for (const r of yieldRows) console.log(`  ${r.stream} · ${r.amount} ${r.currency}`);
console.log(`[counters] fills=${counters.orderbook.fills} volSTEEM=${counters.orderbook.volumeSteem} volSBD=${counters.orderbook.volumeSbd} · treasury tx=${counters.ladder.treasury.executedTx} notional=${counters.ladder.treasury.notionalSbd}SBD · army tx=${counters.ladder.army.executedTx} notional=${counters.ladder.army.notionalSbd}SBD`);
console.log(`[gearbox] gear=${gearProof.gear} greenStreak=${gearProof.greenStreak} last=${gearProof.lastVerdict ?? "-"} next=${gearProof.nextGear ?? "-"} (needs ${gearProof.requireNextGreenStreak ?? "-"})${gearProof.crossChecks.length ? " · cross-checks: " + gearProof.crossChecks.join(" | ") : ""}`);
process.exit(0);
