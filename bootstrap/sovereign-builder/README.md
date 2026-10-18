# sovereign-builder — הבנאי-הריבוני (גל-92 · agent-2 · 2026-10-18)

**בקשת-הבעלים**: "למה האתר לא משתפר ומתעדכן באמת קבוע על ידי הריבונות? אני רוצה בניה
ושיפור תמיד ולא רק בדיקות" + הארכיטקטורה תעבוד-לבד רב-תחומית גם-בלי-אף-סוכן.

**התשובה-ההנדסית**: לופ-בונה חי וקבוע:

```text
observe → think → act → seal
   │        │      │      │
   │        │      │      └─ איטום-תמונת-מצב לגיט-הקנוני (FF-טהור; מפוצל→merge-נקי; קונפליקט→abort+דחייה)
   │        │      └─ ביצוע-מדוד: פריט-אחד מה-backlog, אך-ורק מתוך white-list סוגי-פעולה
   │        └─ מוח-LLM מציע עד-3 פריטי-שיפור (API מקומי /api/saos/builder-brain · fail-open)
   └─ מדידת-טלמטריה-חיה (פנקס-קנוני בקריאה-בלבד · לב-הכלכלה) + צילום-מדדים לסדרה
```

## מה-הוכח-חי (בעת-הקמה)

- פעימה-1 (02:09Z): המוח הציע "ניטור-שוק" → נפתחה-יכולת · איטום `53df8f9` (FF) · 18ש'.
- פעימה-2 (02:11Z, **אוטונומית לגמרי בלי-סוכן**): "למידה-מטלמטריה" נפתחה · backlog מתמלא מהמוח.
- הקונסולה מציגה את הכל חי: כרטיס "צמיחה-ריבונית" + כרטיס "ארסנל" (מדוד 7/7).

## רכיבים

| רכיב | מקום | תפקיד |
|---|---|---|
| run-builder-beat.mjs | כאן (bootstrap/sovereign-builder/) | פעימה-אחת: observe→think→act→seal |
| sovereign-builder-host.mjs | my-project (בית) | מארח-קצב 15 דק' · דופק :3021 · rc≠0→חזרה-בעוד-5 דק' |
| state/builder-state.json | /home/z/audit/sovereign-builder/state/ | מצב-חי: backlog·acts·capabilities·seals |
| state/growth-log.jsonl | כנ"ל | סדרת-מדדים+יומן-צמיחה (append-only) |
| /api/saos/growth | my-project | קריאת-הכל-חי לקונסולה (+קטלוג-ארסנל מדוד-existsSync) |
| /api/saos/builder-brain | my-project | המוח: LLM-backend, fail-open, white-list-אכיפה-כפולה |

## חוקי-בידוד (קשיחים)

1. **clone-פרטי** `fleet-economy-builder` — אפס-נגיעה ב-clone-פעימות-הכלכלה; כתיבה-רק
   תחת `bootstrap/sovereign-builder/` (תיקייה-דיסקרטית → merge-נקי במקרה-פיצול).
2. **הפנקס-קריאה-בלבד** — אימות-כפול של המצב (verify_chain דרך-ארסנל, לא-הדמיות).
3. **המוח לעולם לא מריץ קוד** — מציע-טקסט-בלבד; הבנאי מאכף white-list פעמיים (route+beat).
4. **אפס-סודות** — ה-PAT לעולם בזמן-ריצה; בקוד/לוג/state אין-שום-סוד.
5. **fail-closed-באיטום, fail-open-במוח** — בלי-מוח הבנאי ממשיך מה-backlog; בלי-איטום
   המצב-המקומי שורד-והפעימה-הבאה-מנסה-שוב.

## החזרה-אחרי-מחיקת-סנדבוקס (שתי-פקודות)

```bash
# 1) הקוד-מגיע-מהקנוני (כבר-כאן): run-builder-beat.mjs → /home/z/audit/sovereign-builder/
# 2) הקמה — watchdog-הבנאים ב-src/instrumentation.ts (my-project) מקים-ומחייה-מעתה-שני-מארחים:
(cd /home/z/my-project && nohup bun sovereign-builder-host.mjs >> /home/z/audit/builder-beat-host.log 2>&1 &)
```

ה-state-החי נאטם-לכאן-בכל-פעימה (`bootstrap/sovereign-builder/state/`) — אחרי-מחיקה
משחזרים-אותו-מהקנוני ל-`/home/z/audit/sovereign-builder/state/` והבנאי ממשיך בדיוק-משם-שנעצר.
המארח sovereign-builder-host.mjs נשמר-גם-הוא בגיט-הבית של הקונסולה (git-מקומי my-project).

## מפת-דרך (צמיחה-ולא-סגירה)

- [x] לופ observe→think→act→seal חי (גל-92)
- [x] יכולות-פתוחות מוצגות בקונסולה
- [ ] הרחבת-כלים ב-TOOLS (sovereign_vm_audit מלא · מדדי-בריאות-רשת)
- [ ] מוח-מקומי-resilient (cache-הצעות-לסביבה-ללא-LLM)
- [ ] builder-פר-סנדבוקס על אותו-ספר-קנוני (חוק-מירוץ כבר-מוכח בגל-90)
