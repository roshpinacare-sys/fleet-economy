# TOOLS.md — מרשם-הכלים-הריבוני (גל-96 · agent-2 · 2026-10-18)

> **מסמך-קנוני**: כאן רשומים כל-הכלים שפעימת-הבנאי-הריבונית רשאית להריץ.
> זהו ממשק-האמת-בין **המוח** (`src/app/api/giant/builder-brain/route.ts` בקונסולה),
> **הבנאי** (`bootstrap/sovereign-builder/run-builder-beat.mjs`) ו**הסקריפטים** (`bootstrap/sovereign-vm/`).
> מנדט-הבעלים (גל-91): *האוטונומיה חייבת לדעת להשתמש בכלים — לא רק לבדוק.*

## חוק-השלשה-הקנונית (הוספת-כלי-חדש)

1. **סקריפט** — קובץ פייתון `stdlib-טהור` ב-`bootstrap/sovereign-vm/` (קריאה-בלבד · אפס-רשת · פלט-מכונה `ok=True/False`).
2. **הבנאי** — רישום ב-`TOOLS` ב-`run-builder-beat.mjs` (title + args + cwd).
3. **המוח** — רישום ב-`TOOLS` + `TOOL_META` ב-`route.ts` של builder-brain (וולידציה-קשיחה תאכוף אוטומטית).

כלי-שלא-רשום-בשלשה — נפל בוולידציה (fail-closed). אין-חריגות.

## הכלים-הרשומים

| כלי | סקריפט | קלט | פלט-מכונה | תפקיד |
|---|---|---|---|---|
| `verify_chain` | `sovereign-vm/verify_chain.py` | `state/ledger.jsonl` | `ok=True checked=N anchors=[...]` | אימות-שרשרת-פנקס בלתי-תלוי מול עוגני-בסיס |
| `ledger_stats` | `sovereign-vm/ledger_stats.py` | `state/ledger.jsonl` | `ok=True checked=N seqFirst=A seqLast=B` + היסטוגרמה | סטטיסטיקת-ספר: ספירה, טווח, סוגים |
| `price_report` | `sovereign-vm/price_report.py` | `state/snapshot.json` | `ok=True seq=N price=P fees=F treasuryUsds=U` | דוח-בריכה-ואוצר (מחיר=usds/saos) |
| `tools_selftest` | `sovereign-vm/tools_selftest.py` | (רץ-עצמאית) | `ok=True tools=3 used=3 matrix[...]` | הוכחת-שימוש-חד-פעמית: מריץ את-כל-הארסנל ומדפיס מטריצה (גל-97) |

## זרימת-השימוש

```
פעימת-בנאי → observe (צילום-מדידה) → think (POST builder-brain)
   ← המוח: סבב-מסתובב 2 מתוך 3 כלים לפי-שעה + LLM-הצעות (וולידציה-קשיחה)
→ act (הרצת-כלי-אחד לפעימה, white-list בלבד)
→ seal (איטום state+sovereign-vm לגיט-הקנוני)
```

- **פלייבוק-קבוע (גל-96, מורחב-גל-97)**: אם-המוח-לא-זמין — הבנאי ממשיך בסבב `PLAYBOOK`
  (`verify_chain → ledger_stats → price_report → tools_selftest`) כדי-שאף-פעימה-לא-תהיה-ריקה-מידיים.
- **גל-97 · טלמטריית-שימושיות**: כל-הרצת-כלי נרשמת ב-`state/tool-usage.jsonl` (at · tool · ok · durMs · result)
  וב-`state/builder-state.json` תחת `toolStats` (runs/ok/fail/lastOkAt פר-כלי). היומן נאטם-לקנון
  בכל-פעימה — **שימושיות-הארסנל היא KPI נמדד בגיט, לא טענה**. ה-UI ב-`/api/giant/tool-usability` מציג-חי.
- **רזולוציית-פייתון**: `sovereign-vm/venv` → `/home/z/.venv/bin/python3` → `/usr/bin/python3` → `/usr/local/bin/python3`.
  הכלים stdlib-טהורים — רצים-בכל-סביבה-גם-אחרי-reboot (שיעור-11:11Z: ה-venv-אפמרלי, הקנון-בגיט).

## שיעורי-גל-96 (מהשדה)

1. **venv-אפמרלי = מוות-שקט של acts** — כל-תלות-ריצה-חייבת-נפילה-מדורגת-לפייתון-מערכת.
2. **"ok=True" ≠ כישלון** — פרסר-הפלט חייב להיות חסין-רישיות (`toLowerCase`).
3. **חוק-המירוץ מלא**: push-כושל + קנוני-זז-לכל-commit-אחר = RACE-LOST מיידי (לא push-חוזר-סרק).
4. **שיעור-גל-97**: אף-אחד-לא-חסין-לרגליות-2 — גם-הכלי-שנכתב-להוכיח-שימוש נפל-ברגישות-רישיות בריצה-הראשונה. קנון-המלכודות-הזה-הוא-המציל; קריאת-TOOLS.md-לפני-כתיבה-חובה.
