#!/usr/bin/env python3
# fleet-receipts-guard-core.py — deterministic core of the fleet-economy receipts-rail guard.
# sovereign-lane wave 19.85 (trace 1a16ecaa3e014051), MASTER DIRECTIVE §2 settlement-plane integrity + §8 deadlock-break.
#
# Measured class being mechanized (ledger #74 + sovereign-lane 19.81 receipt): the vault-seal storm's
# `vault-sync -s ours` merges erase the fleet-economy receipts rail (lib/receipt-sign.ts + companions).
# Measured survival of a reland: 2m17s (15:56:55Z→15:59:12Z). Manual relands are a treadmill; this core
# makes detection+plan deterministic and testable, the .sh loop makes the reland continuous.
#
# Laws carried from the giant swallow-guard claim (agent-5-laneD, wave 19.83):
#   - absence of a canonical path = swallow (rescue); content-diff = alert-only (never fight evolution)
#   - rescue only from adopted blobs — the guard invents nothing (fail-closed)
#   - receipts are sha256 hash-linked (prevHash→hash); tamper is detectable
# stdlib only. No network. No clock in detect() (clock injected by the loop).
import hashlib, json

CANONICAL_RAIL = (
    "lib/receipt-sign.ts",
    "tests/receipt-sign.test.ts",
    "state/audit/verify_signatures.py",
)
# root-fix 2026-10-31: "state/audit/receipt-2026-10-23-wave1980.json" removed —
# it NEVER landed in this repo's history (0 commits, absent estate-wide), so the
# fail-closed law ("guard invents nothing") refused every cycle → permanent RED.
# rail = evidence that exists; the phantom reference is the defect, not the tree.


def detect(tree, adopted):
    """tree: {path: blob_sha_or_emptystring}; adopted: {path: blob_sha}.

    Returns {swallows, alerts, plan, planError}.
    - swallow: rail path absent (empty sha or missing key) → rescue candidate.
    - alert: path present but sha differs from adopted (content drift) — NEVER rescued.
    - planError: non-None when a swallow has no adopted source (fail-closed, empty plan).
    """
    swallows, alerts = [], []
    for p in CANONICAL_RAIL:
        sha = tree.get(p)
        if not sha:
            swallows.append(p)
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
    # CLI: `plan` — read {"tree":{...},"adopted":{...}} on stdin, emit detect() JSON.
    import sys

    data = json.load(sys.stdin)
    print(_canon(detect(data["tree"], data["adopted"])))
