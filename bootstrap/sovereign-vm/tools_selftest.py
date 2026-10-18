#!/usr/bin/env python3
"""tools_selftest.py — כלי-הוכחת-השימוש-הריבוני (גל-97 · agent-2)
מריץ את כל-ארסנל-הכלים-הרשומים ב-TOOLS.md קצה-לקצה ומדפיס מטריצת-שימוש.
מנדט-הבעלים (גל-91): *האוטונומיה חייבת לדעת להשתמש בכלים — לא רק להחזיק אותם.*
קריאה-בלבד · stdlib-טהור · אפס-רשת · אפס-כתיבה-בספר.
פלט-מכונה: ok=True tools=3 used=3 matrix[tool:ok=...] — ok=True אם-ורק-אם-כל-הכלים ok.
"""
import json
import os
import subprocess
import sys

# הארסנל-הרשומי — חייב-להיות-מתואם 1:1 עם TOOLS.md (שלשה-קנונית)
VM_DIR = os.path.dirname(os.path.abspath(__file__))
ARSENAL = [
    ("verify_chain", "verify_chain.py"),
    ("ledger_stats", "ledger_stats.py"),
    ("price_report", "price_report.py"),
]


def find_target(argv: list[str]) -> tuple[str | None, str | None]:
    """נתיבי-מטרה מתוך-המארח-בלבד: פנקס ו-snapshot של העותק-החי."""
    # כברירת-מחדל: יחסי לשורש-העותק-החי (ההורה של bootstrap/)
    root = os.path.dirname(os.path.dirname(VM_DIR))
    ledger = os.path.join(root, "state", "ledger.jsonl")
    snapshot = os.path.join(root, "state", "snapshot.json")
    # אם-הועבר-ארגומנט-יחיד — זה-פנקס-עוקף (תאימות-לאחר)
    if len(argv) > 1:
        ledger = argv[1]
    return ledger, snapshot


def main() -> int:
    ledger, snapshot = find_target(sys.argv)
    used = 0
    rows: list[str] = []
    details: list[str] = []
    for name, script in ARSENAL:
        script_path = os.path.join(VM_DIR, script)
        try:
            args = [sys.executable, script_path]
            args.append(ledger if name != "price_report" else (snapshot or ledger))
            out = subprocess.run(
                args, capture_output=True, text=True, timeout=120, check=False
            )
            first = (out.stdout.strip().split("\n")[0] if out.stdout.strip() else "")
            # גל-96-שיעור: ok=True ≠ ok=true — חסינות-רישיות חובה (ושיעור-גל-97: אני
            # נפלתי-בזה-בעצמי בריצה-הראשונה; הקנון-הציל)
            ok = "ok=true" in first.lower()
            if ok:
                used += 1
            rows.append(f"{name}:{'ok' if ok else 'fail'}")
            details.append(first[:120])
        except Exception as e:  # fail-honest
            rows.append(f"{name}:fail")
            details.append(f"{name} err={type(e).__name__}")
    ok_all = used == len(ARSENAL)
    print(f"ok={'True' if ok_all else 'False'} tools={len(ARSENAL)} used={used}")
    print("matrix[" + " ".join(rows) + "]")
    for d in details:
        print(f"selftest {d}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
