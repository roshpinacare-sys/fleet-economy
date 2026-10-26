/* ═══ anchor-baseline.test.ts — רישום-בסיס-העוגנים-פר-דור-ספר · G76-d · 2026-10-26 ═══
 * =====================================================================================
 * הפצע-הנמדד (owner §5/§7 · גל-G76): קבלות economy-beat מכריזות `עוגנים=0/7` —
 * קריאה-כוזבת של כישלון: ה-7 הוא בסיס-התפרים של דור-הספר-הקודם (פורנזיה גל-93,
 * תפרים 46335/55120/68276 + צמתים 290040/294919/299807/299847), ואילו הספר-החי
 * (regenesis2, seq פתיחה=1) רציף לחלוטין — 0 תפרים הוא המצב-הבריא, לא כישלון.
 *
 * החוק-החדש (שהטסט הזה נועל):
 *  1. בסיס-עוגנים הוא נכס-פר-דור-ספר — נקרא מרישום-מתועד (state/audit/anchor-baseline.json),
 *     לא קבוע-מקודד מדור-ישן.
 *  2. כל תפר בספר-החי חייב להיות מתועד ברישום (documentedSeams.length === baseline);
 *     רישום-לא-עקבי = fail-closed → fallback בסיס-0 (מחמיר, כנה).
 *  3. הכרעה: תפרים-שנמצאו ≤ בסיס-מתועד = ok; מעל = אזעקה (תפר-חדש = ספר-קרוע).
 *  4. קו-הקבלה כנה: 0/0 מוצג "ספר-רציף" — אף-פעם לא נראה כ-0/7 כישלון.
 *  5. סמנטיקת-התפרים של verifyChain (Z2-15) נשמרת: תפר-בודד-מגובה-רציפות = ok,
 *     זנב-בלתי-מעוגן/נסיגת-seq/עוגנים-עוקבים = ok:false — הרישום אינו נוגע בזה.
 *
 * אפס-תלות-חוץ · אפס-רשת · אפס-שעון. רץ ב-bun test.
 */
import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { loadAnchorBaseline, anchorVerdict, anchorReceiptLine, ANCHOR_REGISTRY_RELPATH } from "../lib/anchor-baseline";

/* ── עזר: ספר-סינתטי חתום-sha256 (מראה-מדויקת של verifyChain ב-index.ts · Z2-15) ── */
type Row = { seq: number; kind: string; h: string };
const H = (body: object) => createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);

function buildChain(seqs: number[], opts?: { seams?: Set<number>; tailUnanchored?: boolean; seqRegress?: boolean }): Row[] {
  const seams = opts?.seams ?? new Set<number>();
  const rows: Row[] = [];
  let prev = "GENESIS";
  let lastSeq = 0;
  for (const s of seqs) {
    let seq = s;
    if (opts?.seqRegress && rows.length === Math.floor(seqs.length / 2)) seq = lastSeq - 1; // נסיגה
    if (seams.has(s)) {
      // תפר: h נשמר-מהתפר-הקודם (לא ניתן לאימות מול prev) — השורה-הבאה חייבת להתגבש ממנו
      const h = H({ seq, prev: "STITCH-" + prev });
      rows.push({ seq, kind: "service", h });
      prev = h;
      lastSeq = seq;
      continue;
    }
    const h = H({ seq, prev });
    rows.push({ seq, kind: "wage", h });
    prev = h;
    lastSeq = seq;
  }
  if (opts?.tailUnanchored && seams.size > 0) {
    // הספר-נגמר-על-עוגן בלי-יורש-מתגבש — מחיקת-היורש (התפר האחרון נשאר זנב)
    const lastSeamIdx = rows.map((r) => seams.has(r.seq)).lastIndexOf(true);
    if (lastSeamIdx === rows.length - 1) return rows;
  }
  return rows;
}

/* מראה-verifyChain (Z2-15) — אותו-חוק: ok/anchors; לצורך-הוכחת-הרישום-על-ספרים-סינתטיים */
function verifyMirror(rows: Row[]): { ok: boolean; anchors: { seq: number }[] } {
  let prev = "GENESIS";
  let lastSeq = 0;
  let prevWasAnchor = false;
  const anchors: { seq: number }[] = [];
  for (const t of rows) {
    if (typeof t.seq !== "number" || t.seq <= lastSeq) return { ok: false, anchors };
    lastSeq = t.seq;
    if (H({ seq: t.seq, prev }) !== t.h) {
      if (prevWasAnchor) return { ok: false, anchors };
      anchors.push({ seq: t.seq });
      prev = t.h;
      prevWasAnchor = true;
      continue;
    }
    prev = t.h;
    prevWasAnchor = false;
  }
  if (prevWasAnchor && anchors.length > 0) return { ok: false, anchors };
  return { ok: true, anchors };
}

