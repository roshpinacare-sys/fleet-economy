/* ═══ receipt-sign.ts — שרשרת-חתימות על ספר-ה-hash · קבלות-ביקורת חתומות ═══
 * ===========================================================================
 * directive §3 (signed audit receipts) · sovereign-lane · wave 19.80
 * (trace 1a1697622e3a2ea5) · 2026-10-23
 *
 * הבעיה-המדודה (state/audit/segments.json): שרשרת-ה-hash (h/prev) מוכיחה
 * שלמות-פר-רשומה, אבל שכתוב-מלא של-הספר — חישוב-מחדש של כל-ה-h במקביל —
 * בלתי-ניתן-לגילוי מבלי-עוגן שנמצא-מחוץ-לספר. הפתרון: חתימת HMAC-SHA256
 * על (seq, h, prevSig) — שרשרת-חתימות מקבילה. תוקף שמשכתב את-הספר חייב
 * להתחיל מהמפתח — שלא-נמצא בריפו ולא-בקוד, רק בסביבת-הריצה.
 *
 * חוקי-הברזל:
 *  · fail-closed: מפתח-חסר/ריק → זעקה. לעולם-לא חתימה-שקטה או אימות-שקט.
 *  · אפס-תלות-חוץ: node:crypto בלבד (הספר-הוא אפס-תלות — package.json).
 *  · אפס-מפתחות-בקוד: המפתח מגיע מ-FLEET_RECEIPT_KEY (custody של-הבעלים);
 *    המפתחות-היחידים-בקוד הם הזריקים בתוך-הטסט.
 *  · קבלה = {seq, h, s, p, alg} — p היא-החתימה-הקודמת (GENESIS-SIG לראשונה);
 *    headSig אחד קובע את-כל-הזנב-החתום.
 *  · פערי-seq חוקיים (נמדדו: segments.json seq_max 77544 מול 77523 רשומות) —
 *    האימות דורש עלייה-מחמירה, לא +1.
 */
import { createHmac } from "crypto";

/** אלגוריתם-החתימה — עוגן-חוצה-שפות: וקטור RFC 4231 #1 מאומת מול
 * state/audit/verify_signatures.py (stdlib של Python 3.12) */
export const ALG = "HMAC-SHA256";

/** תחילית-שרשרת-החתימות (במקביל ל-GENESIS של שרשרת-ה-hash) */
export const GENESIS_SIG = "GENESIS-SIG";

/** רשומת-ספר — כל-מה-לחתימה חשוב בו הוא seq + h (ה-hash המחויב-כבר-עצמו
 * מכסה את-כל-התוכן: h = sha256(רשומה-מלאה-בלי-h + prev)) */
export type HashRecord = { seq: number; h: string } & Record<string, unknown>;

/** קבלה-חתומה: עדות על (seq, h) בשרשרת */
export type Receipt = { seq: number; h: string; s: string; p: string; alg: string };

export type ReceiptSeam = { seq: number | null; kind: string; detail?: string };

export type VerifyResult = {
  ok: boolean;
  checked: number;
  seams: ReceiptSeam[];
  headSig: string;
};

const SIG_LEN = 32; /* hex-32 — אותו-קצב כמו h32 של verify_chain.py */

function hmac32(key: string, msg: string): string {
  /* בדיקת-ריקון לפי-אורך בלבד (לא-trim): מפתחות-בייטים חוקיים (למשל 0x0b
   * של וקטור RFC 4231) הם whitespace לפי-trim של-JS — החוק הוא נוכחות-מפתח,
   * לא-היגיינת-תווים (ההיגיינה נאכפת בשכבת-הסביבה של requireReceiptKey) */
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("receipt-sign fail-closed: מפתח-חתימה ריק/חסר — אין-חתימה-שקטה");
  }
  return createHmac("sha256", key).update(msg, "utf8").digest("hex").slice(0, SIG_LEN);
}

/** צעד-חתימה-בודד — HMAC-SHA256(key, msg)[:32-hex].
 * עוגן-RFC 4231: sigHead(key=0x0b×20, "Hi There") = b0344c61…(32 ראשונים) */
export function sigHead(key: string, msg: string): string {
  return hmac32(key, msg);
}

function step(seq: number, h: string, prevSig: string, key: string): string {
  return sigHead(key, `${seq}:${h}:${prevSig}`);
}

/** חתימת-זנב-ספר: הולך על-הרשומות לפי-סדר-הקובץ ומחזיר קבלה-חתומה לכל-אחת.
 * prevSig מאפשר להמשיך קטע-קודם (זנב-חדש על-שרשרת-קבלות-ישנה).
 * fail-closed: מפתח-ריק → זעקה. */
