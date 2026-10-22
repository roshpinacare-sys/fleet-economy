#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_chain.py — אימות-שרשרת-פנקס בלתי-תלוי (גל-91 · agent-2 · נבנה-מחדש גל-95)
═══════════════════════════════════════════════════════════════════════════════
אמת-מדידה עצמאית: פייתון-טהור, ללא-תלות-במנוע-ה-JS. שכפול-מילה-במילה של
verifyChain הקנוני (mini-services/fleet-economy/index.ts):
  prev="GENESIS" → לכל-אירוע: body=JSON.stringify({...רשומה-בלי-h, prev});
  h=sha256(body).slice(0,32); חייב-להשתוות ל-h-בקובץ; prev=h.

G59 · סנכרון-דוקטרינת-העוגנים (גל-85 + Z2-15) — העתק-הפייתון היה-מיושן-ודיווח
שבר-שקרי על עוגן-תפר היסטורי לגיטימי (נמדד חי: brokenAt=215 על ספר ok:true):
  · אי-התגשבות-hash → עוגן-תפר: נרשם, prev=h-השמור, השורה-הבאה חייבת-להתגבש
  · שני-עוגנים-רצופים = שבר-אמת (אינם מתגבשים)
  · זנב-טרמינלי-בלתי-מעוגן (הספר-נגמר-על-עוגן) = שבר fail-closed
  · חוק-סדר-seq: נסיגה/כפילות-seq = שבר-מבנה
  · דוקטרינת-האזעקה: anchors≤5 = תעודה (ok=True) · anchors>5 = אזעקה (ok=False)

התאמת-JS-מדויקת: מפתחות-בסדר-הקובץ · מחרוזות-ללא-בריחת-ASCII · מספרים-בפורמט
קצר-הדדיות של-JS (repr + נרמול-מעריך: 1e-07→1e-7) · מפרידים-צפופים.

שימוש: verify_chain.py <ledger.jsonl או תיקיית-ספר>
פלט (נאכף-בפעימת-הבנאי): ok=True/False checked=N anchors=[...] anchorAlarm=... (+אבחון)
"""
import hashlib
import json
import os
import re
import sys

GENESIS = "GENESIS"
MAX_ANCHORS = 5  # דוקטרינת-העוגנים: עד-5 = תעודה, מעל-זה = אזעקה


def js_num(x):
    """ייצוג-מספר-בסטנדרט-JS (JSON.stringify Number):"""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float("inf"), float("-inf")):
        return "null"  # JS: NaN/Infinity → null
    if x == 0:
        return "0" if str(x).startswith("0") else "-0" if str(x).startswith("-0") else "0"
    r = repr(float(x))
    if "e" in r or "E" in r:
        mant, _, exp = r.partition("e")
        sign = "+" if not exp.startswith("-") else "-"
        digits = exp.lstrip("+-").lstrip("0") or "0"
        r = f"{mant}e{sign}{digits}"
    return r


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def js_dumps(o):
    """JSON.stringify תואם-JS: סדר-מפתחות=הוספה, מפרידים-צפופים, יוניקוד-גלוי."""
    if o is None:
        return "null"
    if isinstance(o, bool):
        return "true" if o else "false"
    if isinstance(o, (int, float)):
        return js_num(o)
    if isinstance(o, str):
        return js_str(o)
    if isinstance(o, list):
        return "[" + ",".join(js_dumps(v) for v in o) + "]"
    if isinstance(o, dict):
        return "{" + ",".join(js_str(str(k)) + ":" + js_dumps(v) for k, v in o.items()) + "}"
    return js_str(str(o))


def ledger_files(base):
    """סדר-קבצי-הספר — מילה-במילה מ-ledgerFiles() הקנוני (מיון-מספרי-גל-85)."""
    if os.path.isfile(base):
        base_dir = os.path.dirname(os.path.abspath(base))
        names = [os.path.basename(base)]
    else:
        base_dir = base
        names = [f for f in os.listdir(base_dir) if f == "ledger.jsonl" or f.startswith("ledger-")]

    def key(n):
        m = re.search(r"-(\d+)\.jsonl$", n)
        return (int(m.group(1)) if m else 0, n)

    return base_dir, sorted(names, key=key)


def main():
    if len(sys.argv) < 2:
        print("ok=False checked=0 anchors=[] anchorAlarm=False why=missing-arg")
        return 2
    target = sys.argv[1]
    base_dir, files = ledger_files(target)

    prev = GENESIS
    checked = 0
    last_seq = 0
    prev_was_anchor = False
    broken_at = None
    anchors = []
    for name in files:
        p = os.path.join(base_dir, name)
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        t = json.loads(line, object_pairs_hook=lambda pairs: dict(pairs))
                    except Exception:
                        broken_at = checked
                        break
                    h = t.pop("h", None)
                    seq = t.get("seq")
                    # Z2-15 · חוק-סדר: נסיגת/כפילות-seq = שבר-מבנה fail-closed
                    if not isinstance(seq, (int, float)) or isinstance(seq, bool) or seq <= last_seq:
                        broken_at = seq if isinstance(seq, (int, float)) else checked
                        break
                    last_seq = seq
                    body = js_dumps({**t, "prev": prev})
                    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
                    if h is None or digest != h:
                        if prev_was_anchor:
                            broken_at = seq  # שבר-אמת: שני-עוגנים-רצופים לא מתגבשים
                            break
                        # עוגן-תפר: המשך מה-h השמור, השורה-הבאה חייבת להתגבש
                        anchors.append(seq)
                        prev = h
                        prev_was_anchor = True
                        continue
                    prev = h
                    checked += 1
                    prev_was_anchor = False
        except FileNotFoundError:
            broken_at = checked
            break
        if broken_at is not None:
            break

    # Z2-15 · זנב-בלתי-מעוגן: הספר-נגמר-על-עוגן בלי-יורש-שמוכיח-עיגון-מחדש → שבר fail-closed
    if broken_at is None and prev_was_anchor and anchors:
        broken_at = anchors[-1]

    alarm = len(anchors) > MAX_ANCHORS
    ok = broken_at is None and not alarm
    print(f"ok={'True' if ok else 'False'} checked={checked} anchors=[{','.join(str(a) for a in anchors)}] anchorAlarm={'True' if alarm else 'False'}")
    if not ok:
        if broken_at is not None:
            print(f"brokenAt={broken_at}")
        if alarm:
            print(f"alarm=anchors>{MAX_ANCHORS} — דוקטרינת-העוגנים: צמיחת-עוגנים מעל-התעודה = אזעקה")
        print(f"first-failed-file={files[0] if files else '-'}")
    else:
        last_file = files[-1] if files else "-"
        print(f"files={len(files)} lastFile={last_file} prevTail={prev[:12]}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
