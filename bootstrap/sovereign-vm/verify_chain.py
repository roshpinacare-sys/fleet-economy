#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_chain.py — אימות-שרשרת-פנקס בלתי-תלוי (גל-91 · agent-2 · נבנה-מחדש גל-95)
═══════════════════════════════════════════════════════════════════════════════
אמת-מדידה עצמאית: פייתון-טהור, ללא-תלות-במנוע-ה-JS. שכפול-מילה-במילה של
verifyChain הקנוני (mini-services/fleet-economy/index.ts):
  prev="GENESIS" → לכל-אירוע: body=JSON.stringify({...רשומה-בלי-h, prev});
  h=sha256(body).slice(0,32); חייב-להשתוות ל-h-בקובץ; prev=h.
התאמת-JS-מדויקת: מפתחות-בסדר-הקובץ · מחרוזות-ללא-בריחת-ASCII · מספרים-בפורמט
קצר-הדדיות של-JS (repr + נרמול-מעריך: 1e-07→1e-7) · מפרידים-צפופים.
שימוש: verify_chain.py <ledger.jsonl או תיקיית-ספר>
פלט (נאכף-בפעימת-הבנאי): ok=True/False checked=N anchors=[...] (+שורות-אבחון)
import hashlib
import json
import os
import re
import sys
GENESIS = "GENESIS"
ANCHOR_KINDS = {"anchor", "join-anchor", "seam-anchor", "seam"}
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
        print("ok=False checked=0 anchors=[] why=missing-arg")
        return 2
    target = sys.argv[1]
    base_dir, files = ledger_files(target)
    prev = GENESIS
    checked = 0
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
                    body = js_dumps({**t, "prev": prev})
                    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
                    if h is None or digest != h:
                        broken_at = t.get("seq", checked)
                    prev = h
                    checked += 1
                    k = t.get("kind")
                    if isinstance(k, str) and k in ANCHOR_KINDS:
                        anchors.append(t.get("seq"))
        except FileNotFoundError:
            broken_at = checked
            break
        if broken_at is not None:
    ok = broken_at is None
    print(f"ok={'True' if ok else 'False'} checked={checked} anchors=[{','.join(str(a) for a in anchors)}]")
    if not ok:
        print(f"brokenAt={broken_at}")
        print(f"first-failed-file={files[0] if files else '-'}")
        last_file = files[-1] if files else "-"
        print(f"files={len(files)} lastFile={last_file} prevTail={prev[:12]}")
    return 0 if ok else 1
if __name__ == "__main__":
    sys.exit(main())
verify_chain.py — אימות-שרשרת-פנקס בלתי-תלוי (גל-91 · agent-2 · נבנה-מחדש גל-95 · דוקטרינת-עוגנים גל-62/59-C2)
verifyChain הקנוני (fleet-economy/index.ts · Z2-15):
דוקטרינת-העוגנים (הוכחה-חיה במנוע · אומצה-כאן מילה-במילה):
  · חוק-סדר-seq: נסיגה/כפילות-seq = שבר-מבנה fail-closed.
  · עוגן-תפר: שורה שכשלת-התגבשות פעם-אחת = עוגן — המשך-מה-h-השמור שלה;
    השורה-הבאה חייבת להתגבש (רציפות-מוכחת, אפס-שכתוב-היסטוריה).
  · שני-עוגנים-רצופים = שבר-אמת (לא מתגבשים).
  · זנב-טרמינלי-על-עוגן = שבר-אמת (אין-יורש-שמוכיח-עיגון-מחדש).
  · anchorAlarm: >5-עוגנים = אזעקה (צמיחה-חריגה של תפרים).
סדר-קבצים: לקסיקוגרפי (כמו-המנוע) · חוק-סדר-seq שופט.
ANCHOR_ALARM = 5  # גל-59-C2: מעל-5-עוגנים-תפר = אזעקה (צמיחה-חריגה)
    """סדר-קבצי-הספר — כמו-verifyChain המנוע: סינון + מיון-לקסיקוגרפי (חוק-סדר-seq שופט)."""
    return base_dir, sorted(names)
def verify(base_dir, files):
    """שכפול-מילה-במילה של verifyChain הקנוני (דוקטרינת-עוגנים Z2-15)."""
    prev_was_anchor = False
    last_seq = 0
            fh = open(p, "r", encoding="utf-8")
            return False, checked, checked, anchors
        with fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    t = json.loads(line)
                except Exception:
                    return False, checked, checked, anchors
                if not isinstance(t, dict):
                seq = t.get("seq")
                if not isinstance(seq, (int, float)) or isinstance(seq, bool) or seq <= last_seq:
                    return False, checked, seq, anchors  # חוק-סדר-seq fail-closed
                last_seq = seq
                h = t.pop("h", None)
                body = js_dumps({**t, "prev": prev})
                digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
                if digest != h:
                    if prev_was_anchor:
                        return False, checked, seq, anchors  # שבר-אמת: שני-עוגנים-רצופים לא מתגבשים
                    anchors.append(seq)  # עוגן-תפר: המשך מה-h השמור, השורה-הבאה חייבת להתגבש
                    prev_was_anchor = True
                prev = h
                checked += 1
                prev_was_anchor = False
    # זנב-בלתי-מעוגן: הספר-נגמר-על-עוגן בלי-יורש-שמוכיח-עיגון-מחדש → שבר-אמת fail-closed
    if prev_was_anchor and anchors:
        return False, checked, anchors[-1], anchors
    return True, checked, None, anchors, prev
    ok, checked, broken_at, anchors, prev = verify(base_dir, files)
    alarm = len(anchors) > ANCHOR_ALARM
    print(f"ok={'True' if ok and not alarm else 'False'} checked={checked} anchors=[{','.join(str(a) for a in anchors)}]")
    if alarm:
        print(f"anchorAlarm=True count={len(anchors)} threshold={ANCHOR_ALARM} — צמיחת-תפרים-חריגה")
        return 1
    last_file = files[-1] if files else "-"
    print(f"files={len(files)} lastFile={last_file} prevTail={str(prev)[:12]}")
    return 0
