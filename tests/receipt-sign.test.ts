/* ═══ receipt-sign.test.ts — חתימות-קבלה על שרשרת-ה-hash · הוכחות fail-closed ═══
 * ================================================================================
 * directive §3 · sovereign-lane · wave 19.80 (trace 1a1697622e3a2ea5) · 2026-10-23
 *
 * הבעיה-המדודה: שרשרת-ה-hash (h/prev) מוכיחה-שלמות-פר-רשומה — אבל שכתוב-מלא
 * של הספר (חישוב-מחדש של כל-ה-h) בלתי-ניתן-לגילוי בלי-עוגן-חוץ. חתימת-HMAC
 * על (seq, h, prevSig) — עם מפתח-שלא-נמצא-בריפו — הופכת כל-שכתוב לגילוי.
 *
 * מה-הטסט הזה מוכיח (אפס-הדמיות — מפתחות-זמן-ריצה-זריקים בתוך-הטסט בלבד):
 *  1. וקטור-RFC 4231: HMAC-SHA256 זהה בין-המימוש-לבין-התקן (עוגן-חוצה-שפות
 *     מול verify_signatures.py — שפת-Python מחשבת את-אותו-ערך ב-stdlib).
 *  2. דטרמיניזם: אותו-קלט → אותו-ערך, תמיד.
 *  3. שרשרת: קבלה-ראשונה p=GENESIS-SIG · כל-קבלה p = קודמת.s.
 *  4. טמפר-תוכן-רשומה → h משתנה → הקבלה כבר-לא-תואמת-את-הספר → seam.
 *  5. טמפר בשדה-h של-הקבלה → חוסר-התאמת-חתימה → seam.
 *  6. טמפר בשדה-s → השרשרת נשברת-בחוליה-הבאה → seam.
 *  7. מפתח-שגוי → כל-החתימות נכשלות → ok:false.
 *  8. מפתח-חסר-בסביבה → requireReceiptKey זועק (fail-closed, שם-המשתנה בשגיאה).
 *  9. ספר-ריק → זנב-ריק, אימות ריק ok:true checked:0 (ריק-הוא-כנה-לא-כוזב).
 * 10. פערי-seq מותרים (הספר-האמיתי מדד פערים — segments.json): עלייה-מחמירה,
 *     לא +1.
 * 11. הצלבה-מול-הספר-החי: 500 הרשומות-האחרונות של state/ledger.jsonl — חתימה,
 *     אימות, והצלבה מול-המקור.
 * 12. headSig: הצבת-הראש קובעת את-כל-הזנב (עוגן-אחד לכל-ההיסטוריה-החתומה).
 */
import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import {
  sigHead,
  signLedgerTail,
  verifyReceipts,
  requireReceiptKey,
  ALG,
  GENESIS_SIG,
  type Receipt,
  type HashRecord,
} from "../lib/receipt-sign";

/* RFC 4231 test case 1: key = 0x0b ×20, data = "Hi There" */
const RFC_KEY = "\u000b".repeat(20);
const RFC_EXPECTED = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";

const throwawayKey = () => "test-key-" + "7f3a91c4d2e8b605fa41c9de38a27b60".slice(0, 24);

const rec = (seq: number, amt: string): HashRecord => ({
  seq,
  ts: 1792770000000 + seq,
  kind: "tax",
  from: "aluf",
  to: "treasury",
  asset: "USDS",
  amount: amt,
  reason: "מס-שירותים 2.5% → כספת",
  h: `h-${seq.toString(16).padStart(8, "0")}`,
});

describe("עוגן-חוצה-שפות (RFC 4231)", () => {
  test("sigHead משחזר את וקטור-התקן על הקלט של ה-RFC", () => {
    /* sigHead(key, msg) על המסר "Hi There" — אותו חישוב HMAC-SHA256 של
     * verify_signatures.py ב-stdlib של Python 3.12 */
    expect(sigHead(RFC_KEY, "Hi There")).toBe(RFC_EXPECTED.slice(0, 32));
  });

  test("דטרמיניזם: אותו-קלט → אותו-ערך", () => {
    const a = sigHead("k1", "msg-42");
    const b = sigHead("k1", "msg-42");
    expect(a).toBe(b);
    expect(sigHead("k2", "msg-42")).not.toBe(a);
    expect(sigHead("k1", "msg-43")).not.toBe(a);
  });
});

