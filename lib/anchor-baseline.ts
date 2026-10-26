/* ═══ anchor-baseline.ts — רישום-בסיס-העוגנים-פר-דור-ספר ═══
 * ==========================================================
 * G76-d · 2026-10-26 · ריפוי-פצע owner §5/§7: קבלות economy-beat הכריזו `עוגנים=0/7`.
 * המדידה: ה-7 הוא בסיס-תפרי-העוגן של דור-הספר-הקודם (פורנזיה גל-93 · 2026-10-18T04Z —
 * 46335/55120/68276 + תפרי-צומת 290040/294919/299807/299847). הספר-החי (regenesis2,
 * פתיחה seq=1 · כותב-יחיד · רציפות-mauyachet) אינו מכיל את התפרים ההם — 0 תפרים הוא
 * המצב-הבריא-שלו, והדיווח `0/7` היה קריאה-כוזבת של בריאות ככישלון.
 *
 * החוק: בסיס-העוגנים הוא נכס-פר-דור-ספר — נקרא מרישום-מתועד ב-state/audit/
 * anchor-baseline.json (documentedSeams.length חייב לשוות baseline, אחרת fail-closed
 * → fallback מחמיר 0). כל-תפר-חי-מעבר-למתועד = אזעקה. סמנטיקת-verifyChain (Z2-15)
 * אינה נוגעת — הרישום קובע רק את קנה-המידה-הכנה של הקבלות.
 *
 * stdlib-only · אפס-רשת · אפס-שעון (registeredAt נקרא, לא נמדד). נצרך גם ע"י
 * index.ts (/verify,/claims) וגם ע"י run-economy-beat.mjs (קו-הקבלה) — מקור-אמת אחד. */
import fs from "fs";
import path from "path";

export type DocumentedSeam = { seq: number; note?: string };

export type AnchorBaseline = {
  baseline: number; // מספר-התפרים-המתועדים-המקובלים-בספר-החי
  source: "registry" | "fallback";
  book: string | null;
  documentedSeams: DocumentedSeam[];
  inherited: { baseline: number; note: string; evidence: string } | null;
  law: string;
  registeredAt: string | null;
};

export const ANCHOR_REGISTRY_RELPATH = "audit/anchor-baseline.json";

export const FALLBACK_LAW = "אין-רישום-בסיס-תקף — fallback מחמיר: כל-תפר-חי = אזעקה (כותב-יחיד: ספר-בריא = אפס-תפרים)";

function fallback(): AnchorBaseline {
  return { baseline: 0, source: "fallback", book: null, documentedSeams: [], inherited: null, law: FALLBACK_LAW, registeredAt: null };
}

export function loadAnchorBaseline(stateDir: string): AnchorBaseline {
  try {
    const raw = fs.readFileSync(path.join(stateDir, ANCHOR_REGISTRY_RELPATH), "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    const baseline = Number(j?.baseline);
    if (!Number.isInteger(baseline) || baseline < 0) throw new Error("baseline-not-natural-integer");
    const seamsRaw = Array.isArray(j?.documentedSeams) ? (j.documentedSeams as unknown[]) : null;
    if (!seamsRaw) throw new Error("documentedSeams-not-array");
    const documentedSeams: DocumentedSeam[] = [];
    const seen = new Set<number>();
    for (const s of seamsRaw) {
      const seq = Number((s as DocumentedSeam)?.seq);
      if (!Number.isInteger(seq) || seq <= 0 || seen.has(seq)) throw new Error("seam-entry-invalid");
      seen.add(seq);
      documentedSeams.push({ seq, note: (s as DocumentedSeam)?.note });
    }
    if (documentedSeams.length !== baseline) throw new Error("seams-baseline-mismatch"); // רישום-לא-עקבי = לא-נאמן
    const inh = j?.inherited as AnchorBaseline["inherited"] | undefined;
    return {
      baseline,
      source: "registry",
      book: typeof j?.book === "string" ? j.book : null,
      documentedSeams,
      inherited: inh && typeof inh.baseline === "number" && typeof inh.note === "string" && typeof inh.evidence === "string" ? inh : null,
      law: typeof j?.law === "string" ? j.law : "כל-תפר-מעבר-לבסיס-המתועד = אזעקה fail-closed",
      registeredAt: typeof j?.registeredAt === "string" ? j.registeredAt : null,
    };
  } catch {
    return fallback();
  }
}

/* הכרעה: תפרים-שנמצאו ≤ בסיס-המתועדים = ok; מעבר = אזעקה (תפר-חדש = ספר-קרוע). */
export function anchorVerdict(anchors: number, b: AnchorBaseline): "ok" | "alarm" {
  return anchors <= b.baseline ? "ok" : "alarm";
}

/* קו-הקבלה-הכנה לקומיט/סיכום: 0/0 = ספר-רציף (בריאות, לא כישלון); מתועד = ok; מעבר = אזעקה. */
export function anchorReceiptLine(anchors: number, b: AnchorBaseline): string {
  const head = `עוגני-תפר=${anchors}/${b.baseline}`;
  if (anchors > b.baseline) return `${head} · אזעקה-תפר-לא-מתועד-ספר-קרוע`;
  if (anchors === 0 && b.baseline === 0) return `${head} · ספר-רציף`;
  return `${head} · מתועד`;
}
