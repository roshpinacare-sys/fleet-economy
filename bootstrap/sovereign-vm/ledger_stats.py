#!/usr/bin/env python3
"""ledger_stats.py — כלי-ארסנל ריבוני (גל-96 · agent-2)
סטטיסטיקת-פנקס בקריאה-בלבד · stdlib-טהור · אפס-רשת · אפס-כתיבה.
פלט-מכונה: ok=True checked=N seqFirst=A seqLast=B + היסטוגרמת-סוגים.
הבנאי-הריבוני רשאי להריץ כלי-זה דרך white-list (tool-run · tool=ledger_stats).
"""
import collections
import json
import sys


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "state/ledger.jsonl"
    kinds: "collections.Counter[str]" = collections.Counter()
    n = 0
    first: int | None = None
    last: int | None = None
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                n += 1
                kinds[str(e.get("kind", "?"))[:32]] += 1
                s = e.get("seq")
                if isinstance(s, int):
                    first = s if first is None else min(first, s)
                    last = s if last is None else max(last, s)
        top = " ".join(f"{k}={v}" for k, v in kinds.most_common(6))
        print(f"ok=True checked={n} seqFirst={first} seqLast={last}")
        if top:
            print(f"kinds[{top}]")
        return 0
    except FileNotFoundError:
        print("ok=False err=ledger-missing")
        return 1
    except Exception as e:  # fail-honest
        print(f"ok=False err={type(e).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
