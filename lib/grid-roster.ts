/* ═══ grid-roster.ts — רשומת-חיילי-הגריד (נתונית · fail-closed) ═══
 * ===========================================================================
 * G77-b: הרשמת-חיילי-גריד לכלכלה-הפנימית דרך קובץ-נתונים (state/grid-roster.json)
 * — הוספת-חייל (כמו saos-0004) = שורת-נתון, אפס-שינוי-קוד. חוקי-הרישום:
 *  · schema "saos.grid-roster/1" — סטייה ⇒ זעקה (parse throws).
 *  · id: /^[a-z0-9][a-z0-9-]{2,31}$/ (שמות-שרשרת/פנים · קטן-אחיד) · כפילות נדחית.
 *  · chain ∈ steem|hive|blurt|internal · rail ∈ internal-credits|steem|sbd.
 *  · תקרת-גודל 64 — אפס-הצפה.
 * הטעינה fail-closed: קובץ-חסר/פגום ⇒ ברירת-המחדל-הריקה-הכנה (המנוע-לא-מת,
 * מפעל-הדלק מדווח blocked-empty-roster בכנות). קריאה-ב-boot בלבד (כמו
 * sov-policy/ext-policy — כותב-יחיד: הקנון; המנוע קורא).
 */
import fs from "fs";
import path from "path";

export const GRID_ROSTER_RELPATH = "grid-roster.json";
export const GRID_ROSTER_SCHEMA = "saos.grid-roster/1";
export const GRID_ROSTER_CAP = 64;

export type GridSoldier = {
  id: string;
  role: string;
  chain: "steem" | "hive" | "blurt" | "internal";
  rail: "internal-credits" | "steem" | "sbd";
};

export type GridRoster = {
  schema: string;
  soldiers: GridSoldier[];
  source: "registry" | "default";
  law: string;
};

const ID_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const CHAINS = new Set(["steem", "hive", "blurt", "internal"]);
const RAILS = new Set(["internal-credits", "steem", "sbd"]);

export function emptyGridRoster(): GridRoster {
  return {
    schema: GRID_ROSTER_SCHEMA,
    soldiers: [],
    source: "default",
    law: "אין-רשום-גריד-תקפה — ברירת-מחדל-ריקה (fail-closed): מפעל-הדלק ידווח blocked-empty-roster בכנות",
  };
}

/** ניתוח-טהור: קלט-פסול ⇒ זעקה (לעולם-לא-תיקון-שקט). */
export function parseGridRoster(raw: string): GridRoster {
  const j = JSON.parse(raw) as Record<string, unknown>;
  if (j?.schema !== GRID_ROSTER_SCHEMA) throw new Error(`grid-roster: schema לא-נתמך (${String(j?.schema)})`);
  const arr = j?.soldiers;
  if (!Array.isArray(arr)) throw new Error("grid-roster: soldiers אינו-מערך");
  if (arr.length > GRID_ROSTER_CAP) throw new Error(`grid-roster: מעל-תקרת-הגודל (${GRID_ROSTER_CAP})`);
  const soldiers: GridSoldier[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const id = typeof (s as GridSoldier)?.id === "string" ? (s as GridSoldier).id : "";
    if (!ID_RE.test(id)) throw new Error(`grid-roster: id-פסול (${id.slice(0, 40)})`);
    if (seen.has(id)) throw new Error(`grid-roster: id-כפול (${id})`);
    seen.add(id);
    const role = typeof (s as GridSoldier)?.role === "string" ? (s as GridSoldier).role.slice(0, 120) : "";
    if (!role) throw new Error(`grid-roster: role-חסר (${id})`);
    const chain = (s as GridSoldier)?.chain;
    const rail = (s as GridSoldier)?.rail;
    if (typeof chain !== "string" || !CHAINS.has(chain)) throw new Error(`grid-roster: chain-פסול (${id})`);
    if (typeof rail !== "string" || !RAILS.has(rail)) throw new Error(`grid-roster: rail-פסול (${id})`);
    soldiers.push({ id, role, chain: chain as GridSoldier["chain"], rail: rail as GridSoldier["rail"] });
  }
  return {
    schema: GRID_ROSTER_SCHEMA,
    soldiers,
    source: "registry",
    law: typeof j?.law === "string" ? j.law : "רשום-גריד-נתוני — הוספת-חייל = שורת-נתון (אפס-שינוי-קוד)",
  };
}

/** טעינה fail-closed מהדיסק — כל-כישלון ⇒ ברירת-המחדל-הריקה (כנה, אף-המצאה). */
export function loadGridRoster(stateDir: string): GridRoster {
  try {
    return parseGridRoster(fs.readFileSync(path.join(stateDir, GRID_ROSTER_RELPATH), "utf8"));
  } catch {
    return emptyGridRoster();
  }
}
