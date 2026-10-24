#!/usr/bin/env python3
# verify_signatures.py — מאמת-קבלות-חתומות · stdlib של Python 3.12 בלבד · [sovereign-lane]
# directive §3 (signed audit receipts) · wave 19.80 (trace 1a1697622e3a2ea5) · 2026-10-23
#
# מאמת שרשרת-קבלות {seq, h, s, p, alg} שנוצרה ע"י lib/receipt-sign.ts:
#   s_i = HMAC-SHA256(key, f"{seq}:{h_i}:{p_i}")[:32-hex] · p_0 = GENESIS-SIG
#
# fail-closed: מפתח-חסר/ריק → יציאה עם-שגיאה-קולנית (קוד 2). אין-אימות-שקט.
# custody: המפתח מגיע מהסביבה FLEET_RECEIPT_KEY — אף-פעם לא בריפו, לא בקוד.
#
# שימוש:
#   python3 verify_signatures.py <receipts.json> [--ledger state/ledger.jsonl]
#   receipts.json = {"genesis": "GENESIS-SIG", "alg": "HMAC-SHA256",
#                    "receipts": [{"seq", "h", "s", "p", "alg"}, ...]}
#   --ledger מצליב כל-קבלה מול-h של-הספר-החי (מגלה שכתוב-מלא-עם-עוגן-פנימי)
# פלט: JSON ל-stdout — ok / checked / seams / headSig. קוד-יציאה 0 אם-ok אחרת 1.
import hashlib
import hmac
import json
import os
import sys

GENESIS_SIG = "GENESIS-SIG"
ALG = "HMAC-SHA256"
SIG_LEN = 32  # hex-32 — אותו-קצב כמו h32 של verify_chain.py


def step(seq, h, prev_sig, key):
    msg = f"{seq}:{h}:{prev_sig}".encode("utf-8")
    return hmac.new(key.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:SIG_LEN]


def require_key():
    k = os.environ.get("FLEET_RECEIPT_KEY", "")
    if not isinstance(k, str) or k.strip() == "":
        print(json.dumps({
            "ok": False,
            "error": "receipt-sign fail-closed: FLEET_RECEIPT_KEY לא-נקבע בסביבה — "
                     "אימות-קבלות מושהה עד-אספקת-מפתח (custody של-הבעלים)",
        }, ensure_ascii=False))
        sys.exit(2)
    return k


def load_ledger(path):
    """seq → h מתוך הספר-החי (הצלבה-נגד-שכתוב-מלא)"""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            rec = json.loads(s)
            out[rec["seq"]] = rec["h"]
    return out


def verify(receipts, key, ledger_by_seq=None, expected_root=GENESIS_SIG):
    seams = []
    checked = 0
    prev = None
    for r in receipts:
        if not isinstance(r, dict) or not all(
            isinstance(r.get(k), (int, str)) for k in ("seq", "h", "s", "p")
        ) or r.get("alg") != ALG:
            seams.append({"seq": r.get("seq") if isinstance(r, dict) else None,
                          "kind": "MALFORMED"})
            prev = None
            continue
        if prev is not None and r["seq"] <= prev["seq"]:
            seams.append({"seq": r["seq"], "kind": "SEQ-ORDER",
                          "detail": f"seq {r['seq']} !> {prev['seq']}"})
        expected_p = expected_root if prev is None else prev["s"]
        if r["p"] != expected_p:
            seams.append({"seq": r["seq"], "kind": "CHAIN-BREAK",
                          "detail": f"p={r['p'][:8]} expected={expected_p[:8]}"})
        expect_s = step(r["seq"], r["h"], r["p"], key)
        if r["s"] != expect_s:
            seams.append({"seq": r["seq"], "kind": "SIG-MISMATCH",
                          "detail": f"s={r['s'][:8]} expected={expect_s[:8]}"})
        else:
            checked += 1
        if ledger_by_seq is not None:
            live_h = ledger_by_seq.get(r["seq"])
            if live_h is None:
                seams.append({"seq": r["seq"], "kind": "LEDGER-MISMATCH",
                              "detail": "seq לא-קיים בספר-החי"})
            elif live_h != r["h"]:
                seams.append({"seq": r["seq"], "kind": "LEDGER-MISMATCH",
                              "detail": f"h={r['h'][:8]} ספר={live_h[:8]}"})
        prev = r
    head_sig = receipts[-1]["s"] if receipts else expected_root
    return {"ok": len(seams) == 0, "checked": checked, "seams": seams, "headSig": head_sig}


def main():
    if len(sys.argv) < 2:
        print("usage: verify_signatures.py <receipts.json> [--ledger state/ledger.jsonl]",
              file=sys.stderr)
        sys.exit(2)
    key = require_key()
    with open(sys.argv[1], encoding="utf-8") as f:
        doc = json.load(f)
    ledger = None
    if "--ledger" in sys.argv:
        ledger = load_ledger(sys.argv[sys.argv.index("--ledger") + 1])
    root = doc.get("genesis", GENESIS_SIG)
    if doc.get("alg", ALG) != ALG:
        print(json.dumps({"ok": False, "error": f"alg לא-נתמך: {doc.get('alg')}"},
                         ensure_ascii=False))
        sys.exit(2)
    res = verify(doc.get("receipts", []), key, ledger, root)
    res["file"] = sys.argv[1]
    res["ledgerCrossCheck"] = ledger is not None
    res["count"] = len(doc.get("receipts", []))
    print(json.dumps(res, ensure_ascii=False, indent=1))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
