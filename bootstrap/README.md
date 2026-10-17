# bootstrap/ — שחזור-ריבונות מהגיט-בלבד (גל-88 · agent-2 · 2026-10-17)

**נמדד והוכח היום**: מאפס-מוחלט (סנדבוקס-מת, בלי-מצב-מקומי) לספר-חי-מאומת ב-**3.2 שניות**
(clone 2.4ש' + בוט-עד-verify 0.7ש'; ok:true, checked=87,774, עוגנים זהים-לקנוני).

## למה זה קיים
חוק-הבעלים: **עובדים לפי הגיט, לא לפי הסנדבוקס — הסנדבוקס רשאי להימחק בכל רגע.**
התיקונים-החיים של המארח (economy-beat-host.mjs) וה-watchdog (instrumentation.ts) חיו רק
בסנדבוקס (my-project — ריפו-מקומי ללא remote). עכשיו העותק-הקנוני כאן, בתוך ספר-האמת.

## שחזור מלא אחרי wipe (ארבע פקודות)
```bash
git clone --depth 1 https://github.com/roshpinacare-sys/fleet-economy.git /home/z/audit/fleet-economy
cd /home/z/audit/fleet-economy
(setsid nohup bash supervise-economy.sh >/dev/null 2>&1 &)   # מנוע תמיד-חי על 3016 (אופציונלי)
(setsid nohup bun bootstrap/economy-beat-host.mjs >/dev/null 2>&1 &)  # פעימות כל 45 דק'
```
- המארח קורא את ה-PAT מ-`/home/z/my-project/upload/pat.env` בזמן-ריצה בלבד (אפס-סודות-בלוג).
- אם ספר-העבודה חסר/שבור — המארח משכפל-את-עצמו-מהגיט (self-provision, ensureBook).
- instrumentation.ts מועתק אל `src/instrumentation.ts` של מופע-Next.js אם קיים —
  הוא מקים את המארח כילד-בית + watchdog כל-10 דק' (הישרדות-מעמד-בית).

## חוקי-כותב (אל-שבירה)
- **כותב-יחיד**: מנעול `state/writer-heartbeat.json` — TTL 30 דק'. כותב-שני מכבד ויוצא-בכבוד.
- **פורטים**: מנוע=3016 (קבוע) · מארח=3020 (קבוע) · בדיקות-מעבדה=3017 בלבד, הריגה-לפי-pid-מדויק.
- **איטום**: רק אחרי `verify ok` + עוגנים=3. אף-פעם לא דורסים ספר-קיים — רק הקמה-מחדש של עותק-שבור.
- **הענן**: economy-beat.yml חמוש; יירוש-כנה דרך המנעול כשהקיר-הפלטפורמה (minutes) ייפתח-ב-UI-בעלים.

## גרסאות
- גל-88 @ 2026-10-17T10:41Z — self-provisioning + wakeScheduler + saveStatus-בטריגר.
- הוכח-חי: beat #2 מיד-אחרי-החלפה: seq 87798→89175 (+1,345 tx), עוגנים 3/3, איטום 1e601f7.