/* ── עזר: ספריית-מצב זמנית עם רישום ── */
function withRegistry(reg: object | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-reg-"));
  if (reg !== null) {
    fs.mkdirSync(path.join(dir, "audit"), { recursive: true });
    fs.writeFileSync(path.join(dir, ANCHOR_REGISTRY_RELPATH), JSON.stringify(reg));
  }
  return dir;
}

const LIVING_BOOK_REGISTRY = {
  book: "regenesis2",
  registeredAt: "2026-10-26T00:00:00Z",
  genesisRow: { seq: 1, ts: 1792943895659, h: "ca7156adee62838760ba638fe5461ca7" },
  documentedSeams: [],
  baseline: 0,
  inherited: {
    baseline: 7,
    note: "בסיס-7 שייך לדור-הספר-הקודם (46335/55120/68276 + צמתים 290040/294919/299807/299847) — רשום-להוכחה, לא חל על הספר-החי",
    evidence: "state/audit/segments.json · state/quarantine/* · פורנזיה גל-93 2026-10-18T04Z",
  },
  law: "כל-תפר-מעבר-לבסיס = אזעקה fail-closed",
};

describe("רישום-בסיס-עוגנים — loadAnchorBaseline", () => {
  test("ספר-חי: baseline=0 מהרישום · source=registry · inherited מתועד", () => {
    const b = loadAnchorBaseline(withRegistry(LIVING_BOOK_REGISTRY));
    expect(b.source).toBe("registry");
    expect(b.baseline).toBe(0);
    expect(b.book).toBe("regenesis2");
    expect(b.documentedSeams).toEqual([]);
    expect(b.inherited?.baseline).toBe(7);
    expect(b.inherited?.evidence).toContain("segments.json");
  });

  test("ספר-מתועד-תפרים: baseline==documentedSeams.length", () => {
    const reg = { ...LIVING_BOOK_REGISTRY, baseline: 1, documentedSeams: [{ seq: 12345, note: "תפר-מתועד" }] };
    const b = loadAnchorBaseline(withRegistry(reg));
    expect(b.baseline).toBe(1);
    expect(b.documentedSeams[0].seq).toBe(12345);
  });

  test("fallback כנה בהיעדר-רישום (baseline=0 · source=fallback)", () => {
    const b = loadAnchorBaseline(withRegistry(null));
    expect(b.source).toBe("fallback");
    expect(b.baseline).toBe(0);
    expect(b.documentedSeams).toEqual([]);
  });

  test("fail-closed: רישום-פגום (JSON שבור) → fallback מחמיר", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-reg-"));
    fs.mkdirSync(path.join(dir, "audit"), { recursive: true });
    fs.writeFileSync(path.join(dir, ANCHOR_REGISTRY_RELPATH), "{not-json");
    const b = loadAnchorBaseline(dir);
    expect(b.source).toBe("fallback");
    expect(b.baseline).toBe(0);
  });

  test("fail-closed: רישום-לא-עקבי (baseline=2, seams=1) → fallback", () => {
    const reg = { ...LIVING_BOOK_REGISTRY, baseline: 2, documentedSeams: [{ seq: 1 }] };
    const b = loadAnchorBaseline(withRegistry(reg));
    expect(b.source).toBe("fallback");
    expect(b.baseline).toBe(0);
  });

  test("fail-closed: baseline שלילי/לא-שלם → fallback", () => {
    expect(loadAnchorBaseline(withRegistry({ ...LIVING_BOOK_REGISTRY, baseline: -1, documentedSeams: [] })).source).toBe("fallback");
    expect(loadAnchorBaseline(withRegistry({ ...LIVING_BOOK_REGISTRY, baseline: 1.5, documentedSeams: [{ seq: 1 }] })).source).toBe("fallback");
  });
});