describe("שרשרת-החתימות על זנב-ספר", () => {
  test("genesis + חוליות: ראשונה p=GENESIS-SIG · כל-קבלה p = קודמת.s", () => {
    const book = [rec(1, "0.000010"), rec(2, "0.000020"), rec(3, "0.000030")];
    const rts = signLedgerTail(book, throwawayKey());
    expect(rts.length).toBe(3);
    expect(rts[0].p).toBe(GENESIS_SIG);
    expect(rts[1].p).toBe(rts[0].s);
    expect(rts[2].p).toBe(rts[1].s);
    for (const r of rts) {
      expect(r.alg).toBe(ALG);
      expect(r.s).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("headSig אחד קובע את כל-הזנב", () => {
    const book = [rec(1, "0.5"), rec(2, "0.25"), rec(3, "0.125"), rec(4, "0.0625")];
    const rts = signLedgerTail(book, throwawayKey());
    const head = rts[rts.length - 1].s;
    /* מודל-ההתקפה-האמיתי (שכתוב-מלא): בספר-אמיתי h מכסה-תוכן — טמפר-תוכן
     * מחייב h מחושב-מחדש. המבחן: שכתוב הכולל-את-h של-רשומה 2 מייצר ראש שונה */
    const tampered = book.map((r) => (r.seq === 2 ? { ...r, amount: "0.999999", h: "h-00000002-forged" } : r));
    const rts2 = signLedgerTail(tampered, throwawayKey());
    expect(rts2[rts2.length - 1].s).not.toBe(head);
  });
});

describe("fail-closed — כל-טמפר נגלה", () => {
  test("טמפר-תוכן-רשומה → הצלבה-מול-הספר קורעת (h משתנה)", () => {
    const book = [rec(1, "1.000000"), rec(2, "2.000000"), rec(3, "3.000000")];
    const rts = signLedgerTail(book, throwawayKey());
    /* תוקף משכתב את הספר ומחשב-מחדש את h (ה-שכתוב-המלא שה-hash-chain לא רואה) */
    const rewritten = book.map((r) => (r.seq === 2 ? { ...r, amount: "999.0", h: "forged-h-2" } : r));
    const ledgerBySeq = new Map(rewritten.map((r) => [r.seq, r.h]));
    const v = verifyReceipts(rts, throwawayKey(), { ledgerBySeq });
    expect(v.ok).toBe(false);
    expect(v.seams.length).toBe(1);
    expect(v.seams[0].kind).toBe("LEDGER-MISMATCH");
    expect(v.seams[0].seq).toBe(2);
  });

  test("טמפר בשדה-h של-הקבלה עצמה → חוסר-התאמת-חתימה", () => {
    const book = [rec(1, "1"), rec(2, "2")];
    const rts = signLedgerTail(book, throwawayKey());
    const tamperedRts: Receipt[] = rts.map((r, i) => (i === 1 ? { ...r, h: "deadbeef" } : r));
    const v = verifyReceipts(tamperedRts, throwawayKey());
    expect(v.ok).toBe(false);
    expect(v.seams.some((s) => s.kind === "SIG-MISMATCH")).toBe(true);
  });

  test("טמפר בשדה-s → נשבר בחוליה-הבאה", () => {
    const book = [rec(1, "1"), rec(2, "2"), rec(3, "3")];
    const rts = signLedgerTail(book, throwawayKey());
    const tamperedRts: Receipt[] = rts.map((r, i) =>
      i === 0 ? { ...r, s: "a".repeat(32) } : r,
    );
    const v = verifyReceipts(tamperedRts, throwawayKey());
    expect(v.ok).toBe(false);
    expect(v.seams.length).toBe(2); /* חוליה-0 עצמה + החוליה-הבאה שה-p שלה נשבר */
  });

  test("מפתח-שגוי → ok:false, אפס-התאמות", () => {
    const book = [rec(1, "1"), rec(2, "2"), rec(3, "3")];
    const rts = signLedgerTail(book, throwawayKey());
    const v = verifyReceipts(rts, "totally-wrong-key");
    expect(v.ok).toBe(false);
    expect(v.checked).toBe(0);
    expect(v.seams.length).toBe(3);
  });

  test("מפתח-חסר-בסביבה → זעקה fail-closed עם שם-המשתנה", () => {
    const prev = process.env.FLEET_RECEIPT_KEY;
    delete process.env.FLEET_RECEIPT_KEY;
    try {
      expect(() => requireReceiptKey()).toThrow(/FLEET_RECEIPT_KEY/);
      /* מפתח-ריק = חסר */
      process.env.FLEET_RECEIPT_KEY = "";
      expect(() => requireReceiptKey()).toThrow(/FLEET_RECEIPT_KEY/);
    } finally {
      if (prev !== undefined) process.env.FLEET_RECEIPT_KEY = prev;
      else delete process.env.FLEET_RECEIPT_KEY;
    }
  });

  test("חתימה-בלי-מפתח (מחרוזת-ריקה) → זעקה, לא-חתימה-שקטה", () => {
    const book = [rec(1, "1")];
    expect(() => signLedgerTail(book, "")).toThrow();
    expect(() => sigHead("", "msg")).toThrow();
  });
});

describe("קצוות-אמיתיים של-הספר", () => {
  test("ספר-ריק → זנב-ריק · אימות-ריק ok:true checked:0", () => {
    const rts = signLedgerTail([], throwawayKey());
    expect(rts).toEqual([]);
    const v = verifyReceipts([], throwawayKey());
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(0);
    expect(v.seams).toEqual([]);
  });

  test("פערי-seq מותרים — עלייה-מחמירה, לא +1 (הספר-האמיתי מדד פערים)", () => {
    const book = [rec(46335, "1"), rec(55120, "2"), rec(68271, "3")];
    const rts = signLedgerTail(book, throwawayKey());
    const v = verifyReceipts(rts, throwawayKey());
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
  });

  test("סדר-יורד-ב-seq → seam (הספר-הוא-מונוטוני)", () => {
    const book = [rec(9, "1"), rec(5, "2")];
    const rts = signLedgerTail(book, throwawayKey());
    const v = verifyReceipts(rts, throwawayKey());
    expect(v.ok).toBe(false);
    expect(v.seams[0].kind).toBe("SEQ-ORDER");
  });
});

describe("הצלבה-מול-הספר-החי (state/ledger.jsonl)", () => {
  test("500 הרשומות-האחרונות: חתימה → אימות → הצלבה מול-המקור", () => {
    const ledgerPath = path.join(import.meta.dir, "..", "state", "ledger.jsonl");
    if (!fs.existsSync(ledgerPath)) {
      /* הספר-החי לא-נוכח בענף — ההוכחה-החיה נמדדת בקבלה-האמיתית של-הגל */
      console.log("    (ספר-חי לא-נוכח — מדלג על הצלבה-חיה; הקבלה-האמיתית ב-state/audit)");
      return;
    }
    const lines = fs.readFileSync(ledgerPath, "utf-8").split("\n").filter((l) => l.trim());
    const tail = lines.slice(-500).map((l) => JSON.parse(l) as HashRecord);
    expect(tail.length).toBe(500);
    const key = throwawayKey();
    const rts = signLedgerTail(tail, key);
    const ledgerBySeq = new Map(tail.map((r) => [r.seq, r.h]));
    const v = verifyReceipts(rts, key, { ledgerBySeq });
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(500);
    expect(v.seams).toEqual([]);
    expect(v.headSig).toBe(rts[rts.length - 1].s);
  });
});
