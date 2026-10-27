#!/usr/bin/env python3
# fleet-receipts-guard-core.py — deterministic core of the fleet-economy receipts-rail guard.
# sovereign-lane wave 19.85 (trace 1a16ecaa3e014051), MASTER DIRECTIVE §2 settlement-plane integrity + §8 deadlock-break.
# G78-f extension (trace 1a178c595ee6edd5 lineage): the storm EVOLVED a second swallow class.
#
# Measured class 1 (wave 19.81): `vault-sync -s ours` merges ERASE rail paths (absent sha).
# Measured class 2 (G78-f, 2026-10-27T12:xxZ): the storm re-lands rail paths as base64 CORPSES —
#   the file exists (sha present) but the content is DEAD: tests/receipt-sign.test.ts became a
#   truncated base64 blob (bun: "Unexpected end of file"), lib/receipt-sign.ts became base64,
#   scripts/fleet-receipts-guard-core.py became base64. A corpse is not evolution: content-diff
#   with a measured DEAD shape is a SWALLOW (rescuable), never a silent alert.
#
# Laws:
#   - absence of a canonical path = swallow (rescue)
#   - content-diff with shape="wound" (measured dead corpus: wrong magic for its kind) = swallow (rescue)
#   - content-diff with shape="ok"/absent = alert-only (NEVER fight live evolution — backward compatible)
#   - rescue only from adopted blobs — the guard invents nothing (fail-closed)
#   - receipts are sha256 hash-linked (prevHash→hash); tamper is detectable
# stdlib only. No network. No clock in detect() (clock injected by the loop).
import hashlib, json

CANONICAL_RAIL = (
    "lib/receipt-sign.ts",
    "tests/receipt-sign.test.ts",
    "state/audit/verify_signatures.py",
    "state/audit/receipt-2026-10-23-wave1980.json",
)


def shape_of(path, head):
    """Classify a file head (first bytes, decoded utf-8 with errors='replace').

    Returns "ok" | "wound" | "unknown". A rail file is ALIVE only if it starts with the
    magic its kind requires: .ts → "/*" or "//"; .py → "#"; .json → "{" or "[".
    base64 corpses start with base64 alphabet letters ("Lyog", "IyE", "ew", …) — dead.
    """
    h = (head or "").lstrip()
    if path.endswith(".py"):
        return "ok" if h.startswith("#") else "wound"
    if path.endswith(".json"):
        return "ok" if h[:1] in ("{", "[") else "wound"
    if path.endswith(".ts"):
        return "ok" if h.startswith("/*") or h.startswith("//") else "wound"
    return "unknown"


def detect(tree, adopted, shape=None):
    """tree: {path: blob_sha_or_emptystring}; adopted: {path: blob_sha};
    shape: optional {path: "ok"|"wound"|"unknown"} measured by the loop.

    Returns {swallows, alerts, plan, planError}.
    - swallow: path absent OR content-diff with measured dead shape → rescue candidate.
    - alert: content drift with live/unknown shape — NEVER rescued.
    - planError: non-None when a swallow has no adopted source (fail-closed, empty plan).
    """
    swallows, alerts = [], []
    shape = shape or {}
    for p in CANONICAL_RAIL:
        sha = tree.get(p)
        if not sha:
            swallows.append(p)
        elif p in adopted and adopted[p] == sha:
            pass  # intact — byte-identical to the adopted blob
        elif shape.get(p) == "wound":
            swallows.append(p)  # corpse: dead corpus (measured magic mismatch) — not evolution,
            # adopted-tracked or not; rescue still requires an adopted blob (fail-closed below)
        elif p in adopted and adopted[p] != sha:
            alerts.append(p)
    plan, plan_error = [], None
    for p in swallows:
        if not adopted.get(p):
            plan_error = (
                "no adopted blob for %s — guard invents nothing (fail-closed)" % p
            )
            plan = []
            break
        plan.append({"path": p, "from": "blob:" + adopted[p]})
    return {"swallows": swallows, "alerts": alerts, "plan": plan, "planError": plan_error}


def _canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_receipt(prev, at, payload):
    """Hash-linked receipt: hash = sha256(canon({mode,at,prevHash,payload}))."""
    body = {
        "mode": "receipt",
        "at": at,
        "prevHash": prev,
        "payload": payload,
    }
    body["hash"] = hashlib.sha256(_canon(body).encode("utf-8")).hexdigest()
    return body


def verify_chain(receipts):
    """Returns (ok, first_bad_index|None). Tampered payload or broken prev link → not ok."""
    prev = None
    for i, r in enumerate(receipts):
        expected = {
            "mode": r.get("mode"),
            "at": r.get("at"),
            "prevHash": r.get("prevHash"),
            "payload": r.get("payload"),
        }
        if r.get("prevHash") != prev:
            return False, i
        h = hashlib.sha256(_canon(expected).encode("utf-8")).hexdigest()
        if h != r.get("hash"):
            return False, i
        prev = r.get("hash")
    return True, None


if __name__ == "__main__":
    # CLI: `plan` — read {"tree":{...},"adopted":{...},"shape":{...}?} on stdin, emit detect() JSON.
    import sys

    data = json.load(sys.stdin)
    print(_canon(detect(data["tree"], data["adopted"], data.get("shape"))))