describe("הכרעת-עוגנים — anchorVerdict", () => {
  const b0 = loadAnchorBaseline(withRegistry(LIVING_BOOK_REGISTRY));
  const b1 = loadAnchorBaseline(withRegistry({ ...LIVING_BOOK_REGISTRY, baseline: 1, documentedSeams: [{ seq: 12345 }] }));

  test("0/0 = ok (ספר-רציף — המצב-הבריא של הספר-החי)", () => {
    expect(anchorVerdict(0, b0)).toBe("ok");
  });
  test("תפר-מתועד 1/1 = ok", () => {
    expect(anchorVerdict(1, b1)).toBe("ok");
  });
  test("תפר-חדש-לא-מתועד 1/0 = אזעקה (fail-closed)", () => {
    expect(anchorVerdict(1, b0)).toBe("alarm");
  });
  test("צמיחה-מעל-הבסיס 2/1 = אזעקה", () => {
    expect(anchorVerdict(2, b1)).toBe("alarm");
  });
});

describe("קו-הקבלה-הכנה — anchorReceiptLine", () => {
  const b0 = loadAnchorBaseline(withRegistry(LIVING_BOOK_REGISTRY));
  const b7legacy = loadAnchorBaseline(withRegistry({ ...LIVING_BOOK_REGISTRY, baseline: 7, documentedSeams: Array.from({ length: 7 }, (_, i) => ({ seq: (i + 1) * 1000 })) }));

  test("0/0 מוצג 'ספר-רציף' — ואף-פעם לא נראה כ-0/7", () => {
    const line = anchorReceiptLine(0, b0);
    expect(line).toContain("0/0");
    expect(line).toContain("ספר-רציף");
    expect(line).not.toContain("0/7");
  });
  test("תפרים-מתועדים מוצגים כמתועדים (לא ככישלון)", () => {
    const line = anchorReceiptLine(7, b7legacy);
    expect(line).toContain("7/7");
    expect(line).toContain("מתועד");
  });
  test("תפר-חדש מוצג כאזעקה (fail-closed גלוי)", () => {
    const line = anchorReceiptLine(1, b0);
    expect(line).toContain("אזעקה");
  });
});

describe("סמנטיקת-תפרים Z2-15 × רישום-פר-דור (מראה-verifyChain)", () => {
  const b0 = loadAnchorBaseline(withRegistry(LIVING_BOOK_REGISTRY));
  const b1 = loadAnchorBaseline(withRegistry({ ...LIVING_BOOK_REGISTRY, baseline: 1, documentedSeams: [{ seq: 500 }] }));

  test("ספר-מושלם (5 רשומות): ok:true · anchors=0 · הכרעה ok", () => {
    const v = verifyMirror(buildChain([1, 2, 3, 4, 5]));
    expect(v.ok).toBe(true);
    expect(v.anchors).toHaveLength(0);
    expect(anchorVerdict(v.anchors.length, b0)).toBe("ok");
  });

  test("ספר-מתופר (תפר אחד מגובה-רציפות): ok:true · anchors=1", () => {
    const v = verifyMirror(buildChain([1, 2, 500, 501, 502], { seams: new Set([500]) }));
    expect(v.ok).toBe(true);
    expect(v.anchors.map((a) => a.seq)).toEqual([500]);
  });

  test("תפר-מתועד (baseline=1) = ok · אותו-תפר-בלי-רישום (baseline=0) = אזעקה — הרישום הוא החוק", () => {
    const v = verifyMirror(buildChain([1, 2, 500, 501, 502], { seams: new Set([500]) }));
    expect(anchorVerdict(v.anchors.length, b1)).toBe("ok");
    expect(anchorVerdict(v.anchors.length, b0)).toBe("alarm");
  });

  test("זנב-בלתי-מעוגן: ok:false (Z2-15 · לא-נפגע-מהרישום)", () => {
    const rows = buildChain([1, 2, 500], { seams: new Set([500]), tailUnanchored: true });
    const v = verifyMirror(rows);
    expect(v.ok).toBe(false);
  });

  test("נסיגת-seq: ok:false (חוק-סדר Z2-15)", () => {
    const v = verifyMirror(buildChain([1, 2, 3, 4, 5], { seqRegress: true }));
    expect(v.ok).toBe(false);
  });

  test("עוגנים-עוקבים (שבר-אמת-שאינו-מתגבש): ok:false", () => {
    const v = verifyMirror(buildChain([1, 2, 3, 4, 5], { seams: new Set([3, 4]) }));
    expect(v.ok).toBe(false);
  });
});
