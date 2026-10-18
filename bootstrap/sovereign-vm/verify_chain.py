#!/usr/bin/env python3
"""
verify_chain.py — מאמת-שרשרת בלתי-תלוי (Python טהור, אפס-תלות) · גל-91 · agent-2
עקרון: אמת עצמאית = שני-מימושים. המנוע (TS/bun) מאמת ב-boot וב-seal; מאמת זה מאמת
מחדש מהקבצים הגולמיים במימוש-נפרד לחלוטין — הסכמה בין-שניהם = פורנזיה צולבת.

חוק-החתימה (index.ts sealTx): body = JSON.stringify({...t, prev: lastH})
                              h = sha256(body).hex[:32]
השורה השמורה = JSON.stringify({...t, h}) — JSON-קומפקטי, סדר-מפתחות-יציב, h בסוף.
body_i = raw_i − זנב-"h" + ,"prev":"<h_{i-1}>}"  (בלי h כלל)

חוק-העוגנים (מדויק לפי verifyChain ב-index.ts): prev-גנזיס = "GENESIS";
תפר = שורה ש-h המחושב אינו-תואם → עוגן: השרשרת נמשכת מה-h השמור, השורה-הבאה חייבת
להתגבש (עוגנים-עוקבים = שבר-אמת), הספר אינו-רשאי להיגמר-על-עוגן.
חוק-seq: עולה-ממש (קפיצות-עוגן חוקיות; נסיגה/כפילות = שבר).
עוגנים-מותרים: {46335, 55120, 68276} בלבד (בסיס-3).
שימוש: python3 verify_chain.py [נתיב-state]
יציאה: 0 = ירוק · 1 = פסק-דין אדום
"""
import hashlib, json, sys
from pathlib import Path

ANCHOR_BASELINE = {46335, 55120, 68276}
H_SUFFIX_LEN = 5 + 32 + 2  # "h":" (5) + 32 תווי-hash + "}


def split_h(raw: str):
    """מפריד (head_עד_h, h) מהסוף — בטוח גם אם reason מכיל ,"h":"."""
    if len(raw) < H_SUFFIX_LEN or not raw.endswith('"}'):
        raise ValueError("שורה-פסולה — זנב-JSON חסר")
    tail = raw[-H_SUFFIX_LEN:]
    if not tail.startswith('"h":"'):
        raise ValueError("שורה בלי h בסוף — פסולה (חוק-פורמט)")
    return raw[:-H_SUFFIX_LEN], tail[5:-2]


def verify(state_dir: Path):
    ledger = state_dir / "ledger.jsonl"
    lines = ledger.read_text(encoding="utf-8").splitlines()
    if not lines:
        return {"ok": False, "why": "ledger ריק"}

    prev_h = "GENESIS"    # גנזיס: חוק-המנוע (index.ts:93 lastH="GENESIS")
    seams, first_seq, last_h, last_seq = [], None, None, None
    checked = 0
    seq_ok, prev_seq, prev_was_anchor = True, None, False
    for raw in lines:
        head, stored = split_h(raw)
        body = head + f'"prev":"{prev_h}"' + "}"
        calc = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
        seq = json.loads(raw)["seq"]
        if first_seq is None:
            first_seq = seq
        if prev_seq is not None and seq <= prev_seq:
            seq_ok = False  # נסיגה/כפילות = שבר-מבנה (חוק Z2-15)
        prev_seq = seq
        if calc != stored:
            if prev_was_anchor:
                seq_ok = False  # עוגנים-עוקבים — שבר-אמת (חוק-התגבשות)
            seams.append(seq)  # עוגן-תפר: המשך מה-h השמור
            prev_h = stored
            prev_was_anchor = True
        else:
            checked += 1
            prev_h = stored
            prev_was_anchor = False
        last_h, last_seq = stored, seq
    if prev_was_anchor:
        seq_ok = False  # זנב-בלתי-מעוגן — שבר-אמת (חוק Z2-15)

    anchors_ok = set(seams) == ANCHOR_BASELINE and len(seams) == 3
    snap = json.loads((state_dir / "snapshot.json").read_text())
    snap_ok = True if snap["seq"] != last_seq else (snap["lastH"] == last_h)
    return {
        "ok": anchors_ok and seq_ok and snap_ok,
        "lines": len(lines),
        "checked": checked,
        "first_seq": first_seq,
        "last_seq": last_seq,
        "last_h16": last_h[:16],
        "seams": seams,
        "anchors_ok": anchors_ok,
        "seq_ok": seq_ok,
        "snap_ok": snap_ok,
        "snap_seq": snap["seq"],
    }


if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    default = here.parents[1] / "state"   # bootstrap/sovereign-vm/ → ../../state
    sd = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    r = verify(sd)
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["ok"] else 1)
