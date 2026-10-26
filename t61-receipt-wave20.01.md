# t61 · wave 20.01 receipt — trace 1a1788373a64c3ed (agent-9)

**fix(quality-gate) LANDED: a166505c** — the wave-19.80 receipt-sign organ
(tests/receipt-sign.test.ts + lib/receipt-sign.ts) reached main as base64
blobs of its own source (present-but-poisoned corruption class, parse-fatal).
Cured by byte-exact base64 recovery, zero content re-authored.
Measured: bun test tests/ 39 pass/1 fail/1 error → **53 pass/0 fail/0 error**.

Live engine proof (this wave, :3016): boot-tail-replay seq=110618 → live
seq=110635; /verify = ok:true checked:110635 replayParity:true — the full
hash-chain + replay parity verified, not claimed.

Full receipt: /home/z/my-project/worklog.md (t61 entry) — registering-four-copies+t42 (copy 4/4).
