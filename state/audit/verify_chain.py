#!/usr/bin/env python3
# verify_chain.py — standalone fleet-economy ledger verifier · [agent:Z2] · 2026-10-17
# Re-creates the writer's hash: sha256(JSON.stringify({...rec-minus-h, prev: chainPrev}))[:32]
# Genesis prev = "GENESIS" (index.ts:462). Byte-exact compact JSON, UTF-8 raw.
# Usage: python3 verify_chain.py [path/to/ledger.jsonl]   (default: state/ledger.jsonl)
# Output: JSON to stdout — segments, seams, seq-gaps, snapshot agreement fields.
import json, hashlib, sys

def h32(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()[:32]

def verify(path):
    prev = 'GENESIS'
    checked = 0
    seam_records = []
    seg_start = 1
    seq_last = None
    dups = 0
    seq_seen = set()
    with open(path, encoding='utf-8') as f:
        for ln, line in enumerate(f, 1):
            s = line.strip()
            if not s:
                continue
            try:
                rec = json.loads(s)
            except Exception as e:
                seam_records.append(dict(seq=None, file_line=ln, kind='UNPARSEABLE', err=str(e)[:80]))
                continue
            seq = rec.get('seq')
            h = rec.get('h')
            if seq in seq_seen:
                dups += 1
            seq_seen.add(seq)
            rest = {k: v for k, v in rec.items() if k != 'h'}
            rest['prev'] = prev
            body = json.dumps(rest, separators=(',', ':'), ensure_ascii=False)
            ok = (h32(body) == h)
            if not ok:
                seam_records.append(dict(seq=seq, file_line=ln, ts=rec.get('ts'), kind=rec.get('kind'),
                                         stored_h=h, expected_prev=prev))
                prev = h
                seq_last = seq
                continue
            checked += 1
            prev = h
            seq_last = seq
    return dict(file=path, total_records=checked + len(seam_records),
                hash_verified=checked, seams=seam_records, dup_seqs=dups, seq_max=seq_last)

if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'state/ledger.jsonl'
    r = verify(path)
    n = r['total_records']
    v = r['hash_verified']
    r['verified_pct'] = round(100.0 * v / n, 4) if n else 0.0
    r['okAll'] = (len(r['seams']) == 0 and r['dup_seqs'] == 0)
    print(json.dumps(r, ensure_ascii=False, indent=1))