export function signLedgerTail(
  records: HashRecord[],
  key: string,
  prevSig: string = GENESIS_SIG,
): Receipt[] {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("receipt-sign fail-closed: signLedgerTail דורש מפתח — FLEET_RECEIPT_KEY");
  }
  const out: Receipt[] = [];
  let p = prevSig;
  for (const r of records) {
    if (typeof r?.seq !== "number" || typeof r?.h !== "string" || r.h === "") {
      throw new Error(`receipt-sign fail-closed: רשומה פגומה (seq=${String(r?.seq)}) — לא-נחתמת`);
    }
    const s = step(r.seq, r.h, p, key);
    out.push({ seq: r.seq, h: r.h, s, p, alg: ALG });
    p = s;
  }
  return out;
}

/** אימות-קבלות — fail-closed, כל-סטייה seam מנומק:
 *  · SIG-MISMATCH  — ה-HMAC המשוחזר לא-תואם ל-s השמור (מפתח-שגוי/טמפר)
 *  · CHAIN-BREAK   — p של-קבלה לא-תואם ל-s של-קודמתה
 *  · CHAIN-ROOT    — הקבלה-הראשונה לא-מחוברת לתחילית-הצפויה
 *  · SEQ-ORDER     — seq לא-עולה-מחמיר (הספר מונוטוני; פערים חוקיים)
 *  · LEDGER-MISMATCH — h של-הקבלה לא-תואם את-הספר-החי (הצלבה נגד שכתוב-מלא)
 *  · MALFORMED     — קבלה חסרת-שדות
 */
export function verifyReceipts(
  receipts: Receipt[],
  key: string,
  opts: { ledgerBySeq?: Map<number, string>; prevSig?: string } = {},
): VerifyResult {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("receipt-sign fail-closed: verifyReceipts דורש מפתח — FLEET_RECEIPT_KEY");
  }
  const seams: ReceiptSeam[] = [];
  let checked = 0;
  const expectedRoot = opts.prevSig ?? GENESIS_SIG;
  let prev: Receipt | null = null;

  for (const r of receipts) {
    if (
      typeof r?.seq !== "number" ||
      typeof r?.h !== "string" ||
      typeof r?.s !== "string" ||
      typeof r?.p !== "string" ||
      r?.alg !== ALG
    ) {
      seams.push({ seq: typeof r?.seq === "number" ? r.seq : null, kind: "MALFORMED" });
      prev = null;
      continue;
    }
    /* סדר-ה-seq קודם — הספר מונוטוני גם-כשהחתימות עצמן תקינות */
    if (prev !== null && r.seq <= prev.seq) {
      seams.push({ seq: r.seq, kind: "SEQ-ORDER", detail: `seq ${r.seq} !> ${prev.seq}` });
    }
    const expectedP = prev === null ? expectedRoot : prev.s;
    if (r.p !== expectedP) {
      seams.push({ seq: r.seq, kind: "CHAIN-BREAK", detail: `p=${r.p.slice(0, 8)} expected=${expectedP.slice(0, 8)}` });
    }
    const expectS = step(r.seq, r.h, r.p, key);
    if (r.s !== expectS) {
      seams.push({ seq: r.seq, kind: "SIG-MISMATCH", detail: `s=${r.s.slice(0, 8)} expected=${expectS.slice(0, 8)}` });
    } else {
      checked += 1;
    }
    if (opts.ledgerBySeq) {
      const liveH = opts.ledgerBySeq.get(r.seq);
      if (liveH === undefined) {
        seams.push({ seq: r.seq, kind: "LEDGER-MISMATCH", detail: "seq לא-קיים בספר-החי" });
      } else if (liveH !== r.h) {
        seams.push({ seq: r.seq, kind: "LEDGER-MISMATCH", detail: `h=${r.h.slice(0, 8)} ספר=${liveH.slice(0, 8)}` });
      }
    }
    prev = r;
  }

  const headSig = receipts.length > 0 ? receipts[receipts.length - 1].s : expectedRoot;
  return { ok: seams.length === 0, checked, seams, headSig };
}

/** מפתח-הייצור מגיע מהסביבה בלבד — חסר/ריק → זעקה עם שם-המשתנה (fail-closed).
 * custody: FLEET_RECEIPT_KEY של-הבעלים — אף-פעם לא בריפו, לא בקוד, לא בלוג. */
export function requireReceiptKey(envName = "FLEET_RECEIPT_KEY"): string {
  const k = process.env[envName];
  if (typeof k !== "string" || k.trim() === "") {
    throw new Error(
      `receipt-sign fail-closed: ${envName} לא-נקבע בסביבה — חתימת-קבלות מושהית עד-אספקת-מפתח (custody של-הבעלים)`,
    );
  }
  return k;
}
