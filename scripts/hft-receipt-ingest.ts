/* ═══ hft-receipt-ingest · E7 · hft-loop receipts → fleet-economy ledger bridge ═══
 * Scans hft-loop state receipt files (hash-chained {seq,at,phase,decisions,ops[],...}),
 * for every line with non-empty ops[] emits a real /tx/ingest swap into the :3016 ledger.
 * REAL receipt-line fields (measured 2026-10-26, hft-receipts.jsonl):
 *   {seq, at, phase, decisions[], ops[], emitted, denied, prevHash, hash}
 *   — NO issuer field on the line → issuer derived from file path (per-soldier dir name,
 *     top-level file = "hft-loop"). ops[] are currently zero everywhere (honest zeros).
 * Loopback-only ingest → {ok,dedup,seq,h}. Ref idempotent: hft-<issuer>-<seq>-<i>. */
import fs from "fs";
import path from "path";

const ROOT = "/home/z/saos-dex/mini-services/hft-loop/state";
const INGEST = "http://127.0.0.1:3016/tx/ingest";

function receiptFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl") && !e.name.includes(".bak")) out.push(p);
    }
  };
  walk(ROOT);
  return out;
}

function issuerOf(file: string): string {
  const rel = path.relative(ROOT, path.dirname(file));
  return !rel || rel === "." ? "hft-loop" : rel.split(path.sep)[0];
}

let scanned = 0, withOps = 0, ingested = 0, deduped = 0, errors = 0, badLines = 0;

async function ingest(issuer: string, seq: number, i: number, op: any): Promise<void> {
  // notional in µ$ (1e-6) — honest zero if the op carries no measurable notional
  const notional = Number(op?.notional ?? (op?.size != null && op?.price != null ? Number(op.size) * Number(op.price) : 0));
  const amount = Math.round(notional / 1e6 * 1e6) / 1e6;
  if (!(amount > 0)) return; // zero-notional op — nothing lawful to ledger
  const body = { kind: "swap", from: issuer, to: "dex-book", asset: "USDS", amount, reason: "hft-grid", ref: `hft-${issuer}-${seq}-${i}` };
  try {
    const res = await fetch(INGEST, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.ok) { j.dedup ? deduped++ : ingested++; }
    else { errors++; console.error(`ingest-fail ${body.ref} → ${res.status} ${JSON.stringify(j).slice(0, 200)}`); }
  } catch (e: any) {
    errors++; console.error(`ingest-error ${body.ref}: ${e?.message ?? e}`);
  }
}

for (const file of receiptFiles()) {
  const issuer = issuerOf(file);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(l => l.trim());
  for (const line of lines) {
    scanned++;
    let rec: any;
    try { rec = JSON.parse(line); } catch { badLines++; continue; }
    const ops = Array.isArray(rec?.ops) ? rec.ops : [];
    if (!ops.length) continue;
    withOps++;
    for (let i = 0; i < ops.length; i++) await ingest(issuer, rec.seq, i, ops[i]);
  }
}

const out = { scanned, withOps, ingested, deduped, errors, badLines, files: receiptFiles().length };
console.log(JSON.stringify(out));
