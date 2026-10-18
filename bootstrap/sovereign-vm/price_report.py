#!/usr/bin/env python3
"""price_report.py — כלי-ארסנל ריבוני (גל-96 · agent-2)
דוח-בריכה-ואוצר מתוך state/snapshot.json · קריאה-בלבד · stdlib-טהור.
מחיר-מחושב-מהאמת: pool.usds/pool.saos (בדיוק-כמו-הלב).
פלט-מכונה: ok=True seq=N price=P fees=F treasuryUsds=U.
הבנאי-הריבוני רשאי להריץ כלי-זה דרך white-list (tool-run · tool=price_report).
"""
import json
import sys


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "state/snapshot.json"
    try:
        with open(path, encoding="utf-8") as f:
            s = json.load(f)
        seq = s.get("seq")
        pool = s.get("pool") if isinstance(s.get("pool"), dict) else {}
        usds = pool.get("usds")
        saos = pool.get("saos")
        fees = pool.get("feesUsds")
        tr = s.get("balances", {}).get("treasury", {}) if isinstance(s.get("balances"), dict) else {}
        tusds = tr.get("usds")
        parts = ["ok=True"]
        if isinstance(seq, int):
            parts.append(f"seq={seq}")
        if isinstance(usds, (int, float)) and isinstance(saos, (int, float)) and saos > 0:
            parts.append(f"price={round(usds / saos, 6)}")
        if isinstance(fees, (int, float)):
            parts.append(f"fees={fees}")
        if isinstance(tusds, (int, float)):
            parts.append(f"treasuryUsds={tusds}")
        print(" ".join(parts))
        return 0
    except FileNotFoundError:
        print("ok=False err=snapshot-missing")
        return 1
    except Exception as e:  # fail-honest
        print(f"ok=False err={type(e).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
