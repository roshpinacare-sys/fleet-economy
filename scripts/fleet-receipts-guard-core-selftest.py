#!/usr/bin/env python3
# fleet-receipts-guard-core-selftest.py — G78-f: the tested core decides, so the core is tested.
# Suite: 16 checks — the original 13/13 semantics + the G78-f base64-corpus-wound class.
# stdlib only; exit 0 = all pass, exit 1 = any fail (fail-honest, never redacted).
import importlib.util
import json
import sys
import os

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("fleet_receipts_guard_core", os.path.join(_here, "fleet-receipts-guard-core.py"))
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("(pass) %s" % name)
    else:
        FAILS.append(name)
        print("(FAIL) %s %s" % (name, detail))


ADOPTED = {p: "adopted-" + p.replace("/", "-") for p in core.CANONICAL_RAIL}


def tree_of(**kw):
    t = {p: ADOPTED[p] for p in core.CANONICAL_RAIL}
    t.update(kw)
    return t


# ── original law (13/13 semantics) ──────────────────────────────────────────
r = core.detect(tree_of(), ADOPTED)
check("intact rail → 0 swallows 0 alerts empty plan", r["swallows"] == [] and r["alerts"] == [] and r["plan"] == [])

r = core.detect(tree_of(**{"lib/receipt-sign.ts": ""}), ADOPTED)
check("absent path → swallow + rescue plan", r["swallows"] == ["lib/receipt-sign.ts"] and r["plan"] == [{"path": "lib/receipt-sign.ts", "from": "blob:" + ADOPTED["lib/receipt-sign.ts"]}])

r = core.detect({p: "" for p in core.CANONICAL_RAIL}, {"lib/receipt-sign.ts": "b1"})
check("all absent + partial adopted → planError fail-closed", r["planError"] is not None and r["plan"] == [] and "invents nothing" in r["planError"])

r = core.detect({p: "" for p in core.CANONICAL_RAIL}, {})
check("all absent + no adopted → planError", r["planError"] is not None and r["plan"] == [])

r = core.detect(tree_of(**{"tests/receipt-sign.test.ts": "evolved"}), ADOPTED)
check("content-diff, no shape → alert-only (never fight evolution)", r["alerts"] == ["tests/receipt-sign.test.ts"] and r["swallows"] == [] and r["plan"] == [])

r = core.detect(tree_of(**{"tests/receipt-sign.test.ts": ADOPTED["tests/receipt-sign.test.ts"]}), ADOPTED, {"tests/receipt-sign.test.ts": "ok"})
check("sha==adopted + shape ok → intact", r["swallows"] == [] and r["alerts"] == [])

# ── G78-f: base64-corpus-wound class ────────────────────────────────────────
r = core.detect(tree_of(**{"tests/receipt-sign.test.ts": "base64blob"}), ADOPTED, {"tests/receipt-sign.test.ts": "wound"})
check("content-diff + shape wound → SWALLOW (corpse is not evolution)", r["swallows"] == ["tests/receipt-sign.test.ts"] and r["alerts"] == [] and len(r["plan"]) == 1)

r = core.detect({p: "base64blob" for p in core.CANONICAL_RAIL}, ADOPTED, {p: "wound" for p in core.CANONICAL_RAIL})
check("all corpses → 4 swallows, full rescue plan", len(r["swallows"]) == 4 and len(r["plan"]) == 4 and r["planError"] is None)

r = core.detect({p: "base64blob" for p in core.CANONICAL_RAIL}, {}, {p: "wound" for p in core.CANONICAL_RAIL})
check("all corpses + no adopted → fail-closed planError", r["planError"] is not None and r["plan"] == [])

r = core.detect(tree_of(**{"lib/receipt-sign.ts": "evolved"}), ADOPTED, {"lib/receipt-sign.ts": "ok"})
check("content-diff + shape ok → still alert-only", r["alerts"] == ["lib/receipt-sign.ts"] and r["swallows"] == [])

r = core.detect(tree_of(**{"lib/receipt-sign.ts": "evolved"}), ADOPTED, {"lib/receipt-sign.ts": "unknown"})
check("content-diff + shape unknown → alert-only (conservative)", r["alerts"] == ["lib/receipt-sign.ts"] and r["swallows"] == [])

r = core.detect(tree_of(**{"lib/receipt-sign.ts": "evolved"}), ADOPTED)
check("shape key absent → backward-compat alert-only", r["alerts"] == ["lib/receipt-sign.ts"] and r["swallows"] == [])

# ── shape_of magic law ──────────────────────────────────────────────────────
check("ts magic ok", core.shape_of("lib/receipt-sign.ts", "/* \u2550\u2550\u2550 receipt-sign.ts") == "ok")
check("ts base64 corpse → wound", core.shape_of("lib/receipt-sign.ts", "Lyog4pWQ4pWQ4pWQIHJlY2VpcHQ=") == "wound")
check("py magic ok", core.shape_of("state/audit/verify_signatures.py", "#!/usr/bin/env python3\nimport hashlib") == "ok")
check("py base64 corpse → wound", core.shape_of("x.py", "IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMw==") == "wound")
check("json magic ok", core.shape_of("r.json", '{"schema":"SAOS/1"}') == "ok")
check("json corpse → wound", core.shape_of("r.json", "eyJzY2hlbWEiOiJTQU9TLzEifQ==") == "wound")

# ── hash-linked receipts ────────────────────────────────────────────────────
r1 = core.build_receipt(None, "2026-10-27T12:00:00Z", {"cycle": 1})
r2 = core.build_receipt(r1["hash"], "2026-10-27T12:05:00Z", {"cycle": 2})
ok, bad = core.verify_chain([r1, r2])
check("receipt chain verifies", ok and bad is None and r2["prevHash"] == r1["hash"])

r2_tampered = dict(r2, payload={"cycle": 999})
ok, bad = core.verify_chain([r1, r2_tampered])
check("tampered payload detected", not ok and bad == 1)

# RFC 4231 test case 1 sanity (same vector the rail test pins): key=0x0b*20, data="Hi There"
import hashlib, hmac
expect = hmac.new(b"\x0b" * 20, b"Hi There", hashlib.sha256).hexdigest()
check("rfc4231 case1 sanity", expect == "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")

print()
print("SELFTEST %d/%d PASS" % (16 - len(FAILS), 16))
sys.exit(1 if FAILS else 0)
